import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InfoPage } from "@/components/info/InfoPage";

const features = {
  "site-audit": {
    title: "Technical audits with reproducible evidence.",
    description:
      "Crawl important paths, understand what was checked, and move from issue to verified fix without losing the evidence trail.",
    sections: [
      {
        title: "Crawl safely",
        body: "Respect robots.txt, crawl budgets, scope rules, and rate limits while recording every response and redirect.",
      },
      {
        title: "Prioritize clearly",
        body: "Group findings by severity, category, lifecycle, affected URLs, source, and confidence.",
      },
      {
        title: "Verify the change",
        body: "Compare crawls to see new and fixed issues, score movement, and the exact pages that changed.",
      },
    ],
  },
  "keyword-research": {
    title: "Find the search demand worth pursuing.",
    description:
      "Build focused keyword lists and connect licensed data providers when you are ready to evaluate demand and difficulty.",
    sections: [
      {
        title: "Collect ideas",
        body: "Bring together topics, questions, and landing-page opportunities in one working set.",
      },
      {
        title: "Connect licensed data",
        body: "Searvia never fabricates volume or difficulty. Metrics appear only when a supported provider is connected.",
      },
      {
        title: "Move into action",
        body: "Turn selected opportunities into tracked keywords, content briefs, and page improvements.",
      },
    ],
  },
  "rank-tracking": {
    title: "Track position changes with context.",
    description:
      "Monitor connected ranking data across locations and devices, then tie movement back to pages and site changes.",
    sections: [
      {
        title: "Choose the market",
        body: "Configure country, language, location, device, and cadence for every tracking campaign.",
      },
      {
        title: "See the movement",
        body: "Review gains, losses, landing-page changes, and cannibalization with observation dates attached.",
      },
      {
        title: "Keep coverage honest",
        body: "Every metric includes its source, observation date, and known coverage limitations.",
      },
    ],
  },
  "competitor-analysis": {
    title: "See where competitors are gaining ground.",
    description:
      "Compare domains, pages, and connected keyword datasets without aggressively crawling sites you do not control.",
    sections: [
      {
        title: "Compare domains",
        body: "Frame a consistent view of search competitors across the markets that matter to your project.",
      },
      {
        title: "Find gaps",
        body: "Surface keyword and page opportunities supported by licensed provider data and limited public analysis.",
      },
      {
        title: "Respect boundaries",
        body: "Competitor research remains rate-limited, provider-backed, and clear about what was not checked.",
      },
    ],
  },
  backlinks: {
    title: "Understand the links shaping authority.",
    description:
      "Connect a backlink provider to monitor referring domains, anchors, new and lost links, and competitive gaps.",
    sections: [
      {
        title: "Provider-backed intelligence",
        body: "Backlink rows appear only from a connected licensed source—never from invented demonstration metrics.",
      },
      {
        title: "Changes over time",
        body: "Review new and lost links with snapshot dates and source coverage shown beside every view.",
      },
      {
        title: "Prioritize outreach",
        body: "Use link gaps and page context to focus research without turning estimates into promises.",
      },
    ],
  },
  "ai-visibility": {
    title: "See when AI answers mention and cite you.",
    description:
      "Run saved prompts through connected provider APIs and preserve answer evidence, mentions, sources, and sentiment context.",
    sections: [
      {
        title: "Monitor prompts",
        body: "Define repeatable question sets by market, audience, and intent, then schedule supported provider runs.",
      },
      {
        title: "Preserve the evidence",
        body: "Store answers, cited URLs, timestamps, provider names, and run versions for every observation.",
      },
      {
        title: "Find the next path",
        body: "Compare cited competitors and uncover content or technical opportunities without guaranteeing a citation.",
      },
    ],
  },
} as const;

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(features).map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const feature = features[slug as keyof typeof features];
  if (!feature) return {};

  return {
    title: feature.title,
    description: feature.description,
    alternates: {
      canonical: `/features/${slug}`,
    },
    openGraph: {
      title: feature.title,
      description: feature.description,
      url: `/features/${slug}`,
    },
  };
}

export default async function FeaturePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const feature = features[slug as keyof typeof features];
  if (!feature) notFound();

  return (
    <InfoPage
      eyebrow={
        slug === "site-audit"
          ? "Bounded public crawling live · audit findings planned"
          : "Planned capability · not yet available"
      }
      {...feature}
    />
  );
}
