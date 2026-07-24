import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  accountPlans,
  faqItems,
  pricingPageMeta,
  roomSubscriptionPlans,
  termsPageMeta,
  termsSections,
} from '../src/content/marketingContent.js';
import {
  downloadPageContent,
  featureStatusLabels,
  featuresPageContent,
  homePageContent,
  privacyPageContent,
  storyPageContent,
} from '../src/content/publicMarketingContent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const distDir = path.join(projectRoot, 'dist');
const templatePath = path.join(distDir, 'index.html');
const siteOrigin = 'https://minimalist.chat';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderPlanCards(plans) {
  return plans.map((plan) => `
          <article>
            <h3>${escapeHtml(plan.name)}</h3>
            <p><strong>${escapeHtml(plan.displayPrice)}</strong></p>
            <p>${escapeHtml(plan.intent)}</p>
            <p>${escapeHtml(plan.scope)}</p>
            <ul>${plan.features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join('')}</ul>
          </article>`).join('');
}

const featureById = new Map(
  featuresPageContent.catalog.map((feature) => [feature.id, feature]),
);

function renderFeatureList(featureIds) {
  return `<ul>${featureIds.map((featureId) => {
    const feature = featureById.get(featureId);
    if (!feature) throw new Error(`Unknown marketing feature id: ${featureId}`);
    return `
            <li data-feature-status="${escapeHtml(feature.status)}">
              <h3>${escapeHtml(feature.title)}</h3>
              <p>${escapeHtml(feature.summary)}</p>
              <p><strong>Status:</strong> ${escapeHtml(featureStatusLabels[feature.status])}</p>
            </li>`;
  }).join('')}</ul>`;
}

function buildHomeRouteSections() {
  return `
      <section class="landing-section" data-prerender-home-workflow aria-labelledby="prerender-home-workflow">
        <h2 id="prerender-home-workflow">${escapeHtml(homePageContent.workflow.title)}</h2>
        <p>${escapeHtml(homePageContent.workflow.copy)}</p>
        <ol>${homePageContent.workflow.steps.map((step) => `
          <li>
            <h3>${escapeHtml(step.title)}</h3>
            <p>${escapeHtml(step.copy)}</p>
          </li>`).join('')}</ol>
      </section>
      <section class="landing-section" data-prerender-home-signal aria-labelledby="prerender-home-signal">
        <h2 id="prerender-home-signal">${escapeHtml(homePageContent.signal.title)}</h2>
        <p>${escapeHtml(homePageContent.signal.copy)}</p>
        ${renderFeatureList(homePageContent.signal.featureIds)}
      </section>
      <section class="landing-section landing-pricing" data-prerender-home-pricing aria-labelledby="prerender-home-plans">
        <div class="landing-section-heading">
          <h2 id="prerender-home-plans">${escapeHtml(homePageContent.plans.title)}</h2>
          <p>${escapeHtml(homePageContent.plans.copy)}</p>
          <a href="${escapeHtml(homePageContent.plans.action.href)}">${escapeHtml(homePageContent.plans.action.label)}</a>
        </div>
        <div class="landing-pricing-grid">${renderPlanCards(accountPlans)}</div>
      </section>
      <section class="landing-section" data-prerender-home-close aria-labelledby="prerender-home-close">
        <h2 id="prerender-home-close">${escapeHtml(homePageContent.close.title)}</h2>
        <p>${escapeHtml(homePageContent.close.copy)}</p>
        <p>
          <a href="${escapeHtml(homePageContent.close.primaryAction.href)}">${escapeHtml(homePageContent.close.primaryAction.label)}</a>
          <a href="${escapeHtml(homePageContent.close.secondaryAction.href)}">${escapeHtml(homePageContent.close.secondaryAction.label)}</a>
        </p>
      </section>`;
}

