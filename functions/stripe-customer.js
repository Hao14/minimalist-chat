'use strict';

const crypto = require('node:crypto');

function stripeErrorCode(error) {
    return String(error?.code || error?.raw?.code || '').trim();
}

function stripeErrorParam(error) {
    return String(error?.param || error?.raw?.param || '').trim();
}

function isMissingStripeCustomerError(error) {
    return stripeErrorCode(error) === 'resource_missing'
        && (!stripeErrorParam(error) || ['customer', 'id'].includes(stripeErrorParam(error)));
}

function staleAccountBillingReset(now = Date.now()) {
    return {
        tier: 'free',
        stripeSubscriptionId: null,
        stripeSubscriptionStatus: null,
        stripePriceId: null,
        stripeCancelAtPeriodEnd: false,
        stripeCurrentPeriodEnd: null,
        stripeUpdatedAt: now
    };
}

function customerBelongsToUser(customer, uid, expectedLivemode) {
    if (!customer || customer.deleted === true || !String(customer.id || '').startsWith('cus_')) return false;
    if (typeof customer.livemode === 'boolean' && customer.livemode !== expectedLivemode) return false;
    const ownerUid = String(customer.metadata?.firebaseUid || '').trim();
    return !ownerUid || ownerUid === uid;
}

async function retrieveStripeCustomer(stripe, customerId, uid, expectedLivemode) {
    if (!String(customerId || '').startsWith('cus_')) return null;
    let customer;
    try {
        customer = await stripe.customers.retrieve(customerId);
    } catch (error) {
        if (isMissingStripeCustomerError(error)) return null;
        throw error;
    }

    if (!customerBelongsToUser(customer, uid, expectedLivemode)) return null;
    if (!String(customer.metadata?.firebaseUid || '').trim()) {
        customer = await stripe.customers.update(customer.id, {
            metadata: { ...(customer.metadata || {}), firebaseUid: uid }
        });
    }
    return customer;
}

async function resolveStripeCustomer({
    stripe,
    userRef,
    user = {},
    decoded,
    fallbackCustomerId = '',
    createIfMissing = true,
    expectedLivemode = true,
    now = Date.now()
}) {
    const uid = String(decoded?.uid || '').trim();
    if (!uid) throw new Error('A Firebase user id is required to resolve a Stripe customer.');

    const storedCustomerId = String(user.stripeCustomerId || '').trim();
    const candidates = [...new Set([storedCustomerId, String(fallbackCustomerId || '').trim()].filter(Boolean))];

    for (const candidate of candidates) {
        const customer = await retrieveStripeCustomer(stripe, candidate, uid, expectedLivemode);
        if (!customer) continue;

        const replacingStoredCustomer = !!storedCustomerId && customer.id !== storedCustomerId;
        await userRef.update({
            ...(replacingStoredCustomer ? staleAccountBillingReset(now) : {}),
            stripeCustomerId: customer.id,
            stripeUpdatedAt: now
        });
        return {
            customer,
            customerId: customer.id,
            created: false,
            replaced: replacingStoredCustomer
        };
    }

    if (!createIfMissing) {
        if (storedCustomerId) {
            await userRef.update({
                ...staleAccountBillingReset(now),
                stripeCustomerId: null
            });
        }
        return {
            customer: null,
            customerId: '',
            created: false,
            replaced: !!storedCustomerId
        };
    }

    const mode = expectedLivemode ? 'live' : 'test';
    const uidHash = crypto.createHash('sha256').update(uid).digest('hex');
    const customer = await stripe.customers.create({
        email: decoded.email || undefined,
        name: user.displayName || decoded.name || undefined,
        metadata: { firebaseUid: uid }
    }, {
        idempotencyKey: `minimalist-customer-v2-${mode}-${uidHash}`
    });

    await userRef.update({
        ...(storedCustomerId ? staleAccountBillingReset(now) : {}),
        stripeCustomerId: customer.id,
        stripeUpdatedAt: now
    });

    return {
        customer,
        customerId: customer.id,
        created: true,
        replaced: !!storedCustomerId
    };
}

module.exports = {
    isMissingStripeCustomerError,
    resolveStripeCustomer,
    staleAccountBillingReset
};
