import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  applyWinstonPlanCommand,
  buildWinstonPlanCommandPayload,
  loadLocalWinstonPlans,
  normalizeWinstonContextOptions,
  normalizeWinstonContextSelection,
  normalizeWinstonPlan,
  resolveWinstonPlanCommand,
  saveLocalWinstonPlan,
  serializeWinstonAttachments,
  winstonContextSelectionPreview,
  WINSTON_ATTACHMENT_ACCEPT,
  WINSTON_ATTACHMENT_LIMITS,
} from './winstonAdvancedServices.js';

const CONTEXT_SECTIONS = Object.freeze([
  Object.freeze({ key: 'rooms', selectedKey: 'roomIds', label: 'Rooms', icon: 'ph-chats-circle', limit: 8 }),
  Object.freeze({ key: 'documents', selectedKey: 'documentIds', label: 'Documents', icon: 'ph-file-text', limit: 12 }),
  Object.freeze({ key: 'people', selectedKey: 'personIds', label: 'People', icon: 'ph-users-three', limit: 12 }),
]);

const ATTACHMENT_ACCEPT = `${WINSTON_ATTACHMENT_ACCEPT.join(',')},.md,.markdown,.docx,.m4a`;

function formatFileSize(bytes) {
  const size = Math.max(0, Number(bytes) || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function attachmentIcon(attachment) {
  if (attachment?.kind === 'image') return 'ph-image';
  if (attachment?.kind === 'audio') return 'ph-waveform';
  if (attachment?.mimeType === 'application/pdf') return 'ph-file-pdf';
  if (attachment?.mimeType?.includes('wordprocessingml')) return 'ph-file-doc';
  if (attachment?.mimeType === 'text/csv') return 'ph-table';
  return 'ph-file-text';
}

function attachmentStatus(attachment) {
  if (attachment?.extraction?.status === 'server-pending') {
    return attachment.kind === 'audio' ? 'Transcribes after sending' : 'Reads after sending';
  }
  if (attachment?.extraction?.status === 'truncated') return 'Text ready · long file trimmed';
  if (attachment?.kind === 'image') return 'Image ready';
  return 'Text ready';
}

function ContextOptionSection({ disabled, onToggle, options, section, selectedIds }) {
  const atLimit = selectedIds.length >= section.limit;
  return (
    <fieldset className="pa-context-picker-section">
      <legend>
        <i className={`ph-bold ${section.icon}`} aria-hidden="true" />
        {section.label}
        <span>{selectedIds.length}/{section.limit}</span>
      </legend>
      {options.length ? (
        <div className="pa-context-option-list">
          {options.map((option) => {
            const checked = selectedIds.includes(option.id);
            return (
              <label key={option.id}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled || (!checked && atLimit)}
                  onChange={() => onToggle(section.selectedKey, option.id, section.limit)}
                />
                <span>
                  <strong>{option.label}</strong>
                  {option.detail ? <small>{option.detail}</small> : null}
                </span>
              </label>
            );
          })}
        </div>
      ) : <p className="pa-context-picker-empty">No {section.label.toLowerCase()} are available here yet.</p>}
    </fieldset>
  );
}

export function WinstonContextPicker({
  currentRoomId = '',
  disabled = false,
  documents = [],
  indexStatus = null,
  onChange,
  onSyncIndex,
  people = [],
  rooms = [],
  syncingIndex = false,
  value,
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const selection = useMemo(() => normalizeWinstonContextSelection(value), [value]);
  const options = useMemo(
    () => normalizeWinstonContextOptions({ documents, people, rooms }),
    [documents, people, rooms],
  );
  const preview = useMemo(
    () => winstonContextSelectionPreview(selection, options),
    [options, selection],
  );
  const [dateDraft, setDateDraft] = useState(() => selection.dateRange || { from: '', to: '' });
  const [indexMessage, setIndexMessage] = useState('');

  const publish = useCallback((updater) => {
    const next = normalizeWinstonContextSelection(
      typeof updater === 'function' ? updater(selection) : updater,
    );
    onChange?.(next);
  }, [onChange, selection]);

  const toggle = useCallback((key, id, limit) => {
    publish((current) => {
      const exists = current[key].includes(id);
      return {
        ...current,
        [key]: exists
          ? current[key].filter((entry) => entry !== id)
          : [...current[key], id].slice(0, limit),
      };
    });
  }, [publish]);

  const updateDate = useCallback((key, date) => {
    setDateDraft((current) => {
      const next = { ...current, [key]: date };
      publish((selectionValue) => ({
        ...selectionValue,
        dateRange: next.from && next.to ? next : null,
      }));
      return next;
    });
  }, [publish]);

  const clear = useCallback(() => {
    setDateDraft({ from: '', to: '' });
    publish({
      roomIds: [],
      documentIds: [],
      personIds: [],
      dateRange: null,
      includeCurrentRoom: true,
      includeMemories: true,
      includeFullHistory: false,
    });
  }, [publish]);

  const syncIndex = useCallback(async () => {
    if (!onSyncIndex || syncingIndex) return;
    setIndexMessage('');
    try {
      const selectedRoomIds = [...new Set([
        ...(selection.includeCurrentRoom && currentRoomId ? [currentRoomId] : []),
        ...selection.roomIds,
      ])].slice(0, 8);
      const result = await onSyncIndex(selectedRoomIds);
      setIndexMessage(result?.complete === false ? 'Indexing is still in progress.' : 'Full-history index is ready.');
    } catch (error) {
      setIndexMessage(error?.message || 'The full-history index could not be updated.');
    }
  }, [currentRoomId, onSyncIndex, selection.includeCurrentRoom, selection.roomIds, syncingIndex]);

  return (
    <div className={`pa-context-picker${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="pa-context-picker-trigger"
        disabled={disabled}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => {
          if (!current) setDateDraft(selection.dateRange || { from: '', to: '' });
          return !current;
        })}
        title="Choose exactly what Winston can use"
      >
        <i className="ph-bold ph-funnel" aria-hidden="true" />
        <span>Context</span>
        <span className="pa-context-picker-count">{preview.length}</span>
      </button>
      {open ? (
        <section id={panelId} className="pa-context-picker-panel" aria-label="Choose context for Winston">
          <header>
            <span>
              <strong>Choose context</strong>
              <small>Only these selections are added to your next request.</small>
            </span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close context picker">
              <i className="ph-bold ph-x" aria-hidden="true" />
            </button>
          </header>

          <div className="pa-context-picker-toggles">
            <label>
              <input
                type="checkbox"
                checked={selection.includeCurrentRoom}
                disabled={disabled}
                onChange={(event) => publish((current) => ({ ...current, includeCurrentRoom: event.target.checked }))}
              />
              <span><strong>Current room</strong><small>Messages, tasks, events, and docs you can access</small></span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={selection.includeMemories}
                disabled={disabled}
                onChange={(event) => publish((current) => ({ ...current, includeMemories: event.target.checked }))}
              />
              <span><strong>Approved memories</strong><small>Only memories you previously saved</small></span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={selection.includeFullHistory}
                disabled={disabled}
                onChange={(event) => publish((current) => ({ ...current, includeFullHistory: event.target.checked }))}
              />
              <span><strong>Indexed full history</strong><small>Search older authorized items from your private index</small></span>
            </label>
          </div>

          {selection.includeFullHistory ? (
            <div className="pa-context-index-status" role="status">
              <span>
                <i className="ph-bold ph-database" aria-hidden="true" />
                <span>
                  <strong>{syncingIndex ? 'Updating private index…' : `${Math.max(0, Number(indexStatus?.indexed) || 0)} items indexed`}</strong>
                  <small>{indexStatus?.lastCompletedSync?.completedAt
                    ? `Last updated ${new Date(indexStatus.lastCompletedSync.completedAt).toLocaleString()}`
                    : 'Run a sync before searching older history.'}</small>
                </span>
              </span>
              {onSyncIndex ? <button type="button" onClick={syncIndex} disabled={disabled || syncingIndex}>{syncingIndex ? 'Syncing…' : 'Sync now'}</button> : null}
              {indexMessage ? <small className={indexMessage.includes('could not') ? 'is-error' : ''}>{indexMessage}</small> : null}
            </div>
          ) : null}

          <div className="pa-context-picker-scroll">
            {CONTEXT_SECTIONS.map((section) => (
              <ContextOptionSection
                key={section.key}
                disabled={disabled}
                onToggle={toggle}
                options={options[section.key]}
                section={section}
                selectedIds={selection[section.selectedKey]}
              />
            ))}
            <fieldset className="pa-context-picker-section pa-context-date-range">
              <legend><i className="ph-bold ph-calendar-blank" aria-hidden="true" /> Date range</legend>
              <div>
                <label>From<input type="date" value={dateDraft.from} max={dateDraft.to || undefined} onChange={(event) => updateDate('from', event.target.value)} disabled={disabled} /></label>
                <label>To<input type="date" value={dateDraft.to} min={dateDraft.from || undefined} onChange={(event) => updateDate('to', event.target.value)} disabled={disabled} /></label>
              </div>
            </fieldset>
          </div>

          <div className="pa-context-picker-preview">
            <span><i className="ph-bold ph-eye" aria-hidden="true" /> Winston can use</span>
            <div>
              {preview.length
                ? preview.map((chip) => <span key={chip.id} className={`is-${chip.kind}`}>{chip.label}</span>)
                : <small>No workspace context selected. Winston will use only your prompt and attachments.</small>}
            </div>
          </div>
          <footer>
            <button type="button" onClick={clear} disabled={disabled}>Reset</button>
            <button type="button" className="is-primary" onClick={() => setOpen(false)}>Use this context</button>
          </footer>
        </section>
      ) : null}
    </div>
  );
}

export function WinstonAttachmentComposerTools({
  attachments = [],
  disabled = false,
  error = '',
  onRemove,
  onSelectFiles,
  processing = false,
}) {
  const pickerRef = useRef(null);
  const cameraRef = useRef(null);
  const safeAttachments = useMemo(() => serializeWinstonAttachments(attachments), [attachments]);
  const chooseFiles = useCallback((event) => {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    if (files.length) onSelectFiles?.(files);
  }, [onSelectFiles]);

  return (
    <div className="ai-attachment-tools">
      {safeAttachments.length ? (
        <div className="ai-attachment-list" aria-label="Files attached to this request">
          {safeAttachments.map((attachment) => {
            const original = attachments.find((entry) => entry.id === attachment.id) || attachment;
            return (
              <article key={attachment.id} className={`ai-attachment-preview is-${attachment.kind}`}>
                <span className="ai-attachment-thumbnail">
                  {original.previewUrl && attachment.kind === 'image'
                    ? <img src={original.previewUrl} alt="" />
                    : <i className={`ph-bold ${attachmentIcon(attachment)}`} aria-hidden="true" />}
                </span>
                <span>
                  <strong title={attachment.name}>{attachment.name}</strong>
                  <small>{formatFileSize(attachment.size)} · {attachmentStatus(attachment)}</small>
                </span>
                <button type="button" onClick={() => onRemove?.(attachment.id)} aria-label={`Remove ${attachment.name}`} disabled={disabled}>
                  <i className="ph-bold ph-x" aria-hidden="true" />
                </button>
              </article>
            );
          })}
        </div>
      ) : null}
      <div className="ai-attachment-buttons">
        <button
          type="button"
          onClick={() => pickerRef.current?.click()}
          disabled={disabled || processing || safeAttachments.length >= WINSTON_ATTACHMENT_LIMITS.count}
          title="Attach documents, text, audio, or images"
          aria-label={processing ? 'Preparing files' : 'Attach files'}
        >
          <i className={`ph-bold ${processing ? 'ph-spinner-gap' : 'ph-paperclip'}`} aria-hidden="true" />
          <span>{processing ? 'Preparing…' : 'Files'}</span>
        </button>
        <button
          type="button"
          onClick={() => cameraRef.current?.click()}
          disabled={disabled || processing || safeAttachments.length >= WINSTON_ATTACHMENT_LIMITS.count}
          title="Take a photo"
          aria-label="Take a photo"
        >
          <i className="ph-bold ph-camera" aria-hidden="true" />
          <span>Camera</span>
        </button>
        <input ref={pickerRef} type="file" accept={ATTACHMENT_ACCEPT} multiple onChange={chooseFiles} hidden />
        <input ref={cameraRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={chooseFiles} hidden />
      </div>
      {error ? <span className="ai-image-error" role="alert">{error}</span> : null}
    </div>
  );
}

const PLAN_STATUS_LABELS = Object.freeze({
  pending: 'Not started',
  awaiting_confirmation: 'Needs confirmation',
  running: 'In progress',
  paused: 'Paused',
  completed: 'Complete',
  failed: 'Needs attention',
  cancelled: 'Cancelled',
  undone: 'Reopened',
  skipped: 'Skipped',
});

function planProgress(plan) {
  const settled = plan.steps.filter((step) => ['completed', 'cancelled', 'undone', 'skipped'].includes(step.status)).length;
  return { settled, total: plan.steps.length, percent: Math.round((settled / plan.steps.length) * 100) };
}

function stepCommands(step) {
  if (['pending', 'awaiting_confirmation'].includes(step.status)) {
    return [
      ...(step.requiresConfirmation
        ? [{ command: 'confirm-step', label: 'Confirm step', icon: 'ph-check' }]
        : [{ command: 'complete-step', label: 'Mark done', icon: 'ph-check-circle' }]),
      { command: 'skip-step', label: 'Skip', icon: 'ph-skip-forward' },
      { command: 'cancel', label: 'Cancel', icon: 'ph-x' },
    ];
  }
  if (step.status === 'running') {
    return [
      ...(!step.requiresConfirmation ? [{ command: 'complete-step', label: 'Mark done', icon: 'ph-check-circle' }] : []),
      { command: 'pause', label: 'Pause', icon: 'ph-pause' },
      { command: 'skip-step', label: 'Skip', icon: 'ph-skip-forward' },
      { command: 'cancel', label: 'Cancel', icon: 'ph-x' },
    ];
  }
  if (step.status === 'paused') {
    return [
      { command: 'resume', label: 'Resume', icon: 'ph-play' },
      ...(!step.requiresConfirmation ? [{ command: 'complete-step', label: 'Mark done', icon: 'ph-check-circle' }] : []),
      { command: 'skip-step', label: 'Skip', icon: 'ph-skip-forward' },
      { command: 'cancel', label: 'Cancel', icon: 'ph-x' },
    ];
  }
  if (step.status === 'failed') {
    return [
      { command: 'retry', label: 'Retry', icon: 'ph-arrows-clockwise' },
      { command: 'skip-step', label: 'Skip', icon: 'ph-skip-forward' },
      { command: 'cancel', label: 'Cancel', icon: 'ph-x' },
    ];
  }
  if (['cancelled', 'undone'].includes(step.status)) {
    return [{ command: 'retry', label: 'Reopen', icon: 'ph-arrow-counter-clockwise' }];
  }
  if (
    step.status === 'completed'
    && !step.requiresConfirmation
    && step.canUndo
    && (!step.undoExpiresAt || step.undoExpiresAt > Date.now())
  ) {
    return [{ command: 'undo', label: 'Reopen', icon: 'ph-arrow-counter-clockwise' }];
  }
  return [];
}

export function WinstonPlanCard({
  disabled = false,
  onCommand,
  onPlanChange,
  persist = true,
  plan: planValue,
}) {
  const normalizedInput = useMemo(() => normalizeWinstonPlan(planValue), [planValue]);
  const [localPlan, setLocalPlan] = useState(normalizedInput);
  const [pendingStepId, setPendingStepId] = useState('');
  const [error, setError] = useState('');

  const plan = useMemo(() => {
    if (!localPlan) return normalizedInput;
    if (!normalizedInput) return localPlan;
    return normalizedInput.revision > localPlan.revision || normalizedInput.updatedAt > localPlan.updatedAt
      ? normalizedInput
      : localPlan;
  }, [localPlan, normalizedInput]);

  const publish = useCallback((next) => {
    const normalized = normalizeWinstonPlan(next);
    if (!normalized) return null;
    setLocalPlan(normalized);
    if (persist) saveLocalWinstonPlan(normalized);
    onPlanChange?.(normalized);
    return normalized;
  }, [onPlanChange, persist]);

  const runCommand = useCallback(async (step, command) => {
    if (!plan || pendingStepId || disabled) return;
    const payload = buildWinstonPlanCommandPayload(plan.id, step.id, command);
    setPendingStepId(step.id);
    setError('');
    try {
      const response = onCommand ? await onCommand(payload, { plan, step }) : null;
      publish(resolveWinstonPlanCommand(plan, response, payload) || applyWinstonPlanCommand(plan, payload));
    } catch (commandError) {
      setError(commandError?.message || 'Winston could not update this step.');
    } finally {
      setPendingStepId('');
    }
  }, [disabled, onCommand, pendingStepId, plan, publish]);

  if (!plan) return null;
  const progress = planProgress(plan);
  return (
    <section className={`pa-plan-card is-${plan.status}`} aria-label={`Plan: ${plan.title}`}>
      <header>
        <span className="pa-plan-icon"><i className="ph-bold ph-list-checks" aria-hidden="true" /></span>
        <span>
          <small>Resumable plan</small>
          <strong>{plan.title}</strong>
          {plan.summary ? <p>{plan.summary}</p> : null}
        </span>
        <span className={`pa-plan-status is-${plan.status}`}>{PLAN_STATUS_LABELS[plan.status] || 'Plan'}</span>
      </header>
      <div className="pa-plan-progress" aria-label={`${progress.settled} of ${progress.total} steps settled`}>
        <span style={{ width: `${progress.percent}%` }} />
      </div>
      <ol className="pa-plan-steps">
        {plan.steps.map((step, index) => {
          const commands = stepCommands(step);
          const pending = pendingStepId === step.id;
          return (
            <li key={step.id} className={`is-${step.status}`}>
              <span className="pa-plan-step-index">
                {step.status === 'completed'
                  ? <i className="ph-bold ph-check" aria-hidden="true" />
                  : step.status === 'failed'
                    ? <i className="ph-bold ph-warning" aria-hidden="true" />
                    : index + 1}
              </span>
              <div className="pa-plan-step-copy">
                <span>
                  <strong>{step.title}</strong>
                  <small className={`is-${step.status}`}>{PLAN_STATUS_LABELS[step.status] || step.status}</small>
                </span>
                {step.description && step.description !== step.title ? <p>{step.description}</p> : null}
                {step.resultSummary ? <p className="pa-plan-step-result"><i className="ph-bold ph-check-circle" aria-hidden="true" /> {step.resultSummary}</p> : null}
                {step.error ? <p className="pa-plan-step-error" role="alert">{step.error}</p> : null}
                {commands.length ? (
                  <div className="pa-plan-step-actions">
                    {commands.map((item, commandIndex) => (
                      <button
                        key={item.command}
                        type="button"
                        className={commandIndex === 0 ? 'is-primary' : ''}
                        disabled={disabled || Boolean(pendingStepId)}
                        onClick={() => runCommand(step, item.command)}
                      >
                        <i className={`ph-bold ${pending && commandIndex === 0 ? 'ph-spinner-gap' : item.icon}`} aria-hidden="true" />
                        {pending && commandIndex === 0 ? 'Updating…' : item.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      {error ? <p className="pa-plan-error" role="alert">{error}</p> : null}
      <footer><i className="ph-bold ph-shield-check" aria-hidden="true" /> Executable steps always ask first. Reopen applies only to descriptive steps and never claims to reverse an external write.</footer>
    </section>
  );
}

export function WinstonResumablePlans({ active = false, disabled = false, onCommand, onPlanChange }) {
  const [plans, setPlans] = useState(() => (
    loadLocalWinstonPlans().filter((plan) => !['completed', 'cancelled'].includes(plan.status))
  ));

  const updatePlan = useCallback((next) => {
    setPlans((current) => current.map((plan) => plan.id === next.id ? next : plan));
    onPlanChange?.(next);
  }, [onPlanChange]);

  if (!active || !plans.length) return null;
  return (
    <section className="pa-resumable-plans" aria-label="Resumable Winston plans">
      <div className="pa-memory-heading">
        <span><i className="ph-bold ph-list-checks" aria-hidden="true" /><span><strong>Resume plans</strong><small>Continue safely from the last settled step.</small></span></span>
        <span className="ai-memory-sync">{plans.length}</span>
      </div>
      {plans.map((plan) => (
        <WinstonPlanCard
          key={plan.id}
          disabled={disabled}
          onCommand={onCommand}
          onPlanChange={updatePlan}
          plan={plan}
        />
      ))}
    </section>
  );
}