function buildFeaturesRouteBody() {
  return `
      <main class="prerender-route" data-prerender-route="features">
        <section>
          <p>${escapeHtml(featuresPageContent.hero.label)}</p>
          <h1>${escapeHtml(featuresPageContent.hero.title)}</h1>
          <p>${escapeHtml(featuresPageContent.hero.copy)}</p>
          <p>${escapeHtml(featuresPageContent.statusIntro)}</p>
        </section>
        <div id="feature-groups">
          <section aria-labelledby="prerender-features-overview">
            <h2 id="prerender-features-overview">What the room can do</h2>
            <ul>${featuresPageContent.overview.map((item) => `
              <li>
                <h3>${escapeHtml(item.title)}: ${escapeHtml(item.benefit)}</h3>
                <p>${escapeHtml(item.summary)}</p>
                <p>${escapeHtml(item.plan)}</p>
              </li>`).join('')}</ul>
          </section>
          ${featuresPageContent.groups.map((group) => `
            <section id="feature-group-${escapeHtml(group.id)}">
              <h2>${escapeHtml(group.title)}</h2>
              <p>${escapeHtml(group.summary)}</p>
              ${renderFeatureList(group.featureIds)}
            </section>`).join('')}
        </div>
        <section aria-labelledby="prerender-features-workflow">
          <h2 id="prerender-features-workflow">${escapeHtml(featuresPageContent.workflow.title)}</h2>
          <ol>${featuresPageContent.workflow.steps.map((step) => `
            <li><h3>${escapeHtml(step.title)}</h3><p>${escapeHtml(step.copy)}</p></li>`).join('')}</ol>
        </section>
        <section aria-labelledby="prerender-features-close">
          <h2 id="prerender-features-close">${escapeHtml(featuresPageContent.close.title)}</h2>
          <p>${escapeHtml(featuresPageContent.close.copy)}</p>
        </section>
      </main>`;
}

function buildDownloadRouteBody() {
  return `
      <main class="prerender-route" data-prerender-route="download">
        <section>
          <p>${escapeHtml(downloadPageContent.hero.label)}</p>
          <h1>${escapeHtml(downloadPageContent.hero.title)}</h1>
          <p>${escapeHtml(downloadPageContent.hero.copy)}</p>
        </section>
        <section aria-labelledby="prerender-download-platforms">
          <h2 id="prerender-download-platforms">Platform availability</h2>
          <ul>${downloadPageContent.platforms.map((platform) => `
            <li data-platform-availability="${escapeHtml(platform.availability)}">
              <h3>${escapeHtml(platform.title)}</h3>
              <p><strong>${escapeHtml(platform.status)}</strong></p>
              <p>${escapeHtml(platform.summary)}</p>
              <a href="${escapeHtml(platform.action.href)}">${escapeHtml(platform.action.label)}</a>
            </li>`).join('')}</ul>
        </section>
        <section aria-labelledby="prerender-download-install">
          <h2 id="prerender-download-install">Install the web experience when it is available</h2>
          <ol>${downloadPageContent.installSteps.map((step) => `
            <li><h3>${escapeHtml(step.title)}</h3><p>${escapeHtml(step.copy)}</p></li>`).join('')}</ol>
        </section>
        <section aria-labelledby="prerender-download-sync">
          <h2 id="prerender-download-sync">What follows your sign-in</h2>
          <ul>${downloadPageContent.syncFacts.map((fact) => `<li>${escapeHtml(fact)}</li>`).join('')}</ul>
        </section>
        <section aria-labelledby="prerender-download-faq">
          <h2 id="prerender-download-faq">Download questions</h2>
          <dl>${downloadPageContent.faqs.map((item) => `
            <div><dt><strong>${escapeHtml(item.question)}</strong></dt><dd>${escapeHtml(item.answer)}</dd></div>`).join('')}</dl>
        </section>
        <section aria-labelledby="prerender-download-close">
          <h2 id="prerender-download-close">${escapeHtml(downloadPageContent.close.title)}</h2>
          <p>${escapeHtml(downloadPageContent.close.copy)}</p>
        </section>
      </main>`;
}

