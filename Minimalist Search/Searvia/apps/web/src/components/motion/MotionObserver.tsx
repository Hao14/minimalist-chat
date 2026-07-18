"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import styles from "./motion-observer.module.css";

type MotionKind = "fade" | "hero" | "page" | "reveal" | "route";
type MotionPreference = "system" | "full" | "reduced";
type EffectiveMotionMode = "full" | "reduced";
type MotionBudget = "normal" | "low";

type MotionDefinition = {
  distance: number;
  duration: number;
  scale: number;
};

type MotionModeDetail = {
  mode: EffectiveMotionMode;
  preference: MotionPreference;
};

const motionDefinitions: Record<MotionKind, MotionDefinition> = {
  fade: { distance: 0, duration: 440, scale: 0.99 },
  hero: { distance: 42, duration: 860, scale: 0.97 },
  page: { distance: 0, duration: 360, scale: 1 },
  reveal: { distance: 30, duration: 640, scale: 0.985 },
  route: { distance: 24, duration: 460, scale: 0.99 },
};

const motionSelector = "[data-motion]";
const storageKey = "searvia-motion-preference";

function getMotionKind(value: string | undefined): MotionKind {
  if (value === "fade" || value === "hero" || value === "page" || value === "route") return value;
  return "reveal";
}

function getDelay(value: string | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(parsed, 0), 600);
}

function isMotionPreference(value: string | null): value is MotionPreference {
  return value === "system" || value === "full" || value === "reduced";
}

function resolveMotionMode(
  preference: MotionPreference,
  systemReduced: boolean,
): EffectiveMotionMode {
  if (preference === "full") return "full";
  if (preference === "reduced") return "reduced";
  return systemReduced ? "reduced" : "full";
}

function resolveMotionBudget(): MotionBudget {
  const navigatorWithHints = navigator as Navigator & {
    connection?: { saveData?: boolean };
    deviceMemory?: number;
  };
  const hasLimitedCpu =
    typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency <= 4;
  const hasLimitedMemory =
    typeof navigatorWithHints.deviceMemory === "number" && navigatorWithHints.deviceMemory <= 4;
  const requestsLessData = navigatorWithHints.connection?.saveData === true;
  const hasSlowDisplayUpdates = window.matchMedia("(update: slow)").matches;

  return hasLimitedCpu || hasLimitedMemory || requestsLessData || hasSlowDisplayUpdates
    ? "low"
    : "normal";
}

