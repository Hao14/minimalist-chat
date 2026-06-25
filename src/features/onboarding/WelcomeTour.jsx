import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const SPOT_PAD = 10;
const CARD_GAP = 18;

const MODE_OPTIONS = [
  {
    id: 'simple',
    emoji: '🌿',
    tag: 'Calm & focused',
    label: 'Simple Mode',
    blurb: 'Just the essentials — rooms, messages, files, search, and settings. Nothing extra competing for attention.',
    points: ['Rooms & chat', 'Files & search', 'A quiet, clean layout'],
  },
  {
    id: 'power',
    emoji: '⚡',
    tag: 'Everything unlocked',
    label: 'Power Mode',
    blurb: 'Everything in Simple, plus the full toolkit for teams and communities that want to do more in one place.',
    points: ['Tasks, docs & whiteboard', 'Events, polls & calendar', 'AI tools, analytics & memory'],
  },
];

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);

function isVisible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const r = el.getBoundingClientRect();
  return r.width > 1 && r.height > 1;
}

// Choose a placement that fits in the viewport, falling back through the others.
function placeCard(rect, preferred, card) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const fits = {
    bottom: rect.top + rect.height + CARD_GAP + card.height <= vh,
    top: rect.top - CARD_GAP - card.height >= 0,
    right: rect.left + rect.width + CARD_GAP + card.width <= vw,
    left: rect.left - CARD_GAP - card.width >= 0,
  };
  const actual = fits[preferred] ? preferred : (['bottom', 'right', 'top', 'left'].find((p) => fits[p]) || preferred);

  let top;
  let left;
  if (actual === 'bottom' || actual === 'top') {
    left = rect.left + rect.width / 2 - card.width / 2;
    top = actual === 'bottom' ? rect.top + rect.height + CARD_GAP : rect.top - CARD_GAP - card.height;
  } else {
    top = rect.top + rect.height / 2 - card.height / 2;
    left = actual === 'right' ? rect.left + rect.width + CARD_GAP : rect.left - CARD_GAP - card.width;
  }

  left = Math.max(12, Math.min(left, vw - card.width - 12));
  top = Math.max(12, Math.min(top, vh - card.height - 12));

  // Point the arrow at the target's centre, clamped inside the card.
  const arrowX = Math.max(18, Math.min(rect.left + rect.width / 2 - left, card.width - 18));
  const arrowY = Math.max(18, Math.min(rect.top + rect.height / 2 - top, card.height - 18));

  return { top, left, actual, arrowX, arrowY };
}