function buildStoryRouteBody() {
  return `
      <main class="prerender-route" data-prerender-route="story">
        <section>
          <p>${escapeHtml(storyPageContent.hero.label)}</p>
          <h1>${escapeHtml(storyPageContent.hero.title)}</h1>
          <p>${escapeHtml(storyPageContent.hero.copy)}</p>
        </section>
        <section aria-labelledby="prerender-story-manifesto">
          <h2 id="prerender-story-manifesto">${escapeHtml(storyPageContent.manifesto.title)}</h2>
          <p>${escapeHtml(storyPageContent.manifesto.copy)}</p>
        </section>
        <section aria-labelledby="prerender-story-timeline">
          <h2 id="prerender-story-timeline">From noise to room to context</h2>
          <ol>${storyPageContent.timeline.map((stage) => `
            <li id="story-stage-${escapeHtml(stage.id)}"><h3>${escapeHtml(stage.title)}</h3><p>${escapeHtml(stage.copy)}</p></li>`).join('')}</ol>
        </section>
        <section id="story-principles" aria-labelledby="prerender-story-principles">
          <h2 id="prerender-story-principles">Principles in practice</h2>
          <ol>${storyPageContent.principles.map((principle) => `
            <li id="story-principle-${escapeHtml(principle.id)}">
              <h3>${escapeHtml(principle.title)}</h3>
              <p>${escapeHtml(principle.copy)}</p>
            </li>`).join('')}</ol>
        </section>
        <section aria-labelledby="prerender-story-position">
          <h2 id="prerender-story-position">${escapeHtml(storyPageContent.position.title)}</h2>
          <p>${escapeHtml(storyPageContent.position.copy)}</p>
        </section>
        <blockquote><p>${escapeHtml(storyPageContent.quote)}</p><cite>Minimalist manifesto</cite></blockquote>
        <section aria-labelledby="prerender-story-close">
          <h2 id="prerender-story-close">${escapeHtml(storyPageContent.close.title)}</h2>
          <p>${escapeHtml(storyPageContent.close.copy)}</p>
        </section>
      </main>`;
}

function buildPrivacyRouteBody() {
  return `
      <main class="prerender-route" data-prerender-route="privacy">
        <section>
          <p>${escapeHtml(privacyPageContent.hero.label)}</p>
          <h1>${escapeHtml(privacyPageContent.hero.title)}</h1>
          <p>${escapeHtml(privacyPageContent.hero.copy)}</p>
          <p>Last updated <time datetime="${escapeHtml(privacyPageContent.meta.updatedAt)}">${escapeHtml(privacyPageContent.meta.lastUpdated)}</time>.</p>
        </section>
        <section aria-labelledby="prerender-privacy-summary">
          <h2 id="prerender-privacy-summary">At a glance</h2>
          <ul>${privacyPageContent.summary.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
        </section>
        <article aria-label="Privacy Policy">
          ${privacyPageContent.sections.map((section, index) => `
            <section id="${escapeHtml(section.id)}">
              <p>${String(index + 1).padStart(2, '0')}</p>
              <h2>${escapeHtml(section.title)}</h2>
              <p>${escapeHtml(section.copy)}</p>
              ${section.items.length ? `<ul>${section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}
            </section>`).join('')}
        </article>
      </main>`;
}

function buildPricingRouteBody() {
  return `
      <main class="prerender-route" data-prerender-route="pricing">
        <section>
          <p>Pricing</p>
          <h1>Account plans and optional room subscriptions</h1>
          <p>Account plans follow one person across rooms. A room creator can separately add one recurring subscription to a private room and assign its benefits to selected members.</p>
        </section>
        <section aria-labelledby="prerender-account-plans">
          <h2 id="prerender-account-plans">Account plans</h2>
          <p>Choose the limits and account-level benefits that follow your signed-in account.</p>
          <div>${renderPlanCards(accountPlans)}</div>
        </section>
        <section aria-labelledby="prerender-room-plans">
          <h2 id="prerender-room-plans">Optional room subscriptions</h2>
          <p>These are separate subscriptions for one private room, managed by that room's creator.</p>
          <div>${renderPlanCards(roomSubscriptionPlans)}</div>
          <p>Room benefits are minimums inside that room and never reduce stronger benefits from a member's account plan.</p>
        </section>
      </main>`;
}

function buildFaqRouteBody() {
  return `
      <main class="prerender-route" data-prerender-route="faq">
        <section>
          <p>Frequently Asked Questions</p>
          <h1>Answers without the scavenger hunt.</h1>
          <p>Search the details, narrow by topic, and open only what you need.</p>
        </section>
        <section>
          <h2>Popular questions</h2>
          <dl>${faqItems.map((item) => `
            <div>
              <dt><strong>${escapeHtml(item.question)}</strong></dt>
              <dd>${escapeHtml(item.answer)}</dd>
            </div>`).join('')}
          </dl>
        </section>
      </main>`;
}

function buildFaqStructuredData() {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': `${siteOrigin}/faq#faq`,
    url: `${siteOrigin}/faq`,
    mainEntity: faqItems.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  };
}

