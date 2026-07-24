import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createPersonalAiMemoryOnServer,
  deletePersonalAiMemoryFromServer,
  loadPersonalAiMemoriesFromServer,
  updatePersonalAiMemoryOnServer,
} from './localAiClient.js';
import {
  aiActionPresentation,
  aiActionSuccessMessage,
  confirmedAiActionFromResponse,
  createLocalAiMemory,
  deleteLocalAiMemory,
  loadLocalAiMemories,
  normalizeAiActions,
  normalizeAiClarification,
  normalizeAiMemories,
  normalizeAiSources,
  openAiSourceContext,
  updateLocalAiMemory,
} from './aiAgentUi.js';

function compactDateTime(value) {
  const timestamp = Number(value || 0);
  if (!timestamp) return '';
  try {
    return new Intl.DateTimeFormat([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(timestamp));
  } catch {
    return '';
  }
}

function sourceTypeLabel(type) {
  return {
    message: 'Message',
    task: 'Task',
    document: 'Document',
    doc: 'Document',
    event: 'Event',
    room: 'Room',
    weather: 'Weather source',
    webpage: 'Web page',
    file: 'Attached file',
    audio: 'Audio transcript',
  }[type] || 'Source';
}

function sourceTypeIcon(type) {
  return {
    message: 'ph-chat-circle-text',
    task: 'ph-list-checks',
    document: 'ph-file-text',
    doc: 'ph-file-text',
    event: 'ph-calendar-blank',
    room: 'ph-chats-circle',
    weather: 'ph-cloud-sun',
    webpage: 'ph-globe',
    file: 'ph-paperclip',
    audio: 'ph-waveform',
  }[type] || 'ph-link-simple';
}

function sourceLocatorLabel(source) {
  const locator = source?.locator || {};
  if (locator.page) return `Page ${locator.page}`;
  if (locator.rowStart) return locator.rowStart === locator.rowEnd
    ? `Row ${locator.rowStart}`
    : `Rows ${locator.rowStart}–${locator.rowEnd}`;
  if (locator.lineStart) return locator.lineStart === locator.lineEnd
    ? `Line ${locator.lineStart}`
    : `Lines ${locator.lineStart}–${locator.lineEnd}`;
  if (source?.type === 'audio' && Number.isFinite(Number(locator.startSeconds))) {
    const seconds = Math.max(0, Math.floor(Number(locator.startSeconds)));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
  return '';
}

export function AiEvidence({ sources }) {
  const safeSources = useMemo(() => normalizeAiSources(sources), [sources]);
  const [opened, setOpened] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const openSource = useCallback((source) => {
    const outcome = openAiSourceContext(source);
    setOpened({ id: source.id, exact: outcome.exact });
  }, []);
  if (!safeSources.length) return null;
  return (
    <section className="ai-evidence" aria-label="Evidence used for this answer">
      <div className="ai-evidence-heading">
        <i className="ph-bold ph-quotes" aria-hidden="true" />
        <span>Evidence</span>
      </div>
      <div className="ai-evidence-list">
        {(expanded ? safeSources : safeSources.slice(0, 4)).map((source) => {
          const time = compactDateTime(source.timestamp);
          const locator = sourceLocatorLabel(source);
          return (
            <button
              key={source.id}
              type="button"
              className={`ai-evidence-card${opened?.id === source.id ? ' is-opened' : ''}`}
              onClick={() => openSource(source)}
              aria-label={`Open source context for ${sourceTypeLabel(source.type)} ${source.id}: ${source.label}`}
            >
              <span className="ai-evidence-icon"><i className={`ph-bold ${sourceTypeIcon(source.type)}`} aria-hidden="true" /></span>
              <span className="ai-evidence-copy">
                <span><strong>[{source.id}] {source.label}</strong>{locator ? <small className="ai-evidence-locator">{locator}</small> : time ? <time dateTime={new Date(source.timestamp).toISOString()}>{time}</time> : null}</span>
                {source.excerpt ? <small>{source.excerpt}</small> : null}
              </span>
              <i className="ph-bold ph-arrow-square-out ai-evidence-open" aria-hidden="true" />
            </button>
          );
        })}
      </div>
      {safeSources.length > 4 ? (
        <button type="button" className="ai-evidence-expand" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded}>
          {expanded ? 'Show fewer sources' : `Show ${safeSources.length - 4} more sources`}
        </button>
      ) : null}
      {opened ? <p className="ai-evidence-outcome" role="status">{opened.exact ? 'Opened the cited message.' : 'Opened the source area; the cited excerpt remains visible here.'}</p> : null}
    </section>
  );
}

export function AiActionCards({ actions, disabled = false, onConfirm, onDismiss, onOpen }) {
  const safeActions = useMemo(() => normalizeAiActions(actions), [actions]);
  const [states, setStates] = useState({});
  const submitLocksRef = useRef(new Set());

  const confirm = useCallback(async (action) => {
    if (submitLocksRef.current.has(action.id)) return;
    const presentation = aiActionPresentation(action);
    if (!presentation) return;
    submitLocksRef.current.add(action.id);
    setStates((current) => ({
      ...current,
      [action.id]: { status: 'pending', message: presentation.pendingMessage },
    }));
    try {
      const result = await onConfirm(action);
      const confirmedAction = confirmedAiActionFromResponse(result, action);
      if (!confirmedAction) throw new Error('The server did not return a valid confirmed action.');
      setStates((current) => ({
        ...current,
        [action.id]: {
          status: 'success',
          message: result?.message || aiActionSuccessMessage(confirmedAction) || presentation.successMessage,
          action: confirmedAction,
          response: result,
        },
      }));
      if (action.type === 'start_friend_call') {
        try {
          const opened = await onOpen?.(action, result);
          if (opened?.opened === false) {
            const message = opened.reason === 'expired-call-intent'
              ? 'The call confirmation expired. Ask Winston to prepare the call again.'
              : 'The call was confirmed, but the call window could not open.';
            setStates((current) => ({ ...current, [action.id]: { ...current[action.id], message, openError: true } }));
          }
        } catch (openError) {
          setStates((current) => ({
            ...current,
            [action.id]: {
              ...current[action.id],
              message: openError?.message || 'The call was confirmed, but the call window could not open.',
              openError: true,
            },
          }));
        }
      }
    } catch (error) {
      setStates((current) => ({
        ...current,
        [action.id]: { status: 'error', message: error?.message || presentation.errorMessage },
      }));
    } finally {
      submitLocksRef.current.delete(action.id);
    }
  }, [onConfirm, onOpen]);

  const dismiss = useCallback(async (action) => {
    if (submitLocksRef.current.has(action.id)) return;
    submitLocksRef.current.add(action.id);
    setStates((current) => ({ ...current, [action.id]: { status: 'pending', message: 'Cancelling…' } }));
    try {
      await onDismiss(action);
      setStates((current) => ({ ...current, [action.id]: { status: 'dismissed', message: 'Suggestion cancelled.' } }));
    } catch (error) {
      setStates((current) => ({
        ...current,
        [action.id]: { status: 'error', message: error?.message || 'Could not cancel this suggestion.' },
      }));
    } finally {
      submitLocksRef.current.delete(action.id);
    }
  }, [onDismiss]);

  const open = useCallback(async (action, state) => {
    if (submitLocksRef.current.has(action.id)) return;
    submitLocksRef.current.add(action.id);
    setStates((current) => ({
      ...current,
      [action.id]: { ...state, openPending: true, openError: false },
    }));
    try {
      const result = await onOpen?.(action, state.response || { action: state.action || action });
      if (result?.opened === false) {
        throw new Error(result.reason === 'expired-call-intent'
          ? 'This call confirmation expired. Ask Winston to prepare it again.'
          : 'That destination is not available right now.');
      }
      setStates((current) => ({
        ...current,
        [action.id]: { ...current[action.id], openPending: false, openError: false },
      }));
    } catch (error) {
      setStates((current) => ({
        ...current,
        [action.id]: {
          ...current[action.id],
          openPending: false,
          openError: true,
          message: error?.message || 'That destination could not be opened.',
        },
      }));
    } finally {
      submitLocksRef.current.delete(action.id);
    }
  }, [onOpen]);

  if (!safeActions.length) return null;
  return (
    <section className="ai-action-cards" aria-label="Suggested actions">
      {safeActions.map((action) => {
        const presentation = aiActionPresentation(action);
        const state = states[action.id] || { status: action.status, action };
        const terminal = ['success', 'dismissed', 'confirmed', 'expired'].includes(state.status);
        const waiting = state.status === 'pending' || state.status === 'confirming';
        const confirmedAction = state.action?.status === 'confirmed'
          ? state.action
          : action.status === 'confirmed' ? action : null;
        const canOpen = Boolean(onOpen && confirmedAction?.result && ['success', 'confirmed'].includes(state.status));
        const stateMessage = state.message
          || (state.status === 'confirming'
            ? 'Confirmation in progress…'
            : state.status === 'confirmed'
              ? aiActionSuccessMessage(action) || presentation.successMessage
              : state.status === 'dismissed'
                ? 'Suggestion cancelled.'
              : state.status === 'expired'
                ? 'This suggestion expired.'
                : '');
        return (
          <article key={action.id} className={`ai-action-card is-${state.status || 'proposed'}`}>
            <span className="ai-action-icon"><i className={`ph-bold ${presentation.icon}`} aria-hidden="true" /></span>
            <div className="ai-action-copy">
              <span className="ai-action-kicker">{presentation.kicker}</span>
              <strong>{action.title}</strong>
              {action.description ? <p>{action.description}</p> : null}
              {presentation.constraint ? <p className="ai-action-constraint"><i className="ph-bold ph-shield-check" aria-hidden="true" /> {presentation.constraint}</p> : null}
              {stateMessage ? <small className={`ai-action-state is-${state.openError ? 'error' : state.status}`} role="status">{stateMessage}</small> : null}
              {!terminal ? (
                <div className="ai-action-buttons">
                  <button type="button" onClick={() => confirm(action)} disabled={disabled || waiting}>
                    <i className="ph-bold ph-check" aria-hidden="true" /> Confirm
                  </button>
                  <button type="button" onClick={() => dismiss(action)} disabled={disabled || waiting}>
                    Cancel
                  </button>
                </div>
              ) : null}
              {canOpen ? (
                <div className="ai-action-buttons ai-action-result-buttons">
                  <button type="button" onClick={() => open(action, state)} disabled={disabled || state.openPending}>
                    <i className={`ph-bold ${action.type === 'start_friend_call' ? 'ph-phone-call' : 'ph-arrow-square-out'}`} aria-hidden="true" />
                    {state.openPending ? 'Opening…' : presentation.openLabel}
                  </button>
                </div>
              ) : null}
            </div>
          </article>
        );
      })}
    </section>
  );
}

export function AiClarificationCard({ interaction, messageText = '', disabled = false, onFreeText, onSelect }) {
  const clarification = useMemo(() => normalizeAiClarification(interaction), [interaction]);
  const submitLockRef = useRef(false);
  const [pendingOptionId, setPendingOptionId] = useState('');
  const [error, setError] = useState('');

  const selectOption = useCallback(async (option) => {
    if (!clarification || clarification.status === 'answered' || disabled || submitLockRef.current) return;
    submitLockRef.current = true;
    setPendingOptionId(option.id);
    setError('');
    try {
      const accepted = await onSelect?.(option, clarification);
      if (accepted === false) setError('That answer was not sent. Try again.');
    } catch (selectionError) {
      setError(selectionError?.message || 'That answer was not sent. Try again.');
    } finally {
      submitLockRef.current = false;
      setPendingOptionId('');
    }
  }, [clarification, disabled, onSelect]);

  if (!clarification) return null;
  const answered = clarification.status === 'answered';
  const questionAlreadyVisible = String(messageText || '').toLocaleLowerCase().includes(clarification.question.toLocaleLowerCase());
  return (
    <section className={`ai-clarification-card${answered ? ' is-answered' : ''}`} aria-label={clarification.question}>
      <span className="ai-clarification-kicker"><i className="ph-bold ph-list-checks" aria-hidden="true" /> Choose one</span>
      {!questionAlreadyVisible ? <strong className="ai-clarification-question">{clarification.question}</strong> : null}
      {answered ? (
        <p className="ai-clarification-answer" role="status">
          <i className="ph-bold ph-check-circle" aria-hidden="true" />
          <span>Answered: <strong>{clarification.selectedLabel}</strong></span>
        </p>
      ) : (
        <>
          <div className="ai-clarification-options" role="group" aria-label={`Choose an answer for: ${clarification.question}`}>
            {clarification.options.map((option) => (
              <button
                key={option.id}
                type="button"
                disabled={disabled || Boolean(pendingOptionId)}
                aria-pressed={pendingOptionId === option.id}
                onClick={() => selectOption(option)}
              >
                {pendingOptionId === option.id ? <i className="ph-bold ph-circle-notch" aria-hidden="true" /> : null}
                {option.label}
              </button>
            ))}
          </div>
          {clarification.allowFreeText ? (
            <button
              type="button"
              className="ai-clarification-free-text"
              disabled={disabled || Boolean(pendingOptionId)}
              onClick={() => onFreeText?.(clarification)}
            >
              <i className="ph-bold ph-pencil-simple" aria-hidden="true" /> Type another answer
            </button>
          ) : null}
          {error ? <small className="ai-clarification-error" role="alert">{error}</small> : null}
        </>
      )}
    </section>
  );
}

export function AiMessageControls({ disabled = false, message, onEdit, onRetry }) {
  if (message?.role !== 'user') return null;
  return (
    <div className="ai-message-controls" aria-label="Prompt actions">
      <button type="button" onClick={() => onRetry(message)} disabled={disabled}>
        <i className="ph-bold ph-arrows-clockwise" aria-hidden="true" /> Retry
      </button>
      <button type="button" onClick={() => onEdit(message)} disabled={disabled}>
        <i className="ph-bold ph-pencil-simple" aria-hidden="true" /> Edit &amp; resend
      </button>
    </div>
  );
}

export function AiImageComposerTools({ attachment, disabled = false, error = '', onRemove, onSelectFile, processing = false }) {
  const pickerRef = useRef(null);
  const cameraRef = useRef(null);
  const chooseFile = useCallback((event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) onSelectFile(file);
  }, [onSelectFile]);

  return (
    <div className="ai-image-tools">
      {attachment ? (
        <div className="ai-image-preview">
          {attachment.previewUrl ? <img src={attachment.previewUrl} alt="Attached preview" /> : <i className="ph-bold ph-image" aria-hidden="true" />}
          <span><strong>{attachment.name}</strong><small>{Math.max(1, Math.round(attachment.size / 1024))} KB · ready</small></span>
          <button type="button" onClick={onRemove} aria-label={`Remove ${attachment.name}`} disabled={disabled}><i className="ph-bold ph-x" aria-hidden="true" /></button>
        </div>
      ) : null}
      <div className="ai-image-buttons">
        <button type="button" onClick={() => pickerRef.current?.click()} disabled={disabled || processing} title="Attach a JPEG, PNG, or WebP image" aria-label={processing ? 'Preparing image' : 'Attach image'}>
          <i className="ph-bold ph-image" aria-hidden="true" /> <span>{processing ? 'Preparing…' : 'Image'}</span>
        </button>
        <button type="button" onClick={() => cameraRef.current?.click()} disabled={disabled || processing} title="Take a photo" aria-label="Take a photo">
          <i className="ph-bold ph-camera" aria-hidden="true" /> <span>Camera</span>
        </button>
        <input ref={pickerRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseFile} hidden />
        <input ref={cameraRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={chooseFile} hidden />
      </div>
      {error ? <span className="ai-image-error" role="alert">{error}</span> : null}
    </div>
  );
}

function memoryScopeLabel(memory) {
  return memory.scope === 'room' ? 'This room' : 'Personal';
}

export function StructuredMemoryManager({ active, config, onMemoriesChange, roomId, serverSynced }) {
  const [memories, setMemories] = useState([]);
  const [text, setText] = useState('');
  const [scope, setScope] = useState('personal');
  const [expiry, setExpiry] = useState('never');
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState('');
  const [editText, setEditText] = useState('');
  const [editExpiry, setEditExpiry] = useState('never');
  const [error, setError] = useState('');

  const publishMemories = useCallback((next) => {
    const normalized = normalizeAiMemories(next);
    setMemories(normalized);
    onMemoriesChange(normalized);
    return normalized;
  }, [onMemoriesChange]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      publishMemories(serverSynced
        ? await loadPersonalAiMemoriesFromServer({ config })
        : loadLocalAiMemories());
    } catch (loadError) {
      setError(loadError?.message || 'Could not load memories.');
    } finally {
      setLoading(false);
    }
  }, [config, publishMemories, serverSynced]);

  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [active, load]);

  const createMemory = useCallback(async () => {
    const cleanText = text.trim();
    if (!cleanText || !consent || saving) return;
    const duplicate = memories.some((memory) => (
      memory.text.toLocaleLowerCase().replace(/\s+/g, ' ') === cleanText.toLocaleLowerCase().replace(/\s+/g, ' ')
    ));
    if (duplicate) {
      setError('Winston already remembers this.');
      return;
    }
    const expiryDays = expiry === '30-days' ? 30 : expiry === '90-days' ? 90 : 0;
    const memory = {
      text: cleanText,
      scope,
      ...(scope === 'room' ? { roomId } : {}),
      provenance: 'Saved explicitly by you',
      ...(expiryDays ? { expiresAt: Date.now() + expiryDays * 86400000 } : {}),
    };
    setSaving(true);
    setError('');
    try {
      if (serverSynced) {
        const result = await createPersonalAiMemoryOnServer({ config, memory });
        publishMemories(result.memories.length ? result.memories : [result.memory, ...memories]);
      } else {
        publishMemories(createLocalAiMemory(memory).memories);
      }
      setText('');
      setConsent(false);
    } catch (saveError) {
      setError(saveError?.message || 'Could not save this memory.');
    } finally {
      setSaving(false);
    }
  }, [config, consent, expiry, memories, publishMemories, roomId, saving, scope, serverSynced, text]);

  const deleteMemory = useCallback(async (memoryId) => {
    setError('');
    try {
      if (serverSynced) await deletePersonalAiMemoryFromServer({ config, memoryId });
      publishMemories(serverSynced
        ? memories.filter((memory) => memory.id !== memoryId)
        : deleteLocalAiMemory(memoryId));
    } catch (deleteError) {
      setError(deleteError?.message || 'Could not delete this memory.');
    }
  }, [config, memories, publishMemories, serverSynced]);

  const startEditing = useCallback((memory) => {
    setEditingId(memory.id);
    setEditText(memory.text);
    setEditExpiry(memory.expiresAt ? '90-days' : 'never');
    setError('');
  }, []);

  const saveMemoryEdit = useCallback(async () => {
    const existing = memories.find((memory) => memory.id === editingId);
    const cleanText = editText.trim();
    if (!existing || !cleanText || saving) return;
    const duplicate = memories.some((memory) => (
      memory.id !== editingId
      && memory.text.toLocaleLowerCase().replace(/\s+/g, ' ') === cleanText.toLocaleLowerCase().replace(/\s+/g, ' ')
    ));
    if (duplicate) {
      setError('Winston already remembers this.');
      return;
    }
    const memory = {
      ...existing,
      text: cleanText,
      expiresAt: editExpiry === '90-days' ? Date.now() + 90 * 86400000 : 0,
      provenance: 'Edited and explicitly approved by you',
    };
    setSaving(true);
    setError('');
    try {
      if (serverSynced) {
        const result = await updatePersonalAiMemoryOnServer({ config, memoryId: editingId, memory });
        publishMemories(result.memories.length
          ? result.memories
          : memories.map((entry) => entry.id === editingId ? result.memory || memory : entry));
      } else {
        publishMemories(updateLocalAiMemory(editingId, memory).memories);
      }
      setEditingId('');
    } catch (saveError) {
      setError(saveError?.message || 'Could not update this memory.');
    } finally {
      setSaving(false);
    }
  }, [config, editExpiry, editText, editingId, memories, publishMemories, saving, serverSynced]);

  return (
    <section className="ai-memory-manager" aria-label="Winston memory">
      <div className="ai-memory-heading">
        <span><i className="ph-bold ph-brain" aria-hidden="true" /><span><strong>Structured memory</strong><small>Winston saves only what you explicitly approve.</small></span></span>
        <span className="ai-memory-sync">{serverSynced ? 'Synced' : 'This device'}</span>
      </div>
      <div className="ai-memory-create">
        <textarea value={text} onChange={(event) => setText(event.target.value)} rows="2" maxLength="600" placeholder="Something useful Winston should remember…" />
        <div className="ai-memory-options">
          <label>Scope<select value={scope} onChange={(event) => setScope(event.target.value)}><option value="personal">Personal</option><option value="room">This room</option></select></label>
          <label>Expires<select value={expiry} onChange={(event) => setExpiry(event.target.value)}><option value="never">Never</option><option value="30-days">30 days</option><option value="90-days">90 days</option></select></label>
        </div>
        <label className="ai-memory-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> I want Winston to remember this.</label>
        <button type="button" className="ai-memory-save" onClick={createMemory} disabled={saving || !consent || !text.trim()}>{saving ? 'Saving…' : 'Remember'}</button>
      </div>
      {loading ? <p className="ai-memory-state" role="status">Loading memories…</p> : null}
      {error ? <p className="ai-memory-state is-error" role="alert">{error}</p> : null}
      {!loading && memories.length ? (
        <ul className="ai-memory-list">
          {memories.map((memory) => (
            <li key={memory.id}>
              {editingId === memory.id ? (
                <div className="ai-memory-edit">
                  <input value={editText} onChange={(event) => setEditText(event.target.value)} maxLength="600" aria-label="Edit memory" />
                  <label>Expires<select value={editExpiry} onChange={(event) => setEditExpiry(event.target.value)}><option value="never">Never</option><option value="90-days">90 days</option></select></label>
                  <span>
                    <button type="button" onClick={saveMemoryEdit} disabled={saving || !editText.trim()}><i className="ph-bold ph-check" aria-hidden="true" /> Save</button>
                    <button type="button" onClick={() => setEditingId('')} disabled={saving}>Cancel</button>
                  </span>
                </div>
              ) : (
                <>
                  <span><strong>{memoryScopeLabel(memory)}</strong>{memory.expiresAt ? <small>Expires {compactDateTime(memory.expiresAt)}</small> : <small>No expiry</small>}</span>
                  <p>{memory.text}</p>
                  <span className="ai-memory-item-actions">
                    <button type="button" onClick={() => startEditing(memory)} aria-label={`Edit ${memory.text}`}><i className="ph-bold ph-pencil-simple" aria-hidden="true" /> Edit</button>
                    <button type="button" onClick={() => deleteMemory(memory.id)} aria-label={`Forget ${memory.text}`}><i className="ph-bold ph-trash" aria-hidden="true" /> Forget</button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function CrossRoomBriefingPanel({ disabled = false, error = '', loading = false, onClose, onRun, onToggleRoom, rooms, selectedRoomIds }) {
  const selected = new Set(selectedRoomIds);
  return (
    <section className="ai-briefing-panel" aria-label="Choose rooms for briefing">
      <div className="ai-briefing-head">
        <span><i className="ph-bold ph-binoculars" aria-hidden="true" /><span><strong>What needs my attention?</strong><small>Choose up to 8 rooms. Nothing is scanned until you run it.</small></span></span>
        <button type="button" onClick={onClose} aria-label="Close briefing setup"><i className="ph-bold ph-x" aria-hidden="true" /></button>
      </div>
      {loading ? <p className="ai-briefing-state" role="status">Loading your room list…</p> : (
        <div className="ai-briefing-rooms">
          {rooms.map((room) => (
            <label key={room.id}>
              <input type="checkbox" checked={selected.has(room.id)} onChange={() => onToggleRoom(room.id)} disabled={!selected.has(room.id) && selected.size >= 8} />
              <span><strong>{room.name}</strong><small>{room.id === rooms[0]?.id ? 'Current room' : 'Included only if selected'}</small></span>
            </label>
          ))}
        </div>
      )}
      {error ? <p className="ai-briefing-state is-error" role="alert">{error}</p> : null}
      <button type="button" className="ai-briefing-run" onClick={onRun} disabled={disabled || loading || selected.size === 0}>
        <i className="ph-bold ph-sparkle" aria-hidden="true" /> Brief selected rooms ({selected.size})
      </button>
    </section>
  );
}
