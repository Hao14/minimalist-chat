import styles from "@/components/product/searvia-product.module.css";

export default function DemoLoading() {
  return (
    <main className={styles.loadingScreen} aria-label="Loading Searvia demo">
      <div className={styles.loadingBrand}>
        <span aria-hidden="true">s</span>
        <strong>searvia</strong>
      </div>
      <div className={styles.loadingTrack}>
        <span />
      </div>
      <p>Preparing your visibility workspace…</p>
    </main>
  );
}