function buildTermsRouteBody() {
  return `
      <main class="prerender-route" data-prerender-route="terms">
        <section>
          <p>Terms of Service</p>
          <h1>Current terms for using Minimalist</h1>
          <p>Accounts, rooms, content, AI, recurring subscriptions, cancellation, safety, and service use—written to be read, not decoded.</p>
          <p>Last updated <time datetime="${escapeHtml(termsPageMeta.updatedAt)}">${escapeHtml(termsPageMeta.lastUpdated)}</time>.</p>
        </section>
        <article aria-label="Terms of Service">
          ${termsSections.map((section, index) => `
            <section id="${escapeHtml(section.id)}">
              <p>${String(index + 1).padStart(2, '0')}</p>
              <h2>${escapeHtml(section.title)}</h2>
              ${section.copy ? `<p>${escapeHtml(section.copy)}</p>` : ''}
              ${section.items?.length ? `<ul>${section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}
            </section>`).join('')}
        </article>
      </main>`;
}

const routes = [
  {
    slug: 'features',
    title: featuresPageContent.meta.title,
    description: featuresPageContent.meta.description,
    shellKicker: featuresPageContent.shell.kicker,
    shellTitle: featuresPageContent.shell.title,
    shellCopy: featuresPageContent.shell.copy,
    body: buildFeaturesRouteBody(),
  },
  {
    slug: 'pricing',
    title: pricingPageMeta.title,
    description: pricingPageMeta.description,
    shellKicker: 'Pricing',
    shellTitle: 'Account plans and optional room subscriptions.',
    shellCopy: 'Verified account and private-room options are loading now.',
    body: buildPricingRouteBody(),
  },
  {
    slug: 'download',
    title: downloadPageContent.meta.title,
    description: downloadPageContent.meta.description,
    shellKicker: downloadPageContent.shell.kicker,
    shellTitle: downloadPageContent.shell.title,
    shellCopy: downloadPageContent.shell.copy,
    body: buildDownloadRouteBody(),
  },
  {
    slug: 'story',
    title: storyPageContent.meta.title,
    description: storyPageContent.meta.description,
    shellKicker: storyPageContent.shell.kicker,
    shellTitle: storyPageContent.shell.title,
    shellCopy: storyPageContent.shell.copy,
    body: buildStoryRouteBody(),
  },
  {
    slug: 'faq',
    title: 'Minimalist | Frequently Asked Questions',
    description: 'Current answers about Minimalist rooms, messaging, plans, billing, AI, contacts, privacy, and account controls.',
    shellKicker: 'FAQ',
    shellTitle: 'Helpful answers. No support maze.',
    shellCopy: 'Searchable answers about rooms, billing, AI, messaging, and privacy are loading now.',
    body: buildFaqRouteBody(),
    structuredData: buildFaqStructuredData(),
  },
  {
    slug: 'privacy',
    title: privacyPageContent.meta.title,
    description: privacyPageContent.meta.description,
    shellKicker: privacyPageContent.shell.kicker,
    shellTitle: privacyPageContent.shell.title,
    shellCopy: privacyPageContent.shell.copy,
    body: buildPrivacyRouteBody(),
  },
  {
    slug: 'terms',
    title: termsPageMeta.title,
    description: termsPageMeta.description,
    shellKicker: 'Terms',
    shellTitle: 'Current terms for using Minimalist.',
    shellCopy: 'The complete service terms are loading with accounts, safety, AI, billing, and cancellation details.',
    body: buildTermsRouteBody(),
  },
  {
    slug: 'login',
    title: 'Minimalist | Enter',
    description: 'Log in or sign up for Minimalist.chat to open your rooms, private messages, docs, files, calendar, and AI workspace.',
    shellKicker: 'Account',
    shellTitle: 'Log in to Minimalist',
    shellCopy: 'Your sign-in form is loading locally before auth connects.',
    noindex: true,
    body: `
      <main class="prerender-route" data-prerender-route="login">
        <section>
          <p>Account</p>
          <h1>Log in to Minimalist</h1>
          <p>Open your quieter workspace, continue with Google, or sign in with email to return to your rooms, contacts, files, calendar, and AI tools.</p>
        </section>
      </main>`,
  },
  {
    slug: 'chat',
    title: 'Minimalist | Chat',
    description: 'Open the Minimalist.chat app for rooms, messages, docs, whiteboard, calendar, calls, vault, contacts, and AI tools.',
    shellKicker: 'Chat',
    shellTitle: 'Your room workspace is opening.',
    shellCopy: 'Rooms, messages, docs, calls, vault, contacts, calendar, and AI tools are loading.',
    noindex: true,
    body: `
      <main class="prerender-route" data-prerender-route="chat">
        <section>
          <p>Chat</p>
          <h1>Your room workspace is opening.</h1>
          <p>Minimalist.chat is loading the app shell for rooms, messages, docs, whiteboard, calendar, calls, vault, contacts, and AI tools.</p>
        </section>
      </main>`,
  },
];

function escapeAttribute(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;');
}

function upsertMeta(html, selector, tag) {
  if (selector.test(html)) return html.replace(selector, tag);
  return html.replace('</head>', `  ${tag}\n  </head>`);
}

function appendStructuredData(html, value) {
  const serialized = JSON.stringify(value).replaceAll('<', '\\u003c');
  return html.replace('</head>', `  <script id="minimalist-page-structured-data" type="application/ld+json">${serialized}</script>\n  </head>`);
}

function removeCanonicalMetadata(html) {
  return html
    .replace(/\s*<meta property="og:url" content="[^"]*"\s*\/?>/, '')
    .replace(/\s*<link rel="canonical" href="[^"]*"\s*\/?>/, '');
}

function removeStructuredData(html) {
  return html.replace(/\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '');
}

function replaceRoot(html, body) {
  return html.replace(/<div id="root">\s*<\/div>/, `<div id="root">${body}\n    </div>`);
}

const prerenderNavigation = [
  ['/', 'Home', ''],
  ['/features', 'Features', 'features'],
  ['/pricing', 'Pricing', 'pricing'],
  ['/download', 'Download', 'download'],
  ['/story', 'Story', 'story'],
  ['/faq', 'FAQ', 'faq'],
  ['/login', 'Log in', 'login'],
];

function buildPrerenderChrome(body, activeSlug) {
  const navigation = prerenderNavigation.map(([href, label, slug]) => `
          <a href="${href}"${slug === activeSlug ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  return `
      <header class="prerender-site-header" data-prerender-chrome>
        <a class="prerender-site-brand" href="/" aria-label="Minimalist home">
          <img src="/icon.svg" alt="" width="32" height="32" />
          <span>Minimalist</span>
        </a>
        <nav aria-label="Primary">${navigation}
        </nav>
      </header>
${body}
      <footer class="prerender-site-footer" data-prerender-chrome>
        <p>One calm room for conversation and follow-through.</p>
        <nav aria-label="Legal">
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </nav>
      </footer>`;
}

