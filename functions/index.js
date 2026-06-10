const functions = require('firebase-functions');
const admin = require('firebase-admin');
const stripe = require('stripe')('sk_test_51QgFVBK2lNxMjmQ4Nd24aAajTj8MjVNBXsUfnAelMA4lJPmMeEdWrfC1cYYUKr3AcZtSjQl2Tmwv6INsY9QHIlCj00r0fAWnM5');

admin.initializeApp();

// 1. Generate Checkout Link
exports.createCheckoutSession = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');

    const session = await stripe.checkout.sessions.create({
        // FIX: Stripe automatically handles Apple/Google pay inside 'card'.
        // Requesting them explicitly causes a fatal server crash!
        payment_method_types: ['card'], 
        mode: 'subscription',
        line_items: [{ price: data.priceId, quantity: 1 }],
        success_url: 'https://chat-app-356c1.web.app/chat.html?success=true',
        cancel_url: 'https://chat-app-356c1.web.app/chat.html?canceled=true',
        client_reference_id: context.auth.uid, 
    });

    return { url: session.url };
});

// 2. Generate Manage Portal Link
exports.createPortalLink = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');

    const userSnap = await admin.database().ref(`users/${context.auth.uid}`).once('value');
    const stripeCustomerId = userSnap.val()?.stripeCustomerId;

    if (!stripeCustomerId) throw new functions.https.HttpsError('failed-precondition', 'No active subscription found.');

    const portalSession = await stripe.billingPortal.sessions.create({
        customer: stripeCustomerId,
        return_url: 'https://chat-app-356c1.web.app/chat.html', 
    });

    return { url: portalSession.url };
});