import './winstonTrustIndicators.css';

function safePercent(value) {
  const directPercent = Number(value?.percent);
  if (Number.isFinite(directPercent)) return Math.max(0, Math.min(100, Math.round(directPercent)));
  const ratio = Number(value?.ratio ?? value);
  return Number.isFinite(ratio) ? Math.max(0, Math.min(100, Math.round(ratio * 100))) : null;
}

function routeLabel(receipt) {
  if (receipt?.routeBlocked) return 'Route blocked';
  if (receipt?.provider === 'local') return 'PC only';
  if (receipt?.provider === 'cloudflare') return 'Cloudflare';
  if (receipt?.provider === 'groq') return 'Groq';
  return 'Protected route';
}

function verificationLabel(report) {
  if (report?.status === 'verified' || report?.fullySupported) return 'Verified';
  if (report?.status === 'issues_found') return 'Needs verification';
  if (report?.status === 'review_needed') return 'Partly verified';
  return 'No factual claims';
}

export function WinstonTrustIndicators({
  contextReceipt = null,
  routeReceipt = null,
  verification = null,
}) {
  const claims = Array.isArray(verification?.claims) ? verification.claims.slice(0, 24) : [];
  const coverage = safePercent(verification?.coverage);
  if (!contextReceipt && !routeReceipt && !verification) return null;
  return (
    <section className="pa-trust-indicators" aria-label="Winston answer checks">
      <div className="pa-trust-chip-row">
        {routeReceipt ? (
          <span className={`pa-trust-chip is-route${routeReceipt.localOnly ? ' is-private' : ''}`}>
            <i className={`ph-bold ${routeReceipt.localOnly ? 'ph-shield-check' : 'ph-git-fork'}`} aria-hidden="true" />
            {routeLabel(routeReceipt)}
          </span>
        ) : null}
        {verification ? (
          <span className={`pa-trust-chip is-${verification.status || 'empty'}`}>
            <i className={`ph-bold ${verification.fullySupported ? 'ph-seal-check' : 'ph-magnifying-glass'}`} aria-hidden="true" />
            {verificationLabel(verification)}
            {claims.length && coverage !== null ? ` · ${coverage}%` : ''}
          </span>
        ) : null}
        {contextReceipt ? (
          <span className="pa-trust-chip is-context">
            <i className="ph-bold ph-funnel" aria-hidden="true" />
            {contextReceipt.includeFullHistory ? 'Indexed history' : 'Selected context'}
            {Number(contextReceipt.sourceCount) > 0 ? ` · ${contextReceipt.sourceCount} sources` : ''}
          </span>
        ) : null}
      </div>
      {routeReceipt?.localOnly && Array.isArray(routeReceipt.categories) && routeReceipt.categories.length ? (
        <p className="pa-trust-note">
          <i className="ph-bold ph-lock-key" aria-hidden="true" />
          Winston detected sensitive content and kept this request on your PC.
        </p>
      ) : null}
      {claims.length ? (
        <details className="pa-verification-details">
          <summary>Review claim checks</summary>
          <ol>
            {claims.map((claim) => (
              <li key={claim.id} className={`is-${claim.status || 'uncertain'}`}>
                <i
                  className={`ph-bold ${
                    claim.status === 'supported'
                      ? 'ph-check-circle'
                      : claim.status === 'unsupported'
                        ? 'ph-warning-circle'
                        : 'ph-question'
                  }`}
                  aria-hidden="true"
                />
                <span>
                  <strong>{claim.status === 'supported' ? 'Supported' : claim.status === 'unsupported' ? 'Unsupported' : 'Uncertain'}</strong>
                  <small>{claim.text}</small>
                  {Array.isArray(claim.evidenceIds) && claim.evidenceIds.length
                    ? <em>{claim.evidenceIds.map((id) => `[${id}]`).join(' ')}</em>
                    : null}
                </span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}

export default WinstonTrustIndicators;
