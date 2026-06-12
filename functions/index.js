const functions = require('firebase-functions');
const admin = require('firebase-admin');
const stripe = require('stripe')('sk_test_51QgFVBK2lNxMjmQ4Nd24aAajTj8MjVNBXsUfnAelMA4lJPmMeEdWrfC1cYYUKr3AcZtSjQl2Tmwv6INsY9QHIlCj00r0fAWnM5');

admin.initializeApp();

// 1. Generate Checkout Link
exports.createCheckoutSession = functions.https.onCall(async (data, context) => {
    try {
        let uid = context.auth ? context.auth.uid : null;
        
        // Grab the token from ANY possible key we passed
        let rawToken = data.clientToken || data.fallbackToken || data.token; 
        
        if (!uid && rawToken) {
            const decoded = await admin.auth().verifyIdToken(rawToken);
            uid = decoded.uid;
        }

        if (!uid) {
            throw new Error(`AUTH_FAIL: Security context is empty. Token provided: ${rawToken ? 'YES' : 'NO'}`);
        }

        // --- STRIPE LOGIC ---
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'subscription',
            line_items: [{ price: data.priceId, quantity: 1 }],
            success_url: 'https://chat-app-356c1.web.app/chat.html?success=true',
            cancel_url: 'https://chat-app-356c1.web.app/chat.html?canceled=true',
            client_reference_id: uid, 
        });

        return { url: session.url };

    } catch (error) {
        if (error.message.startsWith("AUTH_FAIL:")) throw new functions.https.HttpsError('unauthenticated', error.message.replace("AUTH_FAIL: ", ""));
        throw new functions.https.HttpsError('internal', `Stripe Error: ${error.message}`);
    }
});

// 2. Generate Manage Portal Link
exports.createPortalLink = functions.https.onCall(async (data, context) => {
    try {
        let uid = context.auth ? context.auth.uid : null;
        let rawToken = data.clientToken || data.fallbackToken || data.token;

        if (!uid && rawToken) {
            const decoded = await admin.auth().verifyIdToken(rawToken);
            uid = decoded.uid;
        }

        if (!uid) {
            throw new Error(`AUTH_FAIL: Security context is empty. Token provided: ${rawToken ? 'YES' : 'NO'}`);
        }

        // --- STRIPE LOGIC ---
        const userSnap = await admin.database().ref(`users/${uid}`).once('value');
        const stripeCustomerId = userSnap.val()?.stripeCustomerId;

        if (!stripeCustomerId) {
            throw new Error("NO_SUB: No active subscription found. Are you on a free plan?");
        }

        const portalSession = await stripe.billingPortal.sessions.create({
            customer: stripeCustomerId,
            return_url: 'https://chat-app-356c1.web.app/chat.html', 
        });

        return { url: portalSession.url };

    } catch (error) {
        if (error.message.startsWith("AUTH_FAIL:")) throw new functions.https.HttpsError('unauthenticated', error.message.replace("AUTH_FAIL: ", ""));
        if (error.message.startsWith("NO_SUB:")) throw new functions.https.HttpsError('failed-precondition', error.message.replace("NO_SUB: ", ""));
        throw new functions.https.HttpsError('internal', `Stripe Error: ${error.message}`);
    }
});