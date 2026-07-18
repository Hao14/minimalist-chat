import './accountBilling.css';

const ACCOUNT_PLANS = [
  {
    id: 'advanced',
    name: 'Advanced',
    price: '$1.99',
    description: 'More space and sharper sharing for everyday collaboration.',
    features: [
      '700MB per file',
      '1.5GB daily upload cap',
      'Create up to 5 rooms',
      'Screen share at 1080p / 60fps',
      'Advanced account badge',
      'Everything in Base',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$7.99',
    description: 'The full Minimalist toolkit for high-volume work and rooms.',
    featured: true,
    features: [
      '3GB per file and 9GB per day',
      'Unlimited room creation',
      'Room analytics and video calls',
      'System-limit screen sharing',
      'Winston Personal AI Agent',
      'Offline viewing and Pro badge',
    ],
  },
];

export function AccountBillingPanel() {
  return (
    <section className="account-billing" aria-labelledby="account-billing-title">
      <header className="account-billing__header">
        <div>
          <span className="account-billing__eyebrow">Account subscription</span>
          <h2 id="account-billing-title">Billing that stays simple</h2>
          <p>Choose an account plan here. Checkout, invoices, payment methods, and cancellation are handled securely by Stripe.</p>
        </div>
        <span className="account-billing__stripe-mark" aria-label="Payments secured by Stripe">
          <i className="ph-bold ph-lock-key" aria-hidden="true" /> Secured by Stripe
        </span>
      </header>

      <article className="account-billing__current" id="account-current-plan" data-tier="base">
        <div className="account-billing__current-copy">
          <span className="account-billing__label">Current plan</span>
          <div className="account-billing__plan-heading">
            <strong id="billing-plan-name">Minimalist Base</strong>
            <span id="billing-tier-badge" className="tier-badge base">BASE</span>
          </div>
          <p id="billing-plan-limits">10MB per file · 500MB/day · 3 rooms · Screen share 720p/30</p>
          <span id="billing-plan-status" className="account-billing__renewal">No paid account subscription</span>
        </div>
        <button
          id="manage-billing-btn"
          className="account-billing__manage"
          type="button"
          aria-label="Manage subscription in Stripe"
        >
          <i className="ph-bold ph-arrow-square-out" aria-hidden="true" />
          Manage subscription
        </button>
      </article>

      <p id="account-billing-action-status" className="account-billing__status" role="status" aria-live="polite" hidden />

      <div className="account-billing__plans" aria-label="Available account plans">
        {ACCOUNT_PLANS.map((plan) => (
          <article
            className={`account-billing__plan${plan.featured ? ' account-billing__plan--featured' : ''}`}
            id={`account-plan-${plan.id}`}
            data-plan={plan.id}
            key={plan.id}
          >
            {plan.featured && <span className="account-billing__popular">Full access</span>}
            <div className="account-billing__plan-topline">
              <div>
                <h3>{plan.name}</h3>
                <p>{plan.description}</p>
              </div>
              <div className="account-billing__price" aria-label={`${plan.price} per month`}>
                <strong>{plan.price}</strong>
                <span>/ month</span>
              </div>
            </div>
            <ul>
              {plan.features.map((feature) => (
                <li key={feature}>
                  <i className="ph-bold ph-check-circle" aria-hidden="true" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
            <button id={`upgrade-${plan.id}-btn`} className="account-billing__choose" type="button">
              Choose {plan.name}
              <i className="ph-bold ph-arrow-right" aria-hidden="true" />
            </button>
          </article>
        ))}
      </div>

      <div className="account-billing__footnotes">
        <p id="billing-management-note">
          Paid members use the Stripe portal to switch plans, update payment details, view invoices, or cancel. Changes are reflected here automatically.
        </p>
        <p>
          <i className="ph-bold ph-users-three" aria-hidden="true" />
          Room subscriptions are separate and are managed from each room’s Billing panel.
        </p>
      </div>
    </section>
  );
}