function removeHomeOnlyShell(html) {
  return html.replace(
    /\s*<main id="static-home-shell"[\s\S]*?<\/main>\s*/,
    '\n    ',
  );
}

function replaceRouteLoadingShell(html, route) {
  if (route.slug === 'features') {
    return html.replace(
      /(<div class="route-shell-panel route-shell-features">[\s\S]*?<span class="route-shell-kicker">)[\s\S]*?(<\/span>[\s\S]*?<div class="route-shell-title">)[\s\S]*?(<\/div>[\s\S]*?<p class="route-shell-copy">)[\s\S]*?(<\/p>)/,
      `$1${escapeHtml(route.shellKicker)}$2${escapeHtml(route.shellTitle)}$3${escapeHtml(route.shellCopy)}$4`,
    );
  }

  const publicShellPattern = /<div class="route-shell-panel route-shell-public">[\s\S]*?<\/div>\s*<div class="instant-status"/;
  const replacement = `<div class="route-shell-panel route-shell-public">
        <span class="route-shell-kicker">${escapeHtml(route.shellKicker)}</span>
        <div class="route-shell-title">${escapeHtml(route.shellTitle)}</div>
        <p class="route-shell-copy">${escapeHtml(route.shellCopy)}</p>
      </div>
      <div class="instant-status"`;
  return html.replace(publicShellPattern, replacement);
}

