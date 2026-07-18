"use client";

import { ArrowLeft, ArrowRight, CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  startTransition,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";

import {
  createDefaultOnboardingState,
  normalizeWebsite,
  ONBOARDING_STEP_COUNT,
  readOnboardingState,
  saveOnboardingState,
  type OnboardingState,
} from "./onboarding-state";
import {
  AuditStep,
  CompetitorsStep,
  CrawlStep,
  IntegrationsStep,
  OwnershipStep,
  WebsiteStep,
  WorkspaceStep,
  type StepErrors,
} from "./OnboardingSteps";
import { getOnboardingStep, OnboardingLoading, OnboardingShell } from "./OnboardingShell";
import styles from "./onboarding-shell.module.css";

function validateStep(state: OnboardingState): StepErrors {
  const errors: StepErrors = {};

  switch (state.currentStep) {
    case 1:
      if (state.workspace.name.trim().length < 2) {
        errors.workspaceName = "Enter a workspace name.";
      }
      if (!state.workspace.role) {
        errors.role = "Choose the role that best describes you.";
      }
      if (!state.workspace.teamSize) {
        errors.teamSize = "Choose a team size.";
      }
      break;
    case 2:
      if (state.website.projectName.trim().length < 2) {
        errors.projectName = "Enter a project name.";
      }
      if (!state.website.domain.trim()) {
        errors.domain = "Enter the website you want to audit.";
      } else {
        try {
          normalizeWebsite(state.website.domain);
        } catch (error) {
          errors.domain = error instanceof Error ? error.message : "Enter a valid website address.";
        }
      }
      break;
    case 4:
      if (
        !Number.isInteger(state.crawl.pageLimit) ||
        state.crawl.pageLimit < 1 ||
        state.crawl.pageLimit > 100
      ) {
        errors.pageLimit = "Choose a whole-number limit between 1 and 100 pages.";
      }
      if (state.crawl.delayMs < 250) {
        errors.delayMs = "Use a delay of at least 250 ms.";
      }
      if (state.crawl.concurrency < 1 || state.crawl.concurrency > 4) {
        errors.concurrency = "Choose between 1 and 4 concurrent requests.";
      }
      break;
    case 7:
      if (!state.audit.demoAcknowledged) {
        errors.demoAcknowledged = "Confirm that you understand this opens demo data.";
      }
      break;
    default:
      break;
  }

  return errors;
}

function CurrentStep({
  state,
  errors,
  setState,
}: {
  state: OnboardingState;
  errors: StepErrors;
  setState: Dispatch<SetStateAction<OnboardingState>>;
}) {
  const props = { state, errors, setState };

  switch (state.currentStep) {
    case 1:
      return <WorkspaceStep {...props} />;
    case 2:
      return <WebsiteStep {...props} />;
    case 3:
      return <OwnershipStep {...props} />;
    case 4:
      return <CrawlStep {...props} />;
    case 5:
      return <CompetitorsStep {...props} />;
    case 6:
      return <IntegrationsStep {...props} />;
    case 7:
      return <AuditStep {...props} />;
    default:
      return null;
  }
}

export function OnboardingFlow() {
  const router = useRouter();
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const [isReady, setIsReady] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [errors, setErrors] = useState<StepErrors>({});
  const [state, setState] = useState<OnboardingState>(createDefaultOnboardingState);

  useEffect(() => {
    const restoreId = window.setTimeout(() => {
      const saved = readOnboardingState();
      if (saved) setState(saved);
      setIsReady(true);
    }, 0);

    return () => window.clearTimeout(restoreId);
  }, []);

  useEffect(() => {
    if (isReady) saveOnboardingState(state);
  }, [isReady, state]);

  const updateState: Dispatch<SetStateAction<OnboardingState>> = (action) => {
    setErrors({});
    setState(action);
  };

  if (!isReady) return <OnboardingLoading />;

  const definition = getOnboardingStep(state.currentStep);
  const isFinalStep = state.currentStep === ONBOARDING_STEP_COUNT;
  const nextLabel = isFinalStep
    ? "Open demo workspace"
    : state.currentStep === 6
      ? "Review first audit"
      : "Continue";

  function moveToStep(step: number) {
    if (step > state.currentStep || step < 1) return;
    setErrors({});
    setState((current) => ({ ...current, currentStep: step }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goBack() {
    setErrors({});
    if (state.currentStep === 1) {
      const query = state.website.domain ? `?site=${encodeURIComponent(state.website.domain)}` : "";
      router.push(`/signup${query}`);
      return;
    }
    setState((current) => ({
      ...current,
      currentStep: Math.max(1, current.currentStep - 1),
    }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateStep(state);
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length) {
      window.requestAnimationFrame(() => errorSummaryRef.current?.focus());
      return;
    }

    if (isFinalStep) {
      const completed: OnboardingState = {
        ...state,
        completedAt: new Date().toISOString(),
      };
      saveOnboardingState(completed);
      setIsNavigating(true);
      startTransition(() => router.push("/demo"));
      return;
    }

    setState((current) => {
      const website =
        current.currentStep === 2
          ? {
              ...current.website,
              domain: normalizeWebsite(current.website.domain),
            }
          : current.website;

      return {
        ...current,
        website,
        currentStep: Math.min(ONBOARDING_STEP_COUNT, current.currentStep + 1),
      };
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <OnboardingShell step={state.currentStep} onSelectStep={moveToStep}>
      <form noValidate onSubmit={handleSubmit} className={styles.flowForm}>
        <div key={state.currentStep} className={styles.stepStage} data-step={state.currentStep}>
          <div className={`${styles.stepHeading} mb-7 max-w-[680px]`}>
            <p className="hidden font-mono text-[0.67rem] font-semibold uppercase tracking-[0.18em] text-[#687183] lg:block">
              Step {state.currentStep} of {ONBOARDING_STEP_COUNT}
            </p>
            <h1 className="mt-2 text-[clamp(2.25rem,5vw,4rem)] font-semibold leading-[0.98] tracking-[-0.055em] text-[#111318]">
              {definition.title}
            </h1>
            <p className="mt-4 text-[0.98rem] leading-6 text-[#626b7c]">{definition.description}</p>
          </div>

          <div
            className={`${styles.stepCard} overflow-hidden rounded-[16px] border border-[#d9dde5] bg-white shadow-[0_16px_42px_rgba(24,34,54,0.06)]`}
          >
            <div className={styles.cardScan} aria-hidden="true" />
            <div className={`${styles.stepContent} p-5 sm:p-7 lg:p-8`}>
              {Object.keys(errors).length ? (
                <div
                  ref={errorSummaryRef}
                  tabIndex={-1}
                  role="alert"
                  className="mb-6 rounded-[10px] border border-[#f0b9bf] bg-[#fff5f6] px-4 py-3 text-sm text-[#8f1f29] outline-none focus:ring-2 focus:ring-[#c71f2d]/25"
                >
                  <p className="font-semibold">Check the highlighted fields.</p>
                  <p className="mt-1 text-xs leading-5">{Object.values(errors)[0]}</p>
                </div>
              ) : null}

              <CurrentStep state={state} errors={errors} setState={updateState} />
            </div>

            <footer
              className={`${styles.stepFooter} flex flex-col-reverse gap-3 border-t border-[#e2e5eb] bg-[#fafbfc] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7 lg:px-8`}
            >
              <button
                type="button"
                onClick={goBack}
                className={`${styles.backButton} inline-flex min-h-11 items-center justify-center gap-2 rounded-[9px] border border-[#cfd5df] bg-white px-4 text-sm font-semibold text-[#424a59] transition hover:bg-[#f2f3f5] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f59ff]`}
              >
                <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                {state.currentStep === 1 ? "Back to sign up" : "Back"}
              </button>

              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
                <span className="hidden items-center gap-2 text-xs text-[#737c8d] md:inline-flex">
                  <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-[#079d91]" />
                  Progress saves automatically
                </span>
                <button
                  type="submit"
                  disabled={isNavigating}
                  className={`${styles.nextButton} inline-flex min-h-11 items-center justify-center gap-2 rounded-[9px] bg-[#1f59ff] px-5 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(31,89,255,0.18)] transition hover:bg-[#1749d8] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#1f59ff] disabled:cursor-wait disabled:opacity-70`}
                >
                  {isNavigating ? "Opening…" : nextLabel}
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
            </footer>
          </div>
        </div>
      </form>
    </OnboardingShell>
  );
}
