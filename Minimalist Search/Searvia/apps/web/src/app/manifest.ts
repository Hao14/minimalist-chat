import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Searvia",
    short_name: "Searvia",
    description: "Search visibility, made clear.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#4650d6",
    icons: [
      {
        src: "/searvia-mark.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
