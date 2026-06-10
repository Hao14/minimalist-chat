const functions = require('firebase-functions');
const admin = require('firebase-admin');
const stripe = require('stripe')('sk_test_51QgFVBK2lNxMjmQ4Nd24aAajTj8MjVNBXsUfnAelMA4lJPmMeEdWrfC1cYYUKr3AcZtSjQl2Tmwv6INsY9QHIlCj00r0fAWnM5');

admin.initializeApp();

// 1. Generate Checkout Link
exports.createCheckoutSession = functions.https.onCall(async (data, context) => {
    // Nuclear Fix: Check standard auth context, fallback to manual token payload
    let uid = context.auth?.uid;
    if (!uid && data.token) {
        const decodedToken = await admin.auth().verifyIdToken(data.token);
        uid = decodedToken.uid;
    }
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');

    const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'subscription',
        line_items: [{ price: data.priceId, quantity: 1 }],
        success_url: 'https://chat-app-356c1.web.app/chat.html?success=true',
        cancel_url: 'https://chat-app-356c1.web.app/chat.html?canceled=true',
        client_reference_id: uid, 
    });

    return { url: session.url };
});

// 2. Generate Manage Portal Link
exports.createPortalLink = functions.https.onCall(async (data, context) => {
    let uid = context.auth?.uid;
    if (!uid && data.token) {
        const decodedToken = await admin.auth().verifyIdToken(data.token);
        uid = decodedToken.uid;
    }
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');

    const userSnap = await admin.database().ref(`users/${uid}`).once('value');
    const stripeCustomerId = userSnap.val()?.stripeCustomerId;

    if (!stripeCustomerId) throw new functions.https.HttpsError('failed-precondition', 'No active subscription found.');

    const portalSession = await stripe.billingPortal.sessions.create({
        customer: stripeCustomerId,
        return_url: 'https://chat-app-356c1.web.app/chat.html', 
    });

    return { url: portalSession.url };
});