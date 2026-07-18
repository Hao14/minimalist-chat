import type { Metadata } from "next";

import { MarketingHome } from "@/components/marketing/MarketingHome";
import { brandConfig } from "@/config/brand";

export const metadata: Metadata = {
  title: `${brandConfig.name} — ${brandConfig.tagline}`,
  description: brandConfig.description,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    url: "/",
  },
};

export default function Home() {
  return <MarketingHome />;
}
