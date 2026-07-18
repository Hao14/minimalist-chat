import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { BootSequence } from "@/components/brand/BootSequence";
import { MotionObserver } from "@/components/motion/MotionObserver";
import { clientEnvironment } from "@/lib/client-environment";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(clientEnvironment.siteUrl),
  title: {
    default: "Searvia — Search visibility, made clear.",
    template: "%s · Searvia",
  },
  description:
    "Crawl your website, uncover technical problems, and understand what search engines and AI retrieval systems can access.",
  applicationName: "Searvia",
  keywords: ["technical SEO audit", "rank tracking", "AI search visibility", "competitor analysis"],
  icons: {
    icon: "/searvia-mark.svg",
    shortcut: "/searvia-mark.svg",
    apple: "/searvia-mark.svg",
  },
  openGraph: {
    type: "website",
    title: "Searvia — Search visibility, made clear.",
    description:
      "Find what is limiting your search visibility across search engines and AI retrieval systems.",
  },
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} h-full antialiased`}
      data-scroll-behavior="smooth"
      data-motion-ready="false"
      suppressHydrationWarning
    >
      <body className="min-h-full">
        <BootSequence />
        <MotionObserver />
        {children}
      </body>
    </html>
  );
}