export default function WelcomeTour({ steps = [], onClose }) {
  const startMode = (typeof window !== 'undefined' && window.getFeatureMode?.()) || 'simple';
  const [phase, setPhase] = useState('mode'); // 'mode' | 'tour' | 'done'
  const [mode, setMode] = useState(startMode);
  const [order, setOrder] = useState([]); // indices of steps with visible targets
  const [pos, setPos] = useState(0);
  const [rect, setRect] = useState(null);
  const [card, setCard] = useState({ top: -9999, left: -9999, actual: 'bottom', arrowX: 24, arrowY: 24 });
  const cardRef = useRef(null);
  const reduce = prefersReducedMotion();

  const step = phase === 'tour' ? steps[order[pos]] : null;

  const finish = useCallback(() => { setPhase('done'); }, []);

  const startTour = useCallback(() => {
    window.setFeatureMode?.(mode);
    // Let the mode's body class apply so hidden tabs report their real visibility.
    // Steps with a `before` hook can reveal their own target, so always keep them.
    requestAnimationFrame(() => {
      const visible = steps.map((_, i) => i).filter((i) => {
        if (steps[i].when && !steps[i].when()) return false;
        return steps[i].before || isVisible(document.querySelector(steps[i].target));
      });
      if (!visible.length) { setPhase('done'); return; }
      setOrder(visible);
      setPos(0);
      setPhase('tour');
    });
  }, [mode, steps]);

  const goNext = useCallback(() => { setPos((p) => (p >= order.length - 1 ? (finish(), p) : p + 1)); }, [order.length, finish]);
  const goBack = useCallback(() => { setPos((p) => Math.max(0, p - 1)); }, []);

  // Measure the current target and position the spotlight + coachmark.
  useLayoutEffect(() => {
    if (phase !== 'tour' || !step) return undefined;
    let raf = 0;
    const measure = () => {
      const el = document.querySelector(step.target);
      if (!isVisible(el)) { goNext(); return; }
      const r = el.getBoundingClientRect();
      const next = { top: r.top, left: r.left, width: r.width, height: r.height };
      const size = cardRef.current
        ? { width: cardRef.current.offsetWidth, height: cardRef.current.offsetHeight }
        : { width: 340, height: 220 };
      setRect(next);
      setCard(placeCard(next, step.placement || 'bottom', size));
    };

    // Some steps prepare the UI (e.g. switch to the chat view) before measuring.
    step.before?.();
    const el = document.querySelector(step.target);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    measure();

    const onMove = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [phase, step, pos, reduce, goNext]);

  // Keyboard navigation.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') { onClose?.(); return; }
      if (phase !== 'tour') return;
      if (event.key === 'ArrowRight' || event.key === 'Enter') { event.preventDefault(); goNext(); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); goBack(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, goNext, goBack, onClose]);

  if (phase === 'tour' && step) {
    const last = pos === order.length - 1;
    return (
      <div className="wt-root wt-root-tour" role="dialog" aria-modal="true" aria-label="Product tour">
        <div className="wt-blocker" />
        {rect ? (
          <div
            className="wt-spotlight"
            style={{ top: rect.top - SPOT_PAD, left: rect.left - SPOT_PAD, width: rect.width + SPOT_PAD * 2, height: rect.height + SPOT_PAD * 2 }}
          />
        ) : null}
        <div
          ref={cardRef}
          className={`wt-coachmark wt-place-${card.actual}`}
          style={{ top: card.top, left: card.left, '--wt-arrow-x': `${card.arrowX}px`, '--wt-arrow-y': `${card.arrowY}px` }}
        >
          <div className="wt-coach-emoji" aria-hidden="true">{step.emoji}</div>
          <span className="wt-coach-kicker">Step {pos + 1} of {order.length}</span>
          <h3>{step.title}</h3>
          <p>{step.text}</p>
          <div className="wt-dots" aria-hidden="true">
            {order.map((stepIdx, i) => <span key={stepIdx} className={`wt-dot ${i === pos ? 'on' : ''}`} />)}
          </div>
          <div className="wt-coach-actions">
            <button type="button" className="wt-ghost" onClick={onClose}>Skip</button>
            <div className="wt-coach-nav">
              {pos > 0 ? <button type="button" className="wt-ghost" onClick={goBack}>Back</button> : null}
              <button type="button" className="wt-primary" autoFocus onClick={last ? finish : goNext}>
                {last ? 'Finish' : 'Next'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'done') {
    return (
      <div className="wt-root wt-root-modal" role="dialog" aria-modal="true" aria-label="Tour complete">
        <div className="wt-backdrop">
          <div className="wt-modal wt-done">
            <div className="wt-done-emoji" aria-hidden="true">🎉</div>
            <h2>You&rsquo;re all set</h2>
            <p className="wt-sub">
              You&rsquo;re in <strong>{mode === 'power' ? 'Power' : 'Simple'} Mode</strong>. Everything you just saw is one click away — and you can switch modes anytime in Settings.
            </p>
            <button type="button" className="wt-primary wt-cta" autoFocus onClick={onClose}>Start exploring</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="wt-root wt-root-modal" role="dialog" aria-modal="true" aria-label="Choose your experience">
      <div className="wt-backdrop">
        <div className="wt-modal wt-mode">
          <span className="wt-badge">Welcome 👋</span>
          <h2>How do you want to start?</h2>
          <p className="wt-sub">Pick how much you want to see right now. This only changes what&rsquo;s on screen — you can switch anytime in Settings.</p>
          <div className="wt-mode-grid">
            {MODE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`wt-mode-card ${mode === option.id ? 'selected' : ''}`}
                aria-pressed={mode === option.id}
                onClick={() => setMode(option.id)}
              >
                <span className="wt-mode-check" aria-hidden="true">✓</span>
                <span className="wt-mode-emoji" aria-hidden="true">{option.emoji}</span>
                <span className="wt-mode-tag">{option.tag}</span>
                <strong>{option.label}</strong>
                <span className="wt-mode-blurb">{option.blurb}</span>
                <ul>{option.points.map((point) => <li key={point}>{point}</li>)}</ul>
              </button>
            ))}
          </div>
          <div className="wt-modal-actions">
            <button type="button" className="wt-ghost" onClick={onClose}>Skip tour</button>
            <button type="button" className="wt-primary wt-cta" onClick={startTour}>Start the tour →</button>
          </div>
        </div>
      </div>
    </div>
  );
}
