export function BootSequence({ lines, visibleCount, completedCount }) {
  const visible = lines.slice(0, visibleCount);

  return (
    <>
      {visible.map((line, index) => {
        const complete = index < completedCount;
        const lineNumber = String(index + 1).padStart(2, '0');
        return (
          <div id={`boot-line-${index}`} className={`boot-line ${complete ? 'is-complete' : ''}`} key={`${line.scope}-${line.action}-${line.target}`}>
            <span className="boot-line-no">{lineNumber}</span>
            <span className="boot-status">{complete ? 'ok' : 'run'}</span>
            <span className="boot-code">
              <span className="boot-key">{line.scope}</span>
              <span className="boot-punc">.</span>
              <span className="boot-fn">{line.action}</span>
              <span className="boot-punc">(</span>
              <span className="boot-string">"{line.target}"</span>
              <span className="boot-punc">)</span>
              <span className="boot-muted"> // {line.note}</span>
            </span>
            {!complete ? <span className="boot-cursor" /> : null}
          </div>
        );
      })}
    </>
  );
}
