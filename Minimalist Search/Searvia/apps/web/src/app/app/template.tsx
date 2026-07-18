import type { ReactNode } from "react";

import styles from "@/components/application/application-shell.module.css";

export default function ApplicationTemplate({ children }: { children: ReactNode }) {
  return (
    <div className={styles.routeFrame} data-motion="route">
      {children}
    </div>
  );
}