function applyRouteMetadata(template, route) {
  const canonicalUrl = route.slug ? `${siteOrigin}/${route.slug}` : `${siteOrigin}/`;
  let html = template;
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(route.title)}</title>`);
  html = html.replace(/<meta name="description" content="[^"]*"/, `<meta name="description" content="${escapeAttribute(route.description)}"`);
  html = html.replace(/<meta property="og:title" content="[^"]*"/, `<meta property="og:title" content="${escapeAttribute(route.title)}"`);
  html = html.replace(/<meta property="og:description" content="[^"]*"/, `<meta property="og:description" content="${escapeAttribute(route.description)}"`);
  html = html.replace(/<meta name="twitter:title" content="[^"]*"/, `<meta name="twitter:title" content="${escapeAttribute(route.title)}"`);
  html = html.replace(/<meta name="twitter:description" content="[^"]*"/, `<meta name="twitter:description" content="${escapeAttribute(route.description)}"`);
  if (route.canonical === false) {
    html = removeCanonicalMetadata(html);
  } else {
    html = upsertMeta(html, /<meta property="og:url" content="[^"]*"\s*\/?>/, `<meta property="og:url" content="${canonicalUrl}" />`);
    html = upsertMeta(html, /<link rel="canonical" href="[^"]*"\s*\/?>/, `<link rel="canonical" href="${canonicalUrl}" />`);
  }
  if (route.noindex) {
    html = upsertMeta(html, /<meta name="robots" content="[^"]*"\s*\/?>/, '<meta name="robots" content="noindex,follow" />');
  }
  if (route.structuredData) html = appendStructuredData(html, route.structuredData);
  return html;
}

function injectHomeContent(template) {
  let html = applyRouteMetadata(template, {
    slug: homePageContent.slug,
    title: homePageContent.meta.title,
    description: homePageContent.meta.description,
  });
  html = html.replace(
    /(<h1 id="static-home-heading">)[\s\S]*?(<\/h1>)/,
    `$1${escapeHtml(homePageContent.hero.title)}$2`,
  );
  html = html.replace(
    /(<div class="static-home-copy">[\s\S]*?<\/h1>\s*<p>)[\s\S]*?(<\/p>)/,
    `$1${escapeHtml(homePageContent.hero.copy)}$2`,
  );
  return html.replace(
    /(<main id="static-home-shell"[\s\S]*?)\s*<\/main>/,
    (_match, shell) => `${shell}${buildHomeRouteSections()}\n      </main>`,
  );
}

function buildRouteHtml(template, route) {
  let html = applyRouteMetadata(template, route);
  html = removeHomeOnlyShell(html);
  html = replaceRoot(html, buildPrerenderChrome(route.body, route.slug));
  html = replaceRouteLoadingShell(html, route);
  return html;
}

function buildNotFoundHtml(template) {
  let html = buildRouteHtml(template, {
    slug: '404',
    title: 'Minimalist | Page Not Found',
    description: 'The page you requested could not be found.',
    shellKicker: '404',
    shellTitle: 'Page Not Found.',
    shellCopy: 'That page wandered off. Let us get you back somewhere useful.',
    canonical: false,
    noindex: true,
    body: `
      <main class="container not-found-page" data-prerender-route="404">
        <div class="not-found-code">404</div>
        <h1>Page <span>Not Found.</span></h1>
        <p>That page wandered off. Let’s get you back somewhere useful.</p>
        <a href="/" class="lp-btn lp-btn-primary">Return Home</a>
      </main>`,
  });
  html = removeStructuredData(html);
  return html;
}

async function writeRouteOutputs(route, html) {
  const nestedDir = path.join(distDir, route.slug);
  await mkdir(nestedDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(nestedDir, 'index.html'), html, 'utf8'),
    writeFile(path.join(distDir, `${route.slug}.html`), html, 'utf8'),
  ]);
}

async function main() {
  const template = await readFile(templatePath, 'utf8');
  const homeHtml = injectHomeContent(template);
  await writeFile(templatePath, homeHtml, 'utf8');
  await Promise.all(routes.map(async (route) => {
    const html = buildRouteHtml(homeHtml, route);
    await writeRouteOutputs(route, html);
  }));
  await writeFile(path.join(distDir, '404.html'), buildNotFoundHtml(homeHtml), 'utf8');
  console.log(`Prerendered ${routes.length} routes and a custom 404 into ${distDir}`);
}

main().catch((error) => {
  console.error('Failed to prerender marketing routes:', error);
  process.exitCode = 1;
});
