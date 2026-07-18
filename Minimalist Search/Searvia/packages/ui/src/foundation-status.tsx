import type { ReactNode } from "react";

export interface FoundationStatusProps {
  readonly children?: ReactNode;
  readonly heading: string;
  readonly headingId: string;
  readonly label?: string;
}

/**
 * An unstyled, accessible status primitive for honest pre-release product states.
 * Applications own its visual treatment so this package does not couple to a CSS system.
 */
export function FoundationStatus({
  children,
  heading,
  headingId,
  label = "Foundation state",
}: FoundationStatusProps) {
  return (
    <section aria-labelledby={headingId} data-searvia-ui="foundation-status">
      <p>{label}</p>
      <h2 id={headingId}>{heading}</h2>
      {children}
    </section>
  );
}
