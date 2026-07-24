import { MemoryRouter } from 'react-router-dom';
import { expect, within } from 'storybook/test';
import MarketingPricingContent from './MarketingPricingContent.jsx';
import { LandingOutcomeVisual, PricingPlanRail } from './MarketingPages.jsx';
import './marketingV5.css';

function StoryShell({ children }) {
  return children;
}

function StoryArrowIcon() {
  return <i className="ph-bold ph-arrow-right" aria-hidden="true" />;
}

function StoryMarketingClose({ copy, title }) {
  return (
    <section className="mkt4-close">
      <div><h2>{title}</h2><p>{copy}</p></div>
      <div className="mkt4-actions">
        <a className="mkt4-button is-primary" href="#account-plans">Choose a plan <StoryArrowIcon /></a>
      </div>
    </section>
  );
}

function PricingStory() {
  return (
    <MemoryRouter>
      <MarketingPricingContent
        ctaArrowIcon={StoryArrowIcon}
        marketingClose={StoryMarketingClose}
        pricingPlanRail={PricingPlanRail}
        shellComponent={StoryShell}
      />
    </MemoryRouter>
  );
}

/** @type {import('@storybook/react-vite').Meta<typeof PricingStory>} */
const meta = {
  title: 'Marketing/Pricing and Product Flow',
  component: PricingStory,
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;

export const DesktopPricing = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', {
      level: 1,
      name: 'Plans for you. Plans for your room.',
    })).toBeVisible();
    await expect(canvas.getAllByText('Recommended')).toHaveLength(2);
    await expect(canvas.getAllByText('Best for')).toHaveLength(6);
    await expect(canvas.getByRole('link', { name: /Choose Advanced$/ })).toBeVisible();
    await expect(canvas.getByRole('link', { name: /Choose Advanced Room$/ })).toBeVisible();
  },
};

export const MobilePricing = {
  parameters: {
    viewport: {
      defaultViewport: 'mobile1',
    },
  },
  play: async ({ canvas }) => {
    const heading = canvas.getByRole('heading', {
      level: 1,
      name: 'Plans for you. Plans for your room.',
    });
    const planRail = canvas.getByLabelText('Account plan comparison');

    await expect(within(heading).getByText('Plans for you.')).toBeVisible();
    await expect(within(heading).getByText('Plans for your room.')).toBeVisible();
    await expect(planRail).toBeVisible();
    await expect(canvas.getByRole('link', { name: /Start free/ })).toBeVisible();
  },
};

export const ReducedMotionProductFlow = {
  parameters: {
    prefersReducedMotion: 'reduce',
  },
  render: () => (
    <div className="marketing-v5 home-v5" style={{ minHeight: '100vh', padding: 32, background: '#fff' }}>
      <LandingOutcomeVisual staticMotion />
    </div>
  ),
  play: async ({ canvas }) => {
    const flow = canvas.getByLabelText('A conversation becomes a decision and an assigned task');
    const motionDots = flow.querySelectorAll('.home-outcome-connector i');

    await expect(flow).toBeVisible();
    await expect(motionDots).toHaveLength(2);
    motionDots.forEach((dot) => expect(getComputedStyle(dot).display).toBe('none'));
  },
};
