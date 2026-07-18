import { ArrowLeft, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { BrandMark } from "./BrandMark";
import styles from "./auth-shell.module.css";

interface AuthShellProps {
  children: ReactNode;
  mode: "login" | "signup";
}

const proofPoints = [
  "Technical SEO and crawl evidence",
  "Search and AI visibility in one view",
  "Clear next actions, without invented metrics",
];

export function AuthShell({ children, mode }: AuthShellProps) {
  return (
    <main className={`${styles.shell} min-h-svh bg-white text-[#111318]`}>
      <div className="grid min-h-svh lg:grid-cols-[minmax(420px,0.94fr)_minmax(520px,1.06fr)]">
        <section
          className={`${styles.visual} hidden min-h-svh border-r border-[#dfe3eb] px-10 py-9 lg:sticky lg:top-0 lg:flex lg:h-svh lg:self-start lg:flex-col xl:px-16 xl:py-12`}
          aria-label="Searvia product introduction"
        >
          <svg
            className={styles.authRouteCanvas}
            aria-hidden="true"
            viewBox="0 0 820 900"
            preserveAspectRatio="none"
            fill="none"
          >
            <path
              className={styles.authRouteBase}
              d="M52 68H302C390 68 390 128 390 184V244C390 302 438 302 506 302H626C682 302 700 332 700 390V520C700 576 650 576 596 576H226C144 576 76 620 76 702V792H650"
            />
            <path
              className={styles.authRoutePulse}
              d="M52 68H302C390 68 390 128 390 184V244C390 302 438 302 506 302H626C682 302 700 332 700 390V520C700 576 650 576 596 576H226C144 576 76 620 76 702V792H650"
            />
            <path
              className={styles.authRouteBaseSecondary}
              d="M76 792H586C656 792 684 756 684 698V642"
            />
            <path
              className={styles.authRoutePulseSecondary}
              d="M76 792H586C656 792 684 756 684 698V642"
            />
            <g className={styles.authRouteNode}>
              <circle cx="52" cy="68" r="15" fill="#fff" stroke="#1f59ff" strokeWidth="2" />
              <circle cx="52" cy="68" r="6" fill="#1f59ff" />
            </g>
            <g className={styles.authRouteNodeSecondary}>
              <circle cx="700" cy="520" r="11" fill="#fff" stroke="#0aa99e" strokeWidth="2" />
              <circle cx="700" cy="520" r="4" fill="#0aa99e" />
            </g>
          </svg>

          <BrandMark />

          <div className="relative z-10 my-auto max-w-[560px] py-20" data-motion="hero">
            <p className="mb-6 font-mono text-[0.7rem] font-medium uppercase tracking-[0.22em] text-[#596276]">
              Search visibility, made clear.
            </p>
            <h2 className="max-w-[12ch] text-[clamp(3.25rem,5.2vw,5.75rem)] font-semibold leading-[0.94] tracking-[-0.065em]">
              Find the signal in every search path.
            </h2>
            <p className="mt-7 max-w-[49ch] text-[1.04rem] leading-7 text-[#596276]">
              Audit your site, see the evidence, and understand where your brand is visible across
              search and AI answers.
            </p>

            <ul className="mt-9 space-y-3.5" aria-label="Product highlights">
              {proofPoints.map((point, index) => (
                <li
                  key={point}
                  className={`${styles.proofPoint} flex items-center gap-3 text-sm text-[#313846]`}
                  data-motion="reveal"
                  data-motion-delay={index * 55}
                >
                  <CheckCircle2
                    aria-hidden="true"
                    className="h-[18px] w-[18px] text-[#079d91]"
                    strokeWidth={1.8}
                  />
                  {point}
                </li>
              ))}
            </ul>
          </div>

          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-[34%] w-full"
            viewBox="0 0 820 420"
            preserveAspectRatio="none"
            fill="none"
          >
            <path
              className={styles.path}
              d="M-50 365C128 371 128 245 282 249C433 253 385 109 552 111C690 113 683 31 878 23"
              stroke="#1f59ff"
              strokeWidth="1.6"
            />
            <path
              className={styles.path}
              d="M-49 388C129 394 144 269 289 272C443 276 407 135 563 137C704 139 705 60 878 48"
              stroke="#0aa99e"
              strokeWidth="1.25"
            />
            <g className={styles.beacon}>
              <circle cx="282" cy="249" r="9" fill="#fff" stroke="#1f59ff" strokeWidth="3" />
              <circle cx="282" cy="249" r="3.5" fill="#1f59ff" />
            </g>
          </svg>

          <span className={styles.visibilityWord} aria-hidden="true">
            visibility
          </span>
        </section>

        <section className={`${styles.formSide} flex min-h-svh flex-col bg-white`}>
          <div className={styles.formSignalRail} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <header
            className={`${styles.formHeader} flex h-[76px] items-center justify-between border-b border-[#e5e8ee] px-5 sm:px-8 lg:border-b-0 lg:px-12 xl:px-16`}
          >
            <BrandMark className="lg:hidden" />
            <Link
              href="/"
              className="ml-auto inline-flex min-h-11 items-center gap-2 text-sm font-medium text-[#4f586b] transition-colors hover:text-[#111318] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1f59ff] lg:ml-0"
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              Back to website
            </Link>
            <p className="hidden text-sm text-[#6c7484] lg:block">
              {mode === "login" ? "New to Searvia?" : "Already have an account?"}{" "}
              <Link
                href={mode === "login" ? "/signup" : "/login"}
                className="font-semibold text-[#1555f5] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#1f59ff]"
              >
                {mode === "login" ? "Create an account" : "Sign in"}
              </Link>
            </p>
          </header>

          <div
            className={`${styles.formStage} flex flex-1 items-center justify-center px-5 py-10 sm:px-8 lg:px-12 lg:py-14 xl:px-16`}
            data-motion="route"
          >
            <div className={`${styles.formContainer} w-full max-w-[472px]`}>{children}</div>
          </div>
        </section>
      </div>
    </main>
  );
}
