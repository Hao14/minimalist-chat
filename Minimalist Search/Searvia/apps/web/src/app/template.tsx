import type { ReactNode } from "react";

export default function GlobalRouteTemplate({ children }: { children: ReactNode }) {
  return <div data-motion="page">{children}</div>;
}
