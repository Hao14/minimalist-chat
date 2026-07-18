import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  accountPlans,
  faqItems,
  pricingPageMeta,
  roomSubscriptionPlans,
} from '../src/content/marketingContent.js';

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

const routes = [
  {
    slug: 'features',
    title: 'Minimalist | Features',
    description: 'Explore Minimalist rooms, Catch-Me-Up, focus tools, decisions, action items, scheduling, templates, offline reading, search, and room memory.',
    shellKicker: 'Features',
    shellTitle: 'Everything your room needs. Nothing in the way.',
    shellCopy: 'The quiet core and advanced room tools are loading now.',
    body: `
      <main class="prerender-route" data-prerender-route="features">
        <section>
          <p>Features</p>
          <h1>Everything your room needs. Nothing in the way.</h1>
          <p>Start with a calm conversation. Reveal decisions, tasks, scheduling, room memory, and AI only when the work calls for them.</p>
        </section>
        <section>
          <h2>Core workflow</h2>
          <ul>
            <li>Catch-Me-Up digests for decisions, links, and important updates.</li>
            <li>Quiet-by-default rooms with focus, zen, and compact reading modes.</li>
            <li>Global search across rooms, people, and recent messages.</li>
            <li>Structured follow-through with tasks, scheduled messages, and room memory.</li>
          </ul>
        </section>
      </main>`,
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
    title: 'Minimalist | Download',
    description: 'Use the Minimalist web app today, install it from a supported browser, and check the roadmap status for desktop and mobile apps.',
    shellKicker: 'Download',
    shellTitle: 'Your rooms, ready wherever you open them.',
    shellCopy: 'Web availability, install readiness, and platform status are loading now.',
    body: `
      <main class="prerender-route" data-prerender-route="download">
        <section>
          <p>Download</p>
          <h1>Your rooms, ready wherever you open them.</h1>
          <p>Use the web app today, install it from a supported browser, and follow desktop and mobile availability without losing your place.</p>
        </section>
        <section>
          <h2>Available now</h2>
          <ul>
            <li>Web app with no installer required.</li>
            <li>PWA install flow for supported browsers.</li>
            <li>Shared sign-in across rooms, files, chats, and settings.</li>
          </ul>
        </section>
      </main>`,
  },
  {
    slug: 'story',
    title: 'Minimalist | Story',
    description: 'Why Minimalist is building calmer rooms where conversation, memory, files, events, and decisions can live together without turning into noise.',
    shellKicker: 'Story',
    shellTitle: 'Chat should give your group room to breathe.',
    shellCopy: 'The thinking behind calmer, more useful rooms is loading now.',
    body: `
      <main class="prerender-route" data-prerender-route="story">
        <section>
          <p>Story</p>
          <h1>Chat should give your group room to breathe.</h1>
          <p>Minimalist is a calmer rooms platform where conversation, files, events, memory, and decisions can stay useful without becoming a noisy feed.</p>
        </section>
        <section>
          <h2>Design principles</h2>
          <ul>
            <li>Calm by default.</li>
            <li>Power stays tucked away until it helps.</li>
            <li>Room memory should make the space more useful over time.</li>
          </ul>
        </section>
      </main>`,
  },
  {
    slug: 'faq',
    title: 'Minimalist | Frequently Asked Questions',
    description: 'Answers about Minimalist rooms, collaboration tools, plans, contacts, and privacy.',
    shellKicker: 'FAQ',
    shellTitle: 'Answers without the scavenger hunt.',
    shellCopy: 'Searchable answers about rooms, plans, people, and privacy are loading now.',
    body: buildFaqRouteBody(),
    structuredData: buildFaqStructuredData(),
  },
  {
    slug: 'privacy',
    title: 'Minimalist | Privacy Policy',
    description: 'Read how Minimalist handles account, chat, billing, Firebase, Stripe, and account-deletion data.',
    shellKicker: 'Privacy',
    shellTitle: 'Privacy, in plain language.',
    shellCopy: 'The current privacy policy is loading with collection, billing, and deletion details.',
    body: `
      <main class="prerender-route" data-prerender-route="privacy">
        <section>
          <p>Privacy Policy</p>
          <h1>Clear details about what Minimalist stores and why.</h1>
          <p>Minimalist.chat collects the account, chat, collaboration, and billing data needed to run the service, and relies on Firebase and Stripe for core platform infrastructure.</p>
        </section>
        <section>
          <h2>At a glance</h2>
          <ul>
            <li>Account, profile, and authentication records.</li>
            <li>Messages, files, room content, and collaboration data.</li>
            <li>Billing status and Stripe customer identifiers, not raw card numbers.</li>
            <li>Deletion controls from account settings.</li>
          </ul>
        </section>
      </main>`,
  },
  {
    slug: 'terms',
    title: 'Minimalist | Terms of Service',
    description: 'Read the Minimalist terms covering acceptance, user conduct, content, subscriptions, and refunds.',
    shellKicker: 'Terms',
    shellTitle: 'Terms of service, minus the fog.',
    shellCopy: 'The current service terms are loading with conduct, billing, and subscription details.',
    body: `
      <main class="prerender-route" data-prerender-route="terms">
        <section>
          <p>Terms of Service</p>
          <h1>What you agree to when you use Minimalist.</h1>
          <p>Using Minimalist.chat means agreeing to the platform terms, including responsible conduct, subscription handling through Stripe, and respect for billing, authentication, and security controls.</p>
        </section>
        <section>
          <h2>Key topics</h2>
          <ul>
            <li>Acceptance of service terms.</li>
            <li>User conduct and content restrictions.</li>
            <li>Subscription renewals and billing flows.</li>
          </ul>
        </section>
      </main>`,
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
  return html.replace('<div id="root"></div>', `<div id="root">${body}\n    </div>`);
}

function removeHomeOnlyShell(html) {
  return html.replace(
    /\s*<main id="static-home-shell"[\s\S]*?<\/main>\s*(?=<div id="root")/,
    '\n    ',
  );
}

function replaceRoutePublicShell(html, route) {
  const publicShellPattern = /<div class="route-shell-panel route-shell-public">[\s\S]*?<\/div>\s*<div class="instant-status"/;
  const replacement = `<div class="route-shell-panel route-shell-public">
        <span class="route-shell-kicker">${route.shellKicker}</span>
        <div class="route-shell-title">${route.shellTitle}</div>
        <p class="route-shell-copy">${route.shellCopy}</p>
      </div>
      <div class="instant-status"`;
  return html.replace(publicShellPattern, replacement);
}

function injectHomePricing(template) {
  const pricingSummary = `
      <section class="landing-section landing-pricing" data-prerender-home-pricing aria-label="Account plans">
        <div class="landing-section-heading">
          <p>Plans</p>
          <h2>Start free. Upgrade when your account needs more room.</h2>
          <a href="/pricing">Compare plans</a>
        </div>
        <div class="landing-pricing-grid">${renderPlanCards(accountPlans)}</div>
      </section>`;
  return template.replace(/\s*<\/main>\s*(?=<div id="root"><\/div>)/, `${pricingSummary}\n    </main>\n    `);
}

function buildRouteHtml(template, route) {
  const canonicalUrl = `${siteOrigin}/${route.slug}`;
  let html = template;
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${route.title}</title>`);
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
  html = removeHomeOnlyShell(html);
  html = replaceRoot(html, route.body);
  html = replaceRoutePublicShell(html, route);
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
  const homeHtml = injectHomePricing(template);
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
