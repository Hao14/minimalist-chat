import Link from "next/link";
import type { CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  CalendarDays,
  Check,
  ChevronRight,
  CircleAlert,
  CircleGauge,
  Database,
  Download,
  ExternalLink,
  FileText,
  Gauge,
  Home,
  Link2,
  Minus,
  Plug,
  Quote,
  ScanLine,
  Settings,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";

import { brandConfig } from "@/config/brand";
import { DemoCounter } from "./DemoCounter";
import { Navigation } from "./Navigation";
import { SiteCaptureForm } from "./SiteCaptureForm";
import styles from "./MarketingHome.module.css";

type ValueItem = {
  title: string;
  copy: string;
  icon: LucideIcon;
  tone: "blue" | "violet" | "teal";
};

const valueItems: ValueItem[] = [
  {
    title: "Technical SEO",
    copy: "Crawl deeper. Find issues. Fix what matters.",
    icon: ScanLine,
    tone: "blue",
  },
  {
    title: "Rankings",
    copy: "Track performance across locations and devices.",
    icon: BarChart3,
    tone: "violet",
  },
  {
    title: "Competitors",
    copy: "Benchmark against competitors and find the gaps.",
    icon: Users,
    tone: "teal",
  },
  {
    title: "AI Visibility",
    copy: "See where your brand appears in AI answers.",
    icon: Quote,
    tone: "blue",
  },
];

const workflowSteps = [
  {
    number: "01",
    title: "Audit",
    copy: "Crawl your site and surface issues that impact discovery.",
    link: "See audit",
    href: "#audit",
  },
  {
    number: "02",
    title: "Prioritize",
    copy: "Focus on the issues and pages with the biggest impact.",
    link: "See priorities",
    href: "#product",
  },
  {
    number: "03",
    title: "Improve",
    copy: "Implement fixes and content that drive visibility.",
    link: "See recommendations",
    href: "#research",
  },
  {
    number: "04",
    title: "Verify",
    copy: "Re-crawl and measure to confirm improvements.",
    link: "See results",
    href: "#examples",
  },
];

const faqItems = [
  {
    question: "Is the data real?",
    answer:
      "Authenticated projects can run bounded public crawls and retain real crawl evidence. Every marketing example on this page is still labeled Demo data and is deterministic—not live customer data or a live audit score. Keyword, backlink, ranking, and AI-answer data stays unavailable until a supported provider is connected.",
  },
  {
    question: "Do I need to verify my website?",
    answer:
      "The current bounded mode crawls only public pages and does not claim ownership. Verification remains required before future higher limits, private data, authenticated pages, or more aggressive rendering settings can be enabled.",
  },
  {
    question: "Which AI-search providers are supported?",
    answer:
      "AI visibility is integration-dependent. The product shows a provider setup state until a supported adapter and credentials are configured; it never invents mentions or citations when a source is unavailable.",
  },
  {
    question: "Can I export my audit?",
    answer:
      "Not yet. CSV export appears only as a labeled demonstration concept. Live CSV, PDF, scheduled, shared, and white-label reporting remain unavailable until their report services are implemented and tested.",
  },
];

function HeroSection() {
  const headlineWords = brandConfig.homepageHeadline.split(" ");

  return (
    <section className={styles.hero} aria-labelledby="home-heading">
      <div className={styles.heroContent}>
        <h1
          id="home-heading"
          className={styles.kineticHeadline}
          data-motion="hero"
          aria-label={brandConfig.homepageHeadline}
        >
          {headlineWords.map((word, index) => (
            <span
              key={`${word}-${index}`}
              aria-hidden="true"
              style={{ "--word-index": index } as CSSProperties}
            >
              {word}
              {index < headlineWords.length - 1 ? "\u00a0" : ""}
            </span>
          ))}
        </h1>
        <p data-motion="hero" data-motion-delay="80">
          {brandConfig.description}
        </p>
        <div data-motion="hero" data-motion-delay="160">
          <SiteCaptureForm placement="hero" />
        </div>
        <Link
          className={styles.textLink}
          href="#product"
          data-motion="hero"
          data-motion-delay="240"
        >
          {brandConfig.callsToAction.secondary}
          <ArrowRight aria-hidden="true" size={18} />
        </Link>
      </div>
      <span className={styles.flowCue} aria-hidden="true">
        <span />
      </span>
    </section>
  );
}

function ValuePropositionSection() {
  return (
    <section
      className={styles.valueSection}
      aria-labelledby="value-heading"
      id="features"
      data-motion="reveal"
    >
      <div className={styles.valueHeading} data-motion="reveal" data-motion-delay="60">
        <h2 id="value-heading">{brandConfig.actionTagline}</h2>
        <p>{brandConfig.tagline}</p>
      </div>
      <div className={styles.valueGrid}>
        {valueItems.map((item, index) => {
          const Icon = item.icon;
          return (
            <article
              className={styles.valueItem}
              key={item.title}
              data-motion="reveal"
              data-motion-delay={index * 60}
            >
              <span className={`${styles.iconBox} ${styles[`iconBox${item.tone}`]}`}>
                <Icon aria-hidden="true" size={22} strokeWidth={1.8} />
              </span>
              <h3>{item.title}</h3>
              <p>{item.copy}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function MetricCard({
  label,
  value,
  suffix,
  note,
  tone,
}: {
  label: string;
  value: number;
  suffix?: string;
  note: string;
  tone?: "danger" | "good";
}) {
  return (
    <article className={styles.metricCard}>
      <p>{label}</p>
      <strong className={tone ? styles[`metric${tone}`] : undefined}>
        <DemoCounter value={value} {...(suffix ? { suffix } : {})} />
      </strong>
      <span className={styles.metricActivity} aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
      <span>{note}</span>
    </article>
  );
}

function ProductPreviewSection() {
  return (
    <section
      className={styles.productPreviewSection}
      id="product"
      aria-label="Searvia product preview using demo data"
      data-motion="reveal"
      data-motion-delay="120"
    >
      <div className={styles.previewWindow}>
        <aside className={styles.previewSidebar}>
          <span className={styles.previewWordmark}>searvia</span>
          <nav aria-label="Product preview navigation">
            <span className={styles.previewNavActive}>
              <Home aria-hidden="true" size={15} /> Overview
            </span>
            <span>
              <ScanLine aria-hidden="true" size={15} /> Site Audit
            </span>
            <span>
              <BarChart3 aria-hidden="true" size={15} /> Rankings
            </span>
            <span>
              <Users aria-hidden="true" size={15} /> Competitors
            </span>
            <span>
              <Link2 aria-hidden="true" size={15} /> Backlinks
            </span>
            <span>
              <Quote aria-hidden="true" size={15} /> AI Visibility
            </span>
            <span>
              <FileText aria-hidden="true" size={15} /> Reports
            </span>
            <span>
              <Bell aria-hidden="true" size={15} /> Alerts
            </span>
            <span>
              <Settings aria-hidden="true" size={15} /> Settings
            </span>
          </nav>
        </aside>

        <div className={styles.previewBody}>
          <div className={styles.previewToolbar}>
            <span className={styles.demoBadge}>
              <Database aria-hidden="true" size={14} /> Demo data
            </span>
            <div className={styles.toolbarActions}>
              <span>
                <CalendarDays aria-hidden="true" size={14} /> May 12 – May 18, 2025
              </span>
              <span>
                <Download aria-hidden="true" size={14} /> Export
              </span>
            </div>
          </div>

          <div className={styles.metricsGrid}>
            <MetricCard
              label="Site Health"
              value={82}
              suffix=" /100"
              note="Good · +6"
              tone="good"
            />
            <MetricCard label="Crawled pages" value={1248} note="+96 vs last crawl" />
            <MetricCard label="Critical issues" value={14} note="−3 vs last crawl" tone="danger" />
            <MetricCard label="Last crawl" value={21} suffix=" hrs" note="May 12, 10:14 AM" />
          </div>

          <div className={styles.issuePanel}>
            <div className={styles.issuePanelHeading}>
              <strong>Top critical issues</strong>
              <span>Evidence included</span>
            </div>
            <div className={styles.issueRow}>
              <CircleAlert aria-hidden="true" className={styles.issueDanger} size={20} />
              <span>Pages blocked from indexing</span>
              <code>robots.txt</code>
              <strong>137 pages</strong>
              <ChevronRight aria-hidden="true" size={17} />
            </div>
            <div className={styles.issueRow}>
              <CircleAlert aria-hidden="true" className={styles.issueDanger} size={20} />
              <span>Missing or duplicate title tags</span>
              <code>title</code>
              <strong>89 pages</strong>
              <ChevronRight aria-hidden="true" size={17} />
            </div>
            <Link className={styles.previewLink} href="/signup">
              View all issues <ArrowRight aria-hidden="true" size={15} />
            </Link>
          </div>

          <p className={styles.demoDisclaimer}>
            Deterministic demonstration project. Not live customer data.
          </p>
        </div>
      </div>
    </section>
  );
}

function SectionLabel({ index, children }: { index: string; children: string }) {
  return (
    <p className={styles.sectionLabel}>
      <span>{index}</span> {children}
    </p>
  );
}

function AuditSection() {
  return (
    <section
      className={styles.featureBand}
      id="audit"
      aria-labelledby="audit-heading"
      data-motion="reveal"
    >
      <span className={styles.backgroundWord} aria-hidden="true">
        audit
      </span>
      <div className={styles.featureCopy}>
        <SectionLabel index="01">Crawl evidence · Demo data</SectionLabel>
        <h2 id="audit-heading">Find what search engines cannot.</h2>
        <p>
          Searvia collects reproducible public-page crawl evidence and runs its active audit rules
          deterministically. The rows below are labeled demo examples; the complete rule catalog and
          aggregate scoring are not implemented yet.
        </p>
      </div>
      <div className={`${styles.dataPanel} ${styles.auditTableWrap}`}>
        <table className={styles.auditTable}>
          <caption>Deterministic audit issue examples</caption>
          <thead>
            <tr>
              <th>Issue</th>
              <th>Severity</th>
              <th>Affected URLs</th>
              <th>Example URL</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>4XX page</td>
              <td>
                <span className={styles.severityHigh}>
                  <CircleAlert aria-hidden="true" size={15} /> High
                </span>
              </td>
              <td>312</td>
              <td>
                <code>demo.example/old-pricing</code>
              </td>
              <td>
                <span className={styles.statusOpen}>Open</span>
              </td>
            </tr>
            <tr>
              <td>Title missing</td>
              <td>
                <span className={styles.severityMedium}>
                  <AlertTriangle aria-hidden="true" size={15} /> Medium
                </span>
              </td>
              <td>278</td>
              <td>
                <code>demo.example/integrations</code>
              </td>
              <td>
                <span className={styles.statusOpen}>Open</span>
              </td>
            </tr>
            <tr>
              <td>Canonical to 4XX</td>
              <td>
                <span className={styles.severityHigh}>
                  <CircleAlert aria-hidden="true" size={15} /> High
                </span>
              </td>
              <td>64</td>
              <td>
                <code>demo.example/features/legacy</code>
              </td>
              <td>
                <span className={styles.statusOpen}>Open</span>
              </td>
            </tr>
          </tbody>
        </table>
        <Link className={styles.panelLink} href="/features/site-audit">
          View full audit report <ArrowRight aria-hidden="true" size={15} />
        </Link>
      </div>
    </section>
  );
}

function ResearchSection() {
  return (
    <section
      className={`${styles.featureBand} ${styles.featureBandAlternate}`}
      id="research"
      aria-labelledby="research-heading"
      data-motion="reveal"
    >
      <span className={styles.backgroundWord} aria-hidden="true">
        rank
      </span>
      <div className={styles.featureCopy}>
        <SectionLabel index="02">Keyword + competitor research</SectionLabel>
        <h2 id="research-heading">Know where visibility is moving.</h2>
        <p>
          Preview the planned provider-backed workflow for positions, gaps, and page opportunities.
        </p>
        <span className={styles.demoBadge}>Demo data</span>
        <small>Live results require a licensed keyword data provider.</small>
      </div>
      <div className={`${styles.dataPanel} ${styles.keywordTableWrap}`}>
        <table className={styles.keywordTable}>
          <caption>Fictional keyword comparison demonstration</caption>
          <thead>
            <tr>
              <th>Keyword</th>
              <th>
                <span className={styles.brandDotBlue} /> Acme Software<small>acme.example</small>
              </th>
              <th>
                <span className={styles.brandDotTeal} /> Northstar<small>northstar.example</small>
              </th>
              <th>
                <span className={styles.brandDotViolet} /> Clearline<small>clearline.example</small>
              </th>
              <th>Opportunity</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>workflow automation software</td>
              <td>
                3 <TrendingUp aria-label="Up 1" size={13} /> 1
              </td>
              <td>
                6 <TrendingUp aria-label="Up 3" size={13} /> 3
              </td>
              <td>
                12 <TrendingUp aria-label="Up 5" size={13} /> 5
              </td>
              <td>
                <span className={styles.opportunityHigh}>High</span>
              </td>
            </tr>
            <tr>
              <td>no code automation</td>
              <td>
                5 <TrendingUp aria-label="Up 2" size={13} /> 2
              </td>
              <td>
                3 <TrendingDown aria-label="Down 1" size={13} /> 1
              </td>
              <td>
                8 <TrendingUp aria-label="Up 2" size={13} /> 2
              </td>
              <td>
                <span className={styles.opportunityHigh}>High</span>
              </td>
            </tr>
            <tr>
              <td>approval workflow tool</td>
              <td>
                8 <TrendingUp aria-label="Up 4" size={13} /> 4
              </td>
              <td>
                4 <TrendingUp aria-label="Up 1" size={13} /> 1
              </td>
              <td>
                <Minus aria-label="No rank" size={13} />
              </td>
              <td>
                <span className={styles.opportunityMedium}>Medium</span>
              </td>
            </tr>
            <tr>
              <td>enterprise workflow platform</td>
              <td>
                11 <TrendingDown aria-label="Down 2" size={13} /> 2
              </td>
              <td>
                7 <TrendingDown aria-label="Down 1" size={13} /> 1
              </td>
              <td>
                9 <TrendingUp aria-label="Up 1" size={13} /> 1
              </td>
              <td>
                <span className={styles.opportunityMedium}>Medium</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AiVisibilitySection() {
  return (
    <section
      className={styles.featureBand}
      id="ai-visibility"
      aria-labelledby="ai-heading"
      data-motion="reveal"
    >
      <span className={styles.backgroundWord} aria-hidden="true">
        cited
      </span>
      <div className={styles.featureCopy}>
        <SectionLabel index="03">AI-search visibility</SectionLabel>
        <h2 id="ai-heading">See when AI answers cite you.</h2>
        <p>Monitor brand mentions and cited sources across connected AI-search providers.</p>
        <small>No provider connection means no result—not an invented metric.</small>
      </div>
      <div className={styles.aiCards}>
        <article className={styles.aiExampleCard}>
          <div className={styles.aiCardHeader}>
            <strong>
              <Quote aria-hidden="true" size={19} /> Connected provider example
            </strong>
            <span className={styles.demoBadge}>Demo data</span>
          </div>
          <p className={styles.promptText}>
            What are the best workflow automation tools for mid-size teams?
          </p>
          <p>Acme Software is a demonstration example with flexible approvals and integrations.</p>
          <div className={styles.sourceRow}>
            <span>
              <FileText aria-hidden="true" size={16} /> Source
            </span>
            <code>acme.example/platform/overview</code>
            <ExternalLink aria-hidden="true" size={14} />
          </div>
        </article>
        <article className={styles.aiIntegrationCard}>
          <div className={styles.aiCardHeader}>
            <strong>
              <Quote aria-hidden="true" size={19} /> ChatGPT Search
            </strong>
            <span className={styles.notConnectedBadge}>Not connected</span>
          </div>
          <div className={styles.integrationEmptyState}>
            <span className={styles.plugIcon}>
              <Plug aria-hidden="true" size={26} />
            </span>
            <div>
              <strong>Integration required</strong>
              <p>
                Connect a supported provider to monitor brand mentions and citations. Availability
                depends on configured adapters.
              </p>
              <Link href="/signup">Set up after sign-up</Link>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}

function WorkflowSection() {
  return (
    <section
      className={styles.workflowSection}
      id="workflow"
      aria-labelledby="workflow-heading"
      data-motion="reveal"
    >
      <div className={styles.workflowInner}>
        <SectionLabel index="04">Workflow</SectionLabel>
        <h2 id="workflow-heading">From scan to clear next step.</h2>
        <div className={styles.workflowGrid}>
          {workflowSteps.map((step, index) => (
            <article
              className={styles.workflowStep}
              key={step.number}
              data-motion="reveal"
              data-motion-delay={index * 60}
            >
              <span className={styles.stepNumber}>{step.number}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.copy}</p>
                <Link href={step.href}>
                  {step.link} <ArrowRight aria-hidden="true" size={14} />
                </Link>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function DemoExamplesSection() {
  return (
    <section
      className={styles.demoSection}
      id="examples"
      aria-labelledby="examples-heading"
      data-motion="reveal"
    >
      <div className={styles.lowerLead}>
        <SectionLabel index="05">Demo data</SectionLabel>
        <h2 id="examples-heading">A clearer view of what is holding you back.</h2>
      </div>
      <div className={styles.demoResults}>
        <div className={styles.resultRow}>
          <span>
            <AlertTriangle aria-hidden="true" size={20} /> Critical issues
          </span>
          <strong>
            21 <ArrowRight aria-hidden="true" size={16} /> <em>14</em>
          </strong>
        </div>
        <div className={styles.resultRow}>
          <span>
            <FileText aria-hidden="true" size={20} /> Pages with missing titles
          </span>
          <strong>
            142 <ArrowRight aria-hidden="true" size={16} /> <em>85</em>
          </strong>
        </div>
        <div className={styles.resultRow}>
          <span>
            <Quote aria-hidden="true" size={20} /> AI citation coverage
          </span>
          <strong>
            <em>3</em> of 8 connected demo prompts
          </strong>
        </div>
        <p>Deterministic demonstration project. Not live customer data.</p>
      </div>
    </section>
  );
}

function IntegrationsSection() {
  const integrations: Array<{ title: string; copy: string; icon: LucideIcon }> = [
    { title: "Google Search Console", copy: "Setup required", icon: CircleGauge },
    { title: "Google Analytics", copy: "Setup required", icon: Activity },
    { title: "PageSpeed Insights", copy: "API key required", icon: Gauge },
    { title: "Provider adapters", copy: "Integration required", icon: Plug },
  ];

  return (
    <section
      className={styles.integrationsSection}
      id="integrations"
      aria-labelledby="integrations-heading"
      data-motion="reveal"
    >
      <div className={styles.lowerLead}>
        <SectionLabel index="06">Integrations</SectionLabel>
        <h2 id="integrations-heading">Connect the sources you already trust.</h2>
        <Link className={styles.textLink} href="/signup">
          View integrations <ArrowRight aria-hidden="true" size={17} />
        </Link>
      </div>
      <div className={styles.integrationRail}>
        {integrations.map((integration, index) => {
          const Icon = integration.icon;
          return (
            <article key={integration.title} data-motion="reveal" data-motion-delay={index * 60}>
              <span className={styles.integrationIcon}>
                <Icon aria-hidden="true" size={24} strokeWidth={1.8} />
              </span>
              <div>
                <h3>{integration.title}</h3>
                <p>
                  <Plug aria-hidden="true" size={13} /> {integration.copy}
                </p>
              </div>
            </article>
          );
        })}
      </div>
      <p className={styles.integrationNote}>
        Availability depends on provider credentials and account eligibility. Unavailable sources
        are shown as not connected, never filled with invented data.
      </p>
    </section>
  );
}

function PricingSection() {
  return (
    <section
      className={styles.pricingSection}
      id="pricing"
      aria-labelledby="pricing-heading"
      data-motion="reveal"
    >
      <div className={styles.lowerLead}>
        <SectionLabel index="07">Pricing</SectionLabel>
        <h2 id="pricing-heading">Start with one clear audit.</h2>
        <p>{brandConfig.pricing.label}</p>
      </div>
      <div className={styles.pricingGrid}>
        {brandConfig.pricing.plans.map((plan, index) => (
          <article
            className={styles.pricingPlan}
            key={plan.name}
            data-motion="reveal"
            data-motion-delay={index * 70}
          >
            <h3>{plan.name}</h3>
            <p className={styles.planPrice}>
              <strong>{plan.price}</strong> <span>{plan.cadence}</span>
            </p>
            <ul>
              {plan.features.map((feature) => (
                <li key={feature}>
                  <Check aria-hidden="true" size={16} /> {feature}
                </li>
              ))}
            </ul>
            <Link href={plan.href}>{plan.action}</Link>
          </article>
        ))}
      </div>
      <p className={styles.pricingDisclaimer}>{brandConfig.pricing.disclaimer}</p>
    </section>
  );
}

function FaqSection() {
  return (
    <section
      className={styles.faqSection}
      id="faq"
      aria-labelledby="faq-heading"
      data-motion="reveal"
    >
      <div className={styles.lowerLead}>
        <SectionLabel index="08">FAQ</SectionLabel>
        <h2 id="faq-heading">Questions, answered clearly.</h2>
      </div>
      <div className={styles.faqList}>
        {faqItems.map((item, index) => (
          <details key={item.question} data-motion="reveal" data-motion-delay={index * 45}>
            <summary>{item.question}</summary>
            <p>{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function ClosingCtaSection() {
  return (
    <section className={styles.closingCta} aria-labelledby="closing-heading" data-motion="reveal">
      <div>
        <SectionLabel index="09">Get started</SectionLabel>
        <h2 id="closing-heading">Make your visibility path clear.</h2>
      </div>
      <div className={styles.closingFormWrap}>
        <p>Start with a free audit. Connect more data when you are ready.</p>
        <SiteCaptureForm placement="closing" />
      </div>
    </section>
  );
}

function FooterSection() {
  return (
    <footer className={styles.footer}>
      <span className={styles.footerSignal} aria-hidden="true">
        <span />
      </span>
      <div className={styles.footerBrand}>
        <Link className={styles.wordmark} href="/">
          {brandConfig.wordmark}
        </Link>
        <span>{brandConfig.tagline}</span>
      </div>
      <nav aria-label="Footer navigation">
        <Link href="#product">Product</Link>
        <Link href="#features">Features</Link>
        <Link href="#pricing">Pricing</Link>
        <Link href="/security">Security</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/contact">Contact</Link>
      </nav>
      <p>© {new Date().getFullYear()} Searvia. Demo claims are labeled.</p>
    </footer>
  );
}

export function MarketingHome() {
  const brandStyles = {
    "--brand-ink": brandConfig.colors.ink,
    "--brand-blue": brandConfig.colors.blue,
    "--brand-blue-dark": brandConfig.colors.blueDark,
    "--brand-teal": brandConfig.colors.teal,
    "--brand-violet": brandConfig.colors.violet,
  } as CSSProperties;

  return (
    <div className={styles.page} style={brandStyles}>
      <Navigation />
      <main>
        <div className={styles.heroStage}>
          <span className={styles.heroBackgroundWord} aria-hidden="true">
            visibility
          </span>
          <HeroSection />
          <ValuePropositionSection />
          <ProductPreviewSection />
        </div>
        <AuditSection />
        <ResearchSection />
        <AiVisibilitySection />
        <WorkflowSection />
        <div className={styles.lowerSections}>
          <DemoExamplesSection />
          <IntegrationsSection />
          <PricingSection />
          <FaqSection />
        </div>
        <ClosingCtaSection />
      </main>
      <FooterSection />
    </div>
  );
}
