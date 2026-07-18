"use client";

import { useEffect, useRef } from "react";

type DemoCounterProps = {
  value: number;
  prefix?: string;
  suffix?: string;
};

const numberFormatter = new Intl.NumberFormat("en-US");

type MotionSubscriber = () => void;

const motionSubscribers = new Set<MotionSubscriber>();
let motionAttributeObserver: MutationObserver | null = null;

function subscribeToMotionAttributes(subscriber: MotionSubscriber) {
  motionSubscribers.add(subscriber);

  if (motionAttributeObserver === null && typeof MutationObserver !== "undefined") {
    motionAttributeObserver = new MutationObserver(() => {
      motionSubscribers.forEach((notify) => notify());
    });
    motionAttributeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-motion-mode", "data-motion-ready"],
    });
  }

  return () => {
    motionSubscribers.delete(subscriber);
    if (motionSubscribers.size === 0) {
      motionAttributeObserver?.disconnect();
      motionAttributeObserver = null;
    }
  };
}

function hasConstrainedHardware() {
  const navigatorWithHints = navigator as Navigator & {
    connection?: { saveData?: boolean };
    deviceMemory?: number;
  };

  return (
    navigatorWithHints.connection?.saveData === true ||
    (typeof navigatorWithHints.deviceMemory === "number" && navigatorWithHints.deviceMemory <= 4) ||
    (navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4)
  );
}

function formatCounter(value: number, prefix: string, suffix: string) {
  return `${prefix}${numberFormatter.format(value)}${suffix}`;
}

export function DemoCounter({ value, prefix = "", suffix = "" }: DemoCounterProps) {
  const elementRef = useRef<HTMLSpanElement>(null);
  const animatedKeyRef = useRef<string | null>(null);
  const finalText = formatCounter(value, prefix, suffix);

  useEffect(() => {
    let timer = 0;
    const animationKey = `${value}:${prefix}:${suffix}`;

    const renderValue = (nextValue: number) => {
      const element = elementRef.current;
      if (element) element.textContent = formatCounter(nextValue, prefix, suffix);
    };

    const finishCounter = () => {
      window.clearInterval(timer);
      timer = 0;
      renderValue(value);
    };

    const startCounter = () => {
      const element = elementRef.current;
      const root = document.documentElement;
      const motionIsReady = root.dataset.motionReady === "true";
      const fullMotion = root.dataset.motionMode === "full";

      if (!element || !motionIsReady || !fullMotion) {
        finishCounter();
        return;
      }

      if (hasConstrainedHardware() || animatedKeyRef.current === animationKey) {
        finishCounter();
        return;
      }

      animatedKeyRef.current = animationKey;
      const startedAt = performance.now();
      const duration = 960;
      renderValue(0);

      window.clearInterval(timer);
      timer = window.setInterval(() => {
        const now = performance.now();
        const progress = Math.min((now - startedAt) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 4);
        renderValue(Math.round(value * eased));

        if (progress >= 1) finishCounter();
      }, 60);
    };

    renderValue(value);
    startCounter();
    const unsubscribe = subscribeToMotionAttributes(startCounter);

    return () => {
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [prefix, suffix, value]);

  return (
    <>
      <span ref={elementRef} aria-hidden="true">
        {finalText}
      </span>
      <span className="sr-only">{finalText}</span>
    </>
  );
}
