import styles from "./boot-sequence.module.css";

export function BootSequence() {
  return (
    <div
      className={styles.boot}
      role="status"
      aria-live="polite"
      aria-label="Preparing Searvia"
      data-boot-sequence
    >
      <div className={styles.instrument} aria-hidden="true">
        <span className={styles.tick} />
        <span className={styles.tick} />
        <span className={styles.tick} />
      </div>
      <div className={styles.lockup}>
        <svg className={styles.mark} viewBox="0 0 72 72" fill="none" aria-hidden="true">
          <path
            className={styles.pathBlue}
            d="M60 12H30C18 12 12 18 12 26s6 14 18 14h12c12 0 18 6 18 14s-6 14-18 14H14"
          />
          <path
            className={styles.pathTeal}
            d="M62 18H31c-8 0-12 3-12 8s4 8 12 8h11c16 0 24 8 24 20S58 72 42 72H10"
          />
          <circle className={styles.point} cx="42" cy="40" r="6" />
        </svg>
        <span className={styles.wordmark}>searvia</span>
        <span className={styles.label}>mapping visibility paths</span>
      </div>
    </div>
  );
}
