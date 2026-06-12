const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');

admin.initializeApp();

exports.lemonSqueezyWebhook = functions.https.onRequest(async (req, res) => {
    // 1. Verify Signature (Crucial for security)
    const crypto = require('crypto');
    const secret = "youareabanana";
    const hmac = crypto.createHmac('sha256', secret);
    const digest = Buffer.from(hmac.update(req.rawBody).digest('hex'), 'utf8');
    const signature = Buffer.from(req.get('x-signature') || '', 'utf8');

    if (!crypto.timingSafeEqual(digest, signature)) return res.status(403).send('Invalid signature');

    const event = req.body;
    
    // 2. Look for successful subscription events
    if (event.meta.event_name === 'subscription_created' || event.meta.event_name === 'subscription_updated') {
        const userId = event.meta.custom_data.user_id; // This is the ID we passed in the URL
        const variantName = event.data.attributes.variant_name; // 'Advanced' or 'Pro'

        // 3. Update the database
        await admin.database().ref(`users/${userId}`).update({ 
            tier: variantName.toLowerCase() 
        });
    }

    res.status(200).send('OK');
});