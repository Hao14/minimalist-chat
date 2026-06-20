// js/billing.js
// Wires the Billing pane to LemonSqueezy hosted checkout. The webhook in
// functions/index.js reads checkout[custom][user_id] to set the user's tier.
// Configure these (e.g. a <script> in chat.html before app.js, or settings):
//   window.LS_ADVANCED_URL — LemonSqueezy checkout URL for the Advanced plan
//   window.LS_PRO_URL      — LemonSqueezy checkout URL for the Pro plan
//   window.LS_PORTAL_URL   — customer portal URL for managing an existing sub

function openCheckout(baseUrl, planLabel) {
    if (!baseUrl) {
        return window.showToast(`${planLabel} checkout isn't set up yet. Add your LemonSqueezy URL (window.LS_${planLabel.toUpperCase()}_URL).`);
    }
    // Build the URL by hand so the checkout[...] brackets survive un-encoded.
    let url = baseUrl + (baseUrl.includes('?') ? '&' : '?');
    if (window.currentUser) {
        url += 'checkout[custom][user_id]=' + encodeURIComponent(window.currentUser.uid);
        if (window.currentUser.email) url += '&checkout[email]=' + encodeURIComponent(window.currentUser.email);
    }
    window.open(url, '_blank', 'noopener');
}

document.getElementById('upgrade-advanced-btn')?.addEventListener('click', () => openCheckout(window.LS_ADVANCED_URL, 'Advanced'));
document.getElementById('upgrade-pro-btn')?.addEventListener('click', () => openCheckout(window.LS_PRO_URL, 'Pro'));
document.getElementById('manage-billing-btn')?.addEventListener('click', () => {
    if (!window.LS_PORTAL_URL) return window.showToast("Billing portal isn't set up yet. Add window.LS_PORTAL_URL to enable 'Manage'.");
    window.open(window.LS_PORTAL_URL, '_blank', 'noopener');
});
