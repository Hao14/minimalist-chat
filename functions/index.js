const functions = require('firebase-functions');
const admin = require('firebase-admin');
const stripe = require('stripe')('sk_test_51QgFVBK2lNxMjmQ4Nd24aAajTj8MjVNBXsUfnAelMA4lJPmMeEdWrfC1cYYUKr3AcZtSjQl2Tmwv6INsY9QHIlCj00r0fAWnM5');

admin.initializeApp();

// 1. Generate Checkout Link
exports.createCheckoutSession = functions.https.onCall(async (data, context) => {
    try {
        // Fallback to data.userId if Firebase drops the auth context
        const uid = context.auth?.uid || data.userId;
        
        if (!uid) {
            throw new functions.https.HttpsError('unauthenticated', 'User ID is missing. Please log in again.');
        }

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
        throw new functions.https.HttpsError('internal', error.message);
    }
});

// 2. Generate Manage Portal Link
exports.createPortalLink = functions.https.onCall(async (data, context) => {
    try {
        const uid = context.auth?.uid || data.userId;
        if (!uid) {
            throw new functions.https.HttpsError('unauthenticated', 'User ID is missing. Please log in again.');
        }

        const userSnap = await admin.database().ref(`users/${uid}`).once('value');
        const stripeCustomerId = userSnap.val()?.stripeCustomerId;

        if (!stripeCustomerId) {
            throw new functions.https.HttpsError('failed-precondition', 'No active subscription found. Are you on a free plan?');
        }

        const portalSession = await stripe.billingPortal.sessions.create({
            customer: stripeCustomerId,
            return_url: 'https://chat-app-356c1.web.app/chat.html', 
        });

        return { url: portalSession.url };
    } catch (error) {
        throw new functions.https.HttpsError(error.code || 'internal', error.message);
    }
});