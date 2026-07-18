import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InfoPage } from "@/components/info/InfoPage";

const pages = {
  pricing: {
    title: "Start with one clear audit.",
    description:
      "Choose a configurable demonstration plan, then confirm current limits and availability before purchase.",
    sections: [
      {
        title: "Starter · $0/month",
        body: "Demonstration plan: one project and up to 500 pages per audit.",
      },
      {
        title: "Growth · $79/month",
        body: "Demonstration plan: five projects, 25,000 pages per month, and rank tracking.",
      },
      {
        title: "Agency · $199/month",
        body: "Demonstration plan: 25 projects, client reports, and a priority crawl queue.",
      },
    ],
  },
  about: {
    title: "A clearer path through search visibility.",
    description:
      "Searvia brings technical evidence, rankings, competitors, links, and AI-search citations into one honest workspace.",
    sections: [
      {
        title: "Why Searvia",
        body: "Search visibility now spans websites, traditional results, connected data providers, and AI-generated answers.",
      },
      {
        title: "Evidence before claims",
        body: "We separate live observations, connected-provider data, demonstration data, and checks that could not run.",
      },
      {
        title: "Built to expand",
        body: "The product can grow across audit, keywords, rank, competitors, links, AI visibility, and reports without narrowing the brand.",
      },
    ],
  },
  security: {
    title: "Security belongs in every visibility path.",
    description:
      "Searvia is designed around tenant boundaries, safe crawling, protected credentials, and a traceable audit history.",
    sections: [
      {
        title: "Tenant isolation",
        body: "Protected queries and mutations verify organization membership and project access on the server.",
      },
      {
        title: "Safe crawling",
        body: "Crawl systems must defend against SSRF, DNS rebinding, private addresses, unsafe redirects, and oversized responses.",
      },
      {
        title: "Operational controls",
        body: "Secure cookies, encrypted credentials, signed webhooks, rate limits, audit logs, backups, and deletion workflows form the baseline.",
      },
    ],
  },
  privacy: {
    title: "Privacy, stated plainly.",
    description:
      "This design build does not collect production customer data. Final policy language must match the deployed service and providers.",
    sections: [
      {
        title: "Data you choose to connect",
        body: "Project settings, crawl results, and provider integrations should be collected only for the service a workspace requests.",
      },
      {
        title: "Credentials stay protected",
        body: "Integration secrets must remain encrypted, excluded from public environment variables, and absent from crawler logs.",
      },
      {
        title: "Control and retention",
        body: "A production release must document export, deletion, retention, subprocessors, and regional handling before launch.",
      },
    ],
  },
  terms: {
    title: "Terms that match the real product.",
    description:
      "This page is product-design copy, not final legal advice. Production terms must be reviewed before Searvia is offered publicly.",
    sections: [
      {
        title: "Use the crawler responsibly",
        body: "Users must control or be authorized to audit a site and must respect applicable laws, robots policies, and provider terms.",
      },
      {
        title: "No guaranteed outcomes",
        body: "Searvia does not guarantee ranking increases, traffic, backlink growth, or citations in AI-generated answers.",
      },
      {
        title: "Connected services",
        body: "Third-party datasets and providers remain subject to their own availability, coverage, and terms.",
      },
    ],
  },
  contact: {
    title: "Tell us what you need to see clearly.",
    description:
      "The contact channel is not active yet. These are the conversation paths planned for a later public release.",
    sections: [
      {
        title: "Product and audit",
        body: "Questions about projects, crawl scope, issue evidence, and reporting.",
      },
      {
        title: "Security and privacy",
        body: "Questions about tenant boundaries, data handling, providers, and safe crawling.",
      },
      {
        title: "Partnerships and integrations",
        body: "Questions about connecting licensed search, backlink, analytics, and AI-search providers.",
      },
    ],
  },
} as const;

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(pages).map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = pages[slug as keyof typeof pages];
  if (!page) return {};

  return {
    title: page.title,
    description: page.description,
    alternates: {
      canonical: `/${slug}`,
    },
    openGraph: {
      title: page.title,
      description: page.description,
      url: `/${slug}`,
    },
  };
}

export default async function StaticInfoPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = pages[slug as keyof typeof pages];
  if (!page) notFound();
  return <InfoPage eyebrow="Searvia" decorativeMotion={slug !== "pricing"} {...page} />;
}
