export const brandConfig = {
  name: "Searvia",
  wordmark: "searvia",
  pronunciation: "SEER-vee-uh",
  tagline: "Search visibility, made clear.",
  actionTagline: "Audit. Rank. Get cited.",
  homepageHeadline: "Find what is limiting your search visibility.",
  description:
    "Crawl your website, uncover technical problems, and understand what search engines and AI retrieval systems can access.",
  callsToAction: {
    primary: "Start a site audit",
    secondary: "Explore the platform",
  },
  colors: {
    ink: "#0B0E12",
    blue: "#0A6FDB",
    blueDark: "#4650D6",
    teal: "#0B7568",
    violet: "#5661E3",
  },
  pricing: {
    label: "Configurable demonstration pricing",
    disclaimer:
      "Illustrative monthly pricing only. Plans, limits, taxes, and billing are confirmed before purchase; no charge is created from this page.",
    plans: [
      {
        name: "Starter",
        price: "$0",
        cadence: "/ month",
        action: "Preview Starter",
        href: "/signup",
        features: ["Illustrative: 1 project", "Illustrative: 500 pages per audit"],
      },
      {
        name: "Growth",
        price: "$79",
        cadence: "/ month",
        action: "Preview Growth",
        href: "/signup?plan=growth",
        features: [
          "Illustrative: 5 projects",
          "Illustrative: 25,000 pages per month",
          "Planned: rank tracking",
        ],
      },
      {
        name: "Agency",
        price: "$199",
        cadence: "/ month",
        action: "Preview Agency",
        href: "/signup?plan=agency",
        features: [
          "Illustrative: 25 projects",
          "Planned: client reports",
          "Planned: priority crawl queue",
        ],
      },
    ],
  },
} as const;
