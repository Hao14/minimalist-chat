import type { Metadata } from "next";

import SearviaProduct from "@/components/product/SearviaProduct";

export const metadata: Metadata = {
  title: "Product demonstration",
  description: "Explore Searvia's deterministic product demonstration data.",
  robots: { index: false, follow: false },
};

export default function DemoPage() {
  return <SearviaProduct />;
}
