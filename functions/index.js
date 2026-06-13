const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');

admin.initializeApp();

exports.lemonSqueezyWebhook = functions.https.onRequest(async (req, res) => {
    // 1. Verify Signature
    const secret = "youareabanana";
    // NOTE: If this fails, req.rawBody might be empty. 
    // Ensure you are using the rawBody from the request object provided by Firebase.
    const hmac = crypto.createHmac('sha256', secret);
    const digest = Buffer.from(hmac.update(req.rawBody || "").digest('hex'), 'utf8');
    const signature = Buffer.from(req.get('x-signature') || '', 'utf8');

    if (!crypto.timingSafeEqual(digest, signature)) {
        console.error("Signature verification failed!");
        return res.status(403).send('Invalid signature');
    }

    const event = req.body;
    console.log("Webhook Event Received:", event.meta.event_name);
    
    // 2. Look for successful subscription events
    if (event.meta.event_name === 'subscription_created' || event.meta.event_name === 'subscription_updated') {
        const userId = event.meta.custom_data.user_id;
        const rawVariantName = event.data.attributes.variant_name || "";
        
        // Robust Matching Logic:
        // This forces "Pro Plan" or "Pro" into exactly "pro"
        let finalTier = 'free';
        const nameLower = rawVariantName.toLowerCase();
        
        if (nameLower.includes('pro')) finalTier = 'pro';
        else if (nameLower.includes('advanced')) finalTier = 'advanced';

        console.log(`Updating User ${userId} to Tier: ${finalTier} (Original: ${rawVariantName})`);

        // 3. Update the database
        await admin.database().ref(`users/${userId}`).update({ 
            tier: finalTier 
        });
    }

    res.status(200).send('OK');
});