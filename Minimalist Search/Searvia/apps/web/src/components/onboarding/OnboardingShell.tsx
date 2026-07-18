import {
  Building2,
  Check,
  Globe2,
  Link2,
  PlugZap,
  Rocket,
  ShieldCheck,
  SlidersHorizontal,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { BrandMark } from "@/components/auth/BrandMark";
import { ONBOARDING_STEP_COUNT } from "./onboarding-state";
import styles from "./onboarding-shell.module.css";

interface StepDefinition {
  title: string;
  shortTitle: string;
  description: string;
  icon: LucideIcon;
}

export const ONBOARDING_STEPS: readonly StepDefinition[] = [
  {
    title: "Create your workspace",
    shortTitle: "Workspace",
    description: "Set the home for your projects and team.",
    icon: Building2,
  },
  {
    title: "Add your website",
    shortTitle: "Website",
    description: "Define the site and market you want to understand.",
    icon: Globe2,
  },
  {
    title: "Choose an ownership path",
    shortTitle: "Ownership",
    description: "Plan verification for a future limited public crawl.",
    icon: ShieldCheck,
  },
  {
    title: "Shape the first crawl",
    shortTitle: "Crawl settings",
    description: "Set safe limits and decide how Searvia should explore.",
    icon: SlidersHorizontal,
  },
  {
    title: "Add the sites you compare",
    shortTitle: "Competitors",
    description: "Keep the comparison focused and intentional.",
    icon: UsersRound,
  },
  {
    title: "Plan your integrations",
    shortTitle: "Integrations",
    description: "See which data sources unlock each visibility view.",
    icon: PlugZap,
  },
  {
    title: "Your first visibility path",
    shortTitle: "First audit",
    description: "Review the setup, then explore the clearly labeled demo.",
    icon: Rocket,
  },
];

export function getOnboardingStep(step: number): StepDefinition {
  const definition = ONBOARDING_STEPS[step - 1];

  if (!definition) {
    throw new RangeError(`Unknown onboarding step: ${step}`);
  }

  return definition;
}

export function OnboardingLoading() {
  return (
    <main className={`${styles.shell} grid min-h-svh place-items-center bg-white text-[#111318]`}>
      <div className="flex flex-col items-center text-center" role="status" aria-live="polite">
        <BrandMark showSymbol />
        <div className={`${styles.loadingLine} mt-7 rounded-full`} aria-hidden="true" />
        <p className="mt-4 text-sm text-[#687183]">Restoring your setup…</p>
      </div>
    </main>
  );
}

export function OnboardingShell({
  step,
  onSelectStep,
  children,
}: {
  step: number;
  onSelectStep: (step: number) => void;
  children: ReactNode;
}) {
  const activeDefinition = getOnboardingStep(step);

  return (
    <main className={`${styles.shell} ${styles.canvas} min-h-svh text-[#111318]`}>
      <header
        className={`${styles.onboardingHeader} sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-[#dfe3ea] bg-white/95 px-5 backdrop-blur sm:px-8 lg:px-10`}
      >
        <BrandMark showSymbol />
        <div
          className={`${styles.savedBadge} flex items-center gap-2 text-xs font-medium text-[#697284]`}
        >
          <span className="grid h-5 w-5 place-items-center rounded-full bg-[#e8f7f5] text-[#078c82]">
            <Check aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.3} />
          </span>
          Saved locally
        </div>
        <div className={styles.headerSignal} aria-hidden="true">
          <span />
          <span />
        </div>
      </header>

      <div
        className={`${styles.layout} mx-auto grid min-h-[calc(100svh-72px)] max-w-[1480px] lg:grid-cols-[286px_minmax(0,1fr)]`}
      >
        <aside
          className={`${styles.stepAside} hidden border-r border-[#dfe3ea] bg-white px-7 py-10 lg:block`}
        >
          <p className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.18em] text-[#7a8393]">
            Setup path
          </p>
          <nav className={`${styles.stepNavigation} mt-7`} aria-label="Onboarding progress">
            <ol className="space-y-1.5">
              {ONBOARDING_STEPS.map((definition, index) => {
                const stepNumber = index + 1;
                const isCurrent = stepNumber === step;
                const isComplete = stepNumber < step;
                const isAvailable = stepNumber <= step;
                const Icon = definition.icon;

                return (
                  <li key={definition.shortTitle} className={`${styles.stepItem} relative`}>
                    {index < ONBOARDING_STEPS.length - 1 ? (
                      <span
                        aria-hidden="true"
                        className={`${styles.stepConnector} absolute left-[17px] top-10 h-[18px] w-px ${isComplete ? styles.stepConnectorComplete : "bg-[#d8dde6]"}`}
                      />
                    ) : null}
                    <button
                      type="button"
                      disabled={!isAvailable}
                      onClick={() => onSelectStep(stepNumber)}
                      aria-current={isCurrent ? "step" : undefined}
                      className={`${styles.stepButton} group flex min-h-11 w-full items-center gap-3 rounded-[9px] px-2.5 text-left text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f59ff] ${
                        isCurrent
                          ? `${styles.stepButtonCurrent} bg-[#eef2ff] text-[#144bd8]`
                          : isComplete
                            ? `${styles.stepButtonComplete} text-[#2b3341] hover:bg-[#f5f6f8]`
                            : `${styles.stepButtonLocked} cursor-not-allowed text-[#9ba2ae]`
                      }`}
                    >
                      <span
                        className={`${styles.stepIcon} grid h-7 w-7 shrink-0 place-items-center rounded-full border ${
                          isCurrent
                            ? "border-[#1f59ff] bg-[#1f59ff] text-white"
                            : isComplete
                              ? "border-[#8fcac4] bg-[#edf9f7] text-[#078c82]"
                              : "border-[#d8dde6] bg-white text-[#9ba2ae]"
                        }`}
                      >
                        {isComplete ? (
                          <Check aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.4} />
                        ) : (
                          <Icon aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.9} />
                        )}
                      </span>
                      <span>{definition.shortTitle}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          <div className="mt-10 border-t border-[#e4e7ed] pt-6">
            <div className="flex items-start gap-3">
              <Link2
                aria-hidden="true"
                className="mt-0.5 h-4 w-4 shrink-0 text-[#1f59ff]"
                strokeWidth={1.8}
              />
              <p className="text-xs leading-5 text-[#697284]">
                Your choices stay in this browser until a live account service is connected.
              </p>
            </div>
          </div>
        </aside>

        <section
          className={`${styles.stepCanvas} relative min-w-0 px-4 py-6 sm:px-8 sm:py-10 lg:px-12 lg:py-12 xl:px-16`}
        >
          <svg
            aria-hidden="true"
            className={`${styles.pathCanvas} pointer-events-none absolute right-0 top-0 hidden h-36 w-[46%] opacity-80 md:block`}
            viewBox="0 0 650 150"
            preserveAspectRatio="none"
            fill="none"
          >
            <path
              className={styles.path}
              d="M671 16C521 13 524 90 408 90C289 90 294 128 162 128C84 128 33 105 -20 89"
              stroke="#1f59ff"
              strokeWidth="1.5"
            />
            <path
              className={styles.pathPacket}
              d="M671 16C521 13 524 90 408 90C289 90 294 128 162 128C84 128 33 105 -20 89"
              stroke="#1f59ff"
              strokeWidth="3"
            />
            <path
              className={styles.path}
              d="M671 36C530 33 526 108 412 108C292 108 292 146 160 146C84 146 27 123 -20 109"
              stroke="#0aa99e"
              strokeWidth="1.1"
            />
            <g className={styles.dot}>
              <circle cx="408" cy="90" r="7" fill="#fff" stroke="#1f59ff" strokeWidth="2.4" />
              <circle cx="408" cy="90" r="2.3" fill="#1f59ff" />
            </g>
          </svg>

          <div className="relative z-10 mx-auto max-w-[900px]">
            <div
              className={`${styles.mobileStepMeta} mb-5 flex items-center justify-between lg:hidden`}
            >
              <span className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[#596276]">
                Step {step} of {ONBOARDING_STEP_COUNT}
              </span>
              <span className="text-xs font-semibold text-[#1f59ff]">
                {activeDefinition.shortTitle}
              </span>
            </div>
            <div
              className={`${styles.mobileProgress} mb-8 h-1.5 overflow-hidden rounded-full bg-[#e2e6ed] lg:hidden`}
              role="progressbar"
              aria-label="Onboarding progress"
              aria-valuemin={1}
              aria-valuemax={ONBOARDING_STEP_COUNT}
              aria-valuenow={step}
            >
              <span
                className={`${styles.mobileProgressFill} block h-full rounded-full bg-gradient-to-r from-[#1f59ff] to-[#0aa99e] transition-[width] duration-300`}
                style={{ width: `${(step / ONBOARDING_STEP_COUNT) * 100}%` }}
              />
            </div>
            {children}
          </div>
        </section>
      </div>
    </main>
  );
}
