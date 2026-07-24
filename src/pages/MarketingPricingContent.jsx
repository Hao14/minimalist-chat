import { createElement } from 'react';
import { Link } from 'react-router-dom';
import {
  accountPlans,
  pricingPageMeta,
  roomSubscriptionPlans,
} from '../content/marketingContent.js';

export default function MarketingPricingContent({
  ctaArrowIcon,
  marketingClose,
  pricingPlanRail,
  shellComponent,
}) {
  return createElement(
    shellComponent,
    {
      title: pricingPageMeta.title,
      shape: null,
      description: pricingPageMeta.description,
    },
    (
      <main className="marketing-v4 marketing-v5 pricing-v5">
        <section className="mkt4-hero mv5-hero pricing-v5-hero" data-marketing-reveal>
          <div className="mkt4-hero-copy">
            <h1><span>Plans for you.</span><span>Plans for your room.</span></h1>
            <p>An account plan follows one signed-in user across rooms. A room subscription is a separate monthly choice for one private room and assigns benefits only to selected members.</p>
            <div className="mkt4-actions">
              <Link to="/chat" reloadDocument className="mkt4-button is-primary">Start with Base {createElement(ctaArrowIcon)}</Link>
              <a href="#account-plans" className="mkt4-button">Compare account plans {createElement(ctaArrowIcon)}</a>
            </div>
          </div>
          <aside className="mkt4-readiness-console" aria-label="How Minimalist pricing works">
            <div className="mkt4-console-top"><span>HOW PRICING WORKS</span><strong>Two separate choices</strong></div>
            <div className="mkt4-readiness-main">
              <span className="mkt4-readiness-icon"><i className="ph-bold ph-user-circle" aria-hidden="true" /></span>
              <div><small>ACCOUNT PLAN</small><strong>Follows one user</strong><p>Your account limits and features travel with you from room to room.</p></div>
            </div>
            <div className="mkt4-readiness-lines">
              <p><span>Account scope</span><strong>One signed-in user</strong></p>
              <p><span>Room scope</span><strong>One private room</strong></p>
              <p><span>Benefit rule</span><strong>Higher limit stays</strong></p>
            </div>
          </aside>
        </section>

        <section className="mkt4-section" id="account-plans" data-marketing-reveal>
          <header className="mkt4-section-heading">
            <div><span>01</span><h2>Account plans.</h2></div>
            <p>Choose the limits and account features that follow you across Minimalist. Base has no recurring account charge; Advanced and Pro are monthly.</p>
          </header>
          {createElement(pricingPlanRail, {
            ariaLabel: 'Account plan comparison',
            plans: accountPlans,
            showScope: true,
          })}
        </section>

        <section className="mkt4-section" id="room-subscriptions" data-marketing-reveal>
          <header className="mkt4-section-heading">
            <div><span>02</span><h2>Optional room subscriptions.</h2></div>
            <p>A room subscription is separate from account billing. It covers one private room, is managed by that room's creator, and assigns benefits only to selected members within the plan limit.</p>
          </header>
          {createElement(pricingPlanRail, {
            ariaLabel: 'Room subscription comparison',
            plans: roomSubscriptionPlans,
            showScope: true,
          })}
          <article className="mkt4-principle-row">
            <span>NOTE</span>
            <h3>Stronger account benefits stay.</h3>
            <p>For each selected member, Minimalist uses the higher of that person's account limit and the room benefit. Adding a room subscription never lowers an existing account benefit.</p>
          </article>
        </section>

        {createElement(marketingClose, {
          title: 'Start free, then add only what you need.',
          copy: 'Choose an account plan first. Room subscriptions remain optional and separate.',
          secondaryHref: '/faq',
          secondaryLabel: 'Read the FAQ',
        })}
      </main>
    ),
  );
}
