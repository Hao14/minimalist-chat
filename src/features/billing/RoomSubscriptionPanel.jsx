import { ROOM_BILLING_PLANS } from './roomBillingPlans.js';

const COMPARISON_ROWS = Object.freeze([
  ['perFile', 'File upload size', 'ph-file-arrow-up'],
  ['daily', 'Daily upload limit', 'ph-gauge'],
  ['video', 'Video calls', 'ph-video-camera'],
  ['screenShare', 'Screen share', 'ph-monitor-arrow-up'],
  ['analytics', 'Room analytics', 'ph-chart-line-up'],
  ['selectedUsers', 'Members with benefits', 'ph-users-three'],
]);

function PlanChoice({ plan, selected = false }) {
  const planId = `rs-room-plan-${plan.id}`;

  return (
    <label className={`room-plan-choice${selected ? ' is-current' : ''}`} htmlFor={planId}>
      <input
        type="radio"
        name="rs-room-subscription-plan"
        value={plan.id}
        id={planId}
        defaultChecked={selected}
        aria-labelledby={`${planId}-name ${planId}-price ${planId}-state`}
      />
      <span className="room-plan-choice-copy">
        <strong id={`${planId}-name`}>{plan.label}</strong>
        <span id={`${planId}-price`}>{plan.priceLabel}</span>
      </span>
      <span className="room-plan-choice-state" id={`${planId}-state`}>
        {selected ? (plan.id === 'base' ? 'Free' : 'Active') : 'Choose'}
      </span>
      <dl className="room-plan-mobile-features">
        {COMPARISON_ROWS.map(([key, label, icon]) => (
          <div key={key}>
            <dt><i className={`ph-bold ${icon}`} />{label}</dt>
            <dd>{plan.comparison[key]}</dd>
          </div>
        ))}
      </dl>
    </label>
  );
}

export function RoomSubscriptionPanel() {
  const plans = Object.values(ROOM_BILLING_PLANS);

  return (
    <div className="room-billing-workspace">
      <header className="room-billing-heading">
        <div className="room-billing-heading-copy">
          <h2>Room subscription</h2>
          <p className="room-billing-scope">This upgrades this room, not your account.</p>
          <p>Upgrade this room and assign paid benefits to the members who need them.</p>
        </div>
        <span className="room-billing-provider"><i className="ph-bold ph-lock-key" /> Secured by Stripe</span>
      </header>

      <section className="room-billing-current" aria-label="Current room billing status">
        <span className="room-billing-current-icon"><i className="ph-bold ph-shield-check" /></span>
        <div>
          <span>Current room plan</span>
          <strong id="rs-room-billing-current-plan">Base room</strong>
        </div>
        <span className="room-billing-state" id="rs-room-billing-status">Free</span>
        <div className="room-billing-owner">
          <span>Billed to</span>
          <strong id="rs-room-billing-owner">No billing owner</strong>
        </div>
        <div className="room-billing-renewal" id="rs-room-billing-renewal">No recurring room charge</div>
        <button
          type="button"
          className="room-billing-manage hidden"
          id="rs-manage-room-billing-btn"
          aria-label="Manage subscription for this room in Stripe"
        >
          <i className="ph-bold ph-arrow-square-out" aria-hidden="true" />
          Manage subscription
        </button>
      </section>

      <section className="room-plan-comparison" id="rs-room-subscription-plans" aria-labelledby="room-plan-comparison-title">
        <div className="room-plan-section-heading">
          <div>
            <h3 id="room-plan-comparison-title">Choose a room plan</h3>
            <p>Compare the room benefits available to selected members.</p>
          </div>
          <span>Monthly billing</span>
        </div>
        <div
          className="room-plan-comparison-grid room-plan-comparison-head"
          role="radiogroup"
          aria-labelledby="room-plan-comparison-title"
        >
          <span>Plan comparison</span>
          {plans.map((plan) => <PlanChoice key={plan.id} plan={plan} selected={plan.id === 'base'} />)}
        </div>
        {COMPARISON_ROWS.map(([key, label, icon]) => (
          <div className="room-plan-comparison-grid room-plan-comparison-row" key={key}>
            <span><i className={`ph-bold ${icon}`} /> {label}</span>
            {plans.map((plan) => <span key={plan.id}>{plan.comparison[key]}</span>)}
          </div>
        ))}
      </section>

      <div className="room-billing-purchase-grid">
        <section
            className="room-subscription-members is-locked"
          id="rs-room-subscription-members"
          aria-labelledby="rs-room-subscription-title"
          aria-disabled="true"
        >
          <div className="room-subscription-members-head">
            <div>
              <h3 id="rs-room-subscription-title">Member access</h3>
              <p id="rs-room-subscription-limit">Available after Stripe confirms the room subscription.</p>
            </div>
            <span id="rs-room-subscription-count" aria-live="polite">Locked</span>
          </div>
          <div className="room-subscription-lock" id="rs-room-subscription-lock">
            <span className="room-subscription-lock-icon"><i className="ph-bold ph-lock-key" /></span>
            <div>
              <strong>Purchase a room plan first</strong>
              <span>After payment succeeds, return here to choose which room members receive the plan benefits.</span>
            </div>
          </div>
          <div id="rs-room-subscription-user-list" className="room-subscription-user-list hidden" />
        </section>

        <aside className="room-checkout-summary" aria-labelledby="room-checkout-summary-title">
          <h3 id="room-checkout-summary-title">Order summary</h3>
          <div className="room-checkout-plan">
            <span><i className="ph-bold ph-trend-up" /></span>
            <div><strong id="rs-room-checkout-plan">Choose a paid plan</strong><small id="rs-room-checkout-price">No charge selected</small></div>
          </div>
          <p id="rs-room-checkout-renewal">Paid room plans renew monthly until canceled.</p>
          <div className="room-billing-truth-note"><i className="ph-bold ph-info" /> User assignment unlocks only after Stripe confirms payment.</div>
          <button type="button" className="action-btn" id="rs-save-room-subscription-btn" disabled>
            Choose a paid plan
          </button>
          <small><i className="ph-bold ph-shield-check" /> Secure, server-verified checkout with Stripe</small>
          <div id="rs-room-billing-action-status" role="status" aria-live="polite" />
        </aside>
      </div>
    </div>
  );
}