export function MotionObserver() {
  const pathname = usePathname();
  const progressRailRef = useRef<HTMLDivElement>(null);
  const [preference, setPreference] = useState<MotionPreference>("system");
  const [systemReduced, setSystemReduced] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(false);
  const effectiveMode = resolveMotionMode(preference, systemReduced);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let storedPreference: string | null = null;
    try {
      storedPreference = window.localStorage.getItem(storageKey);
    } catch {
      // Storage can be unavailable in locked-down browser contexts; use the safe context default.
    }
    const localPreview =
      window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    const initialPreference = isMotionPreference(storedPreference)
      ? storedPreference
      : localPreview
        ? "full"
        : "system";
    const initialMode = resolveMotionMode(initialPreference, media.matches);
    const root = document.documentElement;

    root.dataset.motionPreference = initialPreference;
    root.dataset.motionMode = initialMode;
    root.dataset.motionBudget = resolveMotionBudget();

    const hydrationFrame = window.requestAnimationFrame(() => {
      setPreference(initialPreference);
      setSystemReduced(media.matches);
      setHasHydrated(true);
    });

    const handleSystemPreference = (event: MediaQueryListEvent) => {
      setSystemReduced(event.matches);
    };

    media.addEventListener("change", handleSystemPreference);
    return () => {
      window.cancelAnimationFrame(hydrationFrame);
      media.removeEventListener("change", handleSystemPreference);
    };
  }, []);

  useEffect(() => {
    if (!hasHydrated) return;

    const root = document.documentElement;
    root.dataset.motionPreference = preference;
    root.dataset.motionMode = effectiveMode;
    try {
      window.localStorage.setItem(storageKey, preference);
    } catch {
      // The control still works for the current page when storage is unavailable.
    }
    window.dispatchEvent(
      new CustomEvent<MotionModeDetail>("searvia:motion-mode", {
        detail: { mode: effectiveMode, preference },
      }),
    );
  }, [effectiveMode, hasHydrated, preference]);

  useEffect(() => {
    const root = document.documentElement;
    const activeAnimations = new Set<Animation>();
    const seenElements = new WeakSet<HTMLElement>();
    const staticOnlyElements = new Set<HTMLElement>();
    const bootSequence = document.querySelector<HTMLElement>("[data-boot-sequence]");
    let currentMode: EffectiveMotionMode = root.dataset.motionMode === "full" ? "full" : "reduced";
    let observer: IntersectionObserver | null = null;
    let mutations: MutationObserver | null = null;
    let firstFrame = 0;
    let secondFrame = 0;
    let bootFallback = 0;
    let observationStarted = false;

    const markStatic = (element: HTMLElement) => {
      if (!seenElements.has(element)) staticOnlyElements.add(element);
      seenElements.add(element);
      element.dataset.motionSeen = "true";
    };

    const play = (element: HTMLElement) => {
      if (seenElements.has(element)) return;
      if (currentMode !== "full" || !("animate" in HTMLElement.prototype)) {
        markStatic(element);
        return;
      }

      seenElements.add(element);

      const kind = getMotionKind(element.dataset.motion);
      const definition = motionDefinitions[kind];
      const lowBudget = root.dataset.motionBudget === "low";
      const delay = lowBudget
        ? Math.min(getDelay(element.dataset.motionDelay), 120)
        : getDelay(element.dataset.motionDelay);
      const keyframes: Keyframe[] =
        kind === "page"
          ? [{ opacity: 0.24 }, { offset: 0.72, opacity: 1 }, { opacity: 1 }]
          : [
              {
                opacity: kind === "fade" ? 0.18 : 0,
                transform: `translate3d(0, ${definition.distance}px, 0) scale(${definition.scale})`,
              },
              {
                offset: 0.78,
                opacity: 1,
                transform: "translate3d(0, -2px, 0) scale(1.002)",
              },
              {
                opacity: 1,
                transform: "translate3d(0, 0, 0) scale(1)",
              },
            ];
      const animation = element.animate(keyframes, {
        delay,
        duration: lowBudget ? Math.min(definition.duration, 460) : definition.duration,
        easing: kind === "route" ? "cubic-bezier(0.16, 1, 0.3, 1)" : "cubic-bezier(0, 0, 0, 1)",
        fill: "backwards",
      });

      activeAnimations.add(animation);
      void animation.finished
        .then(() => {
          if (element.isConnected) element.dataset.motionSeen = "true";
        })
        .catch(() => undefined)
        .finally(() => activeAnimations.delete(animation));
    };

    const observeElement = (element: HTMLElement) => {
      if (seenElements.has(element)) return;
      if (currentMode === "reduced" || observer === null) {
        markStatic(element);
        return;
      }
      observer.observe(element);
    };

    const observeTree = (treeRoot: ParentNode) => {
      if (treeRoot instanceof HTMLElement && treeRoot.matches(motionSelector)) {
        observeElement(treeRoot);
      }
      treeRoot.querySelectorAll<HTMLElement>(motionSelector).forEach(observeElement);
    };

    const forgetStaticTree = (treeRoot: ParentNode) => {
      if (treeRoot instanceof HTMLElement) staticOnlyElements.delete(treeRoot);
      treeRoot
        .querySelectorAll<HTMLElement>(motionSelector)
        .forEach((element) => staticOnlyElements.delete(element));
    };

    if ("IntersectionObserver" in window) {
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const element = entry.target as HTMLElement;
            observer?.unobserve(element);
            play(element);
          }
        },
        { rootMargin: "0px 0px -8%", threshold: 0.12 },
      );
    }

    const applyMode = (nextMode: EffectiveMotionMode) => {
      currentMode = nextMode;
      if (!observationStarted) return;

      if (nextMode === "reduced") {
        observer?.disconnect();
        for (const animation of activeAnimations) animation.cancel();
        activeAnimations.clear();
        document.querySelectorAll<HTMLElement>(motionSelector).forEach(markStatic);
        return;
      }

      for (const element of staticOnlyElements) {
        if (!element.isConnected) continue;
        seenElements.delete(element);
        delete element.dataset.motionSeen;
      }
      staticOnlyElements.clear();
      observeTree(document);
    };

    const handleMotionMode = (event: Event) => {
      const detail = (event as CustomEvent<MotionModeDetail>).detail;
      applyMode(detail.mode);
    };

    const startObserving = () => {
      if (observationStarted) return;
      observationStarted = true;
      window.clearTimeout(bootFallback);
      root.dataset.bootComplete = "true";
      root.dataset.motionReady = "true";
      currentMode = root.dataset.motionMode === "full" ? "full" : "reduced";
      observeTree(document);

      mutations = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node instanceof HTMLElement) observeTree(node);
          }
          for (const node of record.removedNodes) {
            if (node instanceof HTMLElement) forgetStaticTree(node);
          }
        }
      });
      mutations.observe(document.body, { childList: true, subtree: true });
    };

    const queueObservationStart = () => {
      if (observationStarted || firstFrame !== 0) return;
      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(startObserving);
      });
    };

    const handleBootComplete = (event: AnimationEvent) => {
      if (event.target !== bootSequence) return;
      bootSequence?.removeEventListener("animationend", handleBootComplete);
      queueObservationStart();
    };

    root.dataset.motionReady = "false";
    window.addEventListener("searvia:motion-mode", handleMotionMode);

    const bootIsRunning =
      bootSequence?.getAnimations().some((animation) => animation.playState !== "finished") ??
      false;
    if (bootSequence !== null && bootIsRunning) {
      bootSequence.addEventListener("animationend", handleBootComplete);
      bootFallback = window.setTimeout(queueObservationStart, 950);
    } else {
      queueObservationStart();
    }

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      window.clearTimeout(bootFallback);
      bootSequence?.removeEventListener("animationend", handleBootComplete);
      window.removeEventListener("searvia:motion-mode", handleMotionMode);
      mutations?.disconnect();
      observer?.disconnect();
      for (const animation of activeAnimations) animation.cancel();
    };
  }, []);

  useEffect(() => {
    const rail = progressRailRef.current;
    if (rail === null) return;

    const overlaysDisabled = pathname === "/demo" || pathname === "/pricing";
    if (overlaysDisabled) {
      rail.dataset.active = "false";
      return;
    }

    let updateFrame = 0;
    let measureFrame = 0;
    let scrollRange = 0;
    let railTravel = 0;
    let isActive = false;

    const updateProgress = () => {
      updateFrame = 0;
      const progress = isActive ? Math.min(Math.max(window.scrollY / scrollRange, 0), 1) : 0;
      const offset = progress * railTravel;

      rail.style.setProperty("--page-scroll-progress", progress.toFixed(4));
      rail.style.setProperty("--page-scroll-offset", `${offset.toFixed(2)}px`);
    };

    const requestProgressUpdate = () => {
      if (updateFrame !== 0) return;
      updateFrame = window.requestAnimationFrame(updateProgress);
    };

    const measureProgress = () => {
      measureFrame = 0;
      scrollRange = Math.max(document.documentElement.scrollHeight - window.innerHeight, 0);
      railTravel = Math.max(rail.clientHeight - 12, 0);
      const nextActive = scrollRange > 160;
      if (nextActive !== isActive) {
        isActive = nextActive;
        rail.dataset.active = isActive ? "true" : "false";
      }
      updateProgress();
    };

    const requestProgressMeasure = () => {
      if (measureFrame !== 0) return;
      measureFrame = window.requestAnimationFrame(measureProgress);
    };

    requestProgressMeasure();
    const resizeObserver =
      "ResizeObserver" in window ? new ResizeObserver(requestProgressMeasure) : null;
    resizeObserver?.observe(document.documentElement);
    resizeObserver?.observe(rail);
    window.addEventListener("scroll", requestProgressUpdate, { passive: true });
    window.addEventListener("resize", requestProgressMeasure);

    return () => {
      window.cancelAnimationFrame(updateFrame);
      window.cancelAnimationFrame(measureFrame);
      resizeObserver?.disconnect();
      window.removeEventListener("scroll", requestProgressUpdate);
      window.removeEventListener("resize", requestProgressMeasure);
    };
  }, [pathname]);

  const choosePreference = (nextPreference: MotionPreference) => {
    setPreference(nextPreference);
  };

  return (
    <>
      <div className={styles.progressRail} ref={progressRailRef} aria-hidden="true">
        <span className={styles.progressFill} />
        <span className={styles.progressNode} />
      </div>
      <aside className={styles.motionDock} aria-label="Motion preference">
        <span className={styles.motionStatus} aria-live="polite">
          <span className={styles.signalDot} aria-hidden="true" />
          Motion
          <span className={styles.effectiveMode}>{effectiveMode}</span>
        </span>
        <span className={styles.motionOptions} role="group" aria-label="Choose motion level">
          {(["system", "full", "reduced"] as const).map((option) => (
            <button
              className={styles.motionOption}
              data-active={preference === option ? "true" : "false"}
              type="button"
              aria-pressed={preference === option}
              onClick={() => choosePreference(option)}
              key={option}
            >
              {option === "reduced" ? "Still" : option[0]?.toUpperCase() + option.slice(1)}
            </button>
          ))}
        </span>
      </aside>
    </>
  );
}
