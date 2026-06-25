export default function WelcomeTour({ onNext, onSkip, step, stepIndex, totalSteps }) {
  const last = stepIndex === totalSteps - 1;

  return (
    <div className="wt-card">
      <div className="wt-emoji" id="wt-emoji">{step.emoji}</div>
      <h2 id="wt-title">{step.title}</h2>
      <p id="wt-text">{step.text}</p>
      <div className="wt-dots" id="wt-dots" aria-label={`Step ${stepIndex + 1} of ${totalSteps}`}>
        {Array.from({ length: totalSteps }, (_, index) => (
          <span key={index} className={`wt-dot ${index === stepIndex ? 'on' : ''}`} />
        ))}
      </div>
      <div className="wt-actions">
        {!last ? (
          <button type="button" id="wt-skip" className="wt-skip" onClick={onSkip}>Skip</button>
        ) : null}
        <button type="button" id="wt-next" className="wt-next" onClick={onNext}>
          {last ? 'Enter Rooms' : (stepIndex === 0 ? 'Take a quick tour' : 'Next')}
        </button>
      </div>
    </div>
  );
}
