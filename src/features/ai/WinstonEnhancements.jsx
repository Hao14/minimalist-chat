import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createPersonalAiMemoryOnServer,
} from './localAiClient.js';
import {
  createLocalAiMemory,
  normalizeAiMemories,
  openAiSourceContext,
} from './aiAgentUi.js';
import {
  approveWinstonMemorySuggestion,
  createWinstonConversation,
  createWinstonFeedback,
  deleteLocalWinstonSchedule,
  deleteWinstonConversationFromServer,
  deleteWinstonScheduleFromServer,
  dismissWinstonMemorySuggestion,
  isWinstonResponseSaved,
  loadLocalWinstonConversations,
  loadLocalWinstonSchedule,
  loadSecureWinstonConversations,
  loadWinstonSavedResponses,
  loadWinstonConversationDeleteTombstones,
  loadWinstonConversationFromServer,
  loadWinstonConversationsFromServer,
  loadWinstonMemorySuggestions,
  loadWinstonScheduleFromServer,
  mergeSavedWinstonConversation,
  mergeWinstonConversations,
  reconcileConflictedWinstonConversation,
  reconcileHydratedWinstonConversation,
  removeWinstonConversationDeleteTombstone,
  saveLocalWinstonConversations,
  saveLocalWinstonSchedule,
  saveWinstonConversationDeleteTombstone,
  saveWinstonConversationToServer,
  saveWinstonScheduleToServer,
  searchLocalWinstonContext,
  searchWinstonWorkspace,
  toggleWinstonSavedResponse,
  winstonConversationSyncFingerprint,
} from './winstonServices.js';

function titleFromMessages(messages) {
  const prompt = messages.find((message) => message.role === 'user')?.content || '';
  const title = prompt.replace(/\s+/g, ' ').trim();
  return title ? `${title.slice(0, 52)}${title.length > 52 ? '…' : ''}` : 'New conversation';
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWinstonConversations({ config, serverEnabled }) {
  const [initialConversations] = useState(loadLocalWinstonConversations);
  const [initialDeleteTombstones] = useState(loadWinstonConversationDeleteTombstones);
  const [conversations, setConversations] = useState(initialConversations);
  const [activeId, setActiveId] = useState(initialConversations[0]?.id || '');
  const [syncState, setSyncState] = useState(serverEnabled ? 'loading' : 'local');
  const [syncGeneration, setSyncGeneration] = useState(0);
  const activeIdRef = useRef(initialConversations[0]?.id || '');
  const configRef = useRef(config);
  const conversationsRef = useRef(initialConversations);
  const deleteTombstonesRef = useRef(initialDeleteTombstones);
  const deletedConversationIdsRef = useRef(new Set(
    initialDeleteTombstones.flatMap((entry) => [entry.localId, entry.serverId]).filter(Boolean),
  ));
  const hydratedServerIdsRef = useRef(new Set(
    initialConversations
      .filter((conversation) => conversation.serverId && conversation.messages.length)
      .map((conversation) => conversation.serverId),
  ));
  const hydrationGenerationsRef = useRef(new Map());
  const hydrationPromisesRef = useRef(new Map());
  const inFlightSavesRef = useRef(new Map());
  const localSaveTimerRef = useRef(null);
  const mountedRef = useRef(true);
  const saveTimersRef = useRef(new Map());
  const serverEnabledRef = useRef(serverEnabled);
  const serverReadyRef = useRef(false);
  const syncedFingerprintsRef = useRef(new Map());

  useEffect(() => {
    configRef.current = config;
    serverEnabledRef.current = serverEnabled;
  }, [config, serverEnabled]);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeId) || conversations[0],
    [activeId, conversations],
  );
  const history = activeConversation?.messages || [];

  const replaceConversations = useCallback((updater) => {
    setConversations((current) => {
      const candidate = typeof updater === 'function' ? updater(current) : updater;
      const next = (Array.isArray(candidate) && candidate.length ? candidate : current)
        .slice()
        .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0))
        .slice(0, 50);
      conversationsRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    let active = true;
    loadSecureWinstonConversations().then((secureConversations) => {
      if (!active || !secureConversations.length) return;
      const current = conversationsRef.current;
      const meaningfulCurrent = current.filter((conversation) => (
        conversation.messages.length
        || conversation.serverId
        || conversation.title !== 'New conversation'
      ));
      const next = mergeWinstonConversations(meaningfulCurrent, secureConversations);
      replaceConversations(next);
      if (!next.some((conversation) => conversation.id === activeIdRef.current)) {
        activeIdRef.current = next[0]?.id || '';
        setActiveId(activeIdRef.current);
      }
    }).catch(() => {
      // The in-memory and server copies remain available if secure storage is unavailable.
    });
    return () => { active = false; };
  }, [replaceConversations]);

  useEffect(() => {
    globalThis.clearTimeout(localSaveTimerRef.current);
    localSaveTimerRef.current = globalThis.setTimeout(() => {
      saveLocalWinstonConversations(conversationsRef.current);
    }, 180);
  }, [conversations]);

  const activateConversation = useCallback((conversationId) => {
    activeIdRef.current = conversationId;
    setActiveId(conversationId);
  }, []);

  const setHistory = useCallback((updater) => {
    const conversationId = activeIdRef.current;
    replaceConversations((current) => current.map((conversation) => {
      if (conversation.id !== conversationId) return conversation;
      const messages = typeof updater === 'function' ? updater(conversation.messages) : updater;
      const nextMessages = Array.isArray(messages) ? messages.slice(-36) : conversation.messages;
      return {
        ...conversation,
        title: conversation.title === 'New conversation' ? titleFromMessages(nextMessages) : conversation.title,
        messages: nextMessages,
        updatedAt: Date.now(),
      };
    }));
  }, [replaceConversations]);

  const hydrateConversation = useCallback((conversationId, baselineValue, { signal } = {}) => {
    if (!serverEnabledRef.current) return Promise.resolve(null);
    const baseline = baselineValue
      || conversationsRef.current.find((conversation) => conversation.id === conversationId);
    const serverId = baseline?.serverId;
    if (!baseline || !serverId) return Promise.resolve(null);

    const existing = hydrationPromisesRef.current.get(conversationId);
    if (existing) return existing;
    const generation = (hydrationGenerationsRef.current.get(conversationId) || 0) + 1;
    hydrationGenerationsRef.current.set(conversationId, generation);

    let task;
    task = loadWinstonConversationFromServer({
      config: configRef.current,
      conversationId: serverId,
      signal,
    }).then((remote) => {
      if (!remote || hydrationGenerationsRef.current.get(conversationId) !== generation) return null;
      hydratedServerIdsRef.current.add(serverId);
      const update = (current) => current.map((conversation) => {
        if (conversation.id !== conversationId) return conversation;
        const reconciled = reconcileHydratedWinstonConversation(
          conversation,
          { ...remote, serverId },
          baseline,
        );
        if (reconciled.clean) {
          syncedFingerprintsRef.current.set(
            conversationId,
            winstonConversationSyncFingerprint(reconciled.conversation),
          );
        }
        return reconciled.conversation;
      });
      if (mountedRef.current) {
        replaceConversations(update);
      } else {
        const next = saveLocalWinstonConversations(update(conversationsRef.current));
        conversationsRef.current = next;
      }
      return remote;
    }).finally(() => {
      if (hydrationPromisesRef.current.get(conversationId) === task) {
        hydrationPromisesRef.current.delete(conversationId);
      }
    });
    hydrationPromisesRef.current.set(conversationId, task);
    return task;
  }, [replaceConversations]);

  const deleteServerConversation = useCallback(({
    localId,
    serverId,
    requestConfig = configRef.current,
  }) => {
    if (!serverId) return Promise.resolve(false);
    return deleteWinstonConversationFromServer({
      config: requestConfig,
      conversationId: serverId,
    }).then(() => {
      deleteTombstonesRef.current = removeWinstonConversationDeleteTombstone({ localId, serverId });
      return true;
    }).catch(() => false);
  }, []);

  useEffect(() => {
    if (!serverEnabled) {
      serverReadyRef.current = false;
      return undefined;
    }
    serverReadyRef.current = false;
    let active = true;
    const controller = new AbortController();
    deleteTombstonesRef.current
      .filter((entry) => entry.serverId)
      .forEach((entry) => {
        deleteServerConversation({
          localId: entry.localId,
          serverId: entry.serverId,
          requestConfig: config,
        });
      });
    loadWinstonConversationsFromServer({ config, signal: controller.signal })
      .then(async (remote) => {
        if (!active) return;
        const visibleRemote = remote.filter((conversation) => (
          !deletedConversationIdsRef.current.has(conversation.id)
          && !deletedConversationIdsRef.current.has(conversation.serverId)
          && !deleteTombstonesRef.current.some((entry) => (
            entry.serverId && entry.serverId === (conversation.serverId || conversation.id)
          ))
        ));
        const beforeList = conversationsRef.current;
        const mergedAtList = mergeWinstonConversations(beforeList, visibleRemote);
        visibleRemote.forEach((remoteConversation) => {
          const serverId = remoteConversation.serverId || remoteConversation.id;
          const local = beforeList.find((conversation) => (
            conversation.serverId === serverId || conversation.id === remoteConversation.id
          ));
          const merged = mergedAtList.find((conversation) => (
            conversation.serverId === serverId || conversation.id === remoteConversation.id
          ));
          if (merged && (!local || local.updatedAt <= remoteConversation.updatedAt)) {
            syncedFingerprintsRef.current.set(
              merged.id,
              winstonConversationSyncFingerprint(merged),
            );
          }
        });
        replaceConversations((current) => mergeWinstonConversations(current, visibleRemote));

        const selected = mergedAtList.find((conversation) => (
          conversation.id === activeIdRef.current
        )) || mergedAtList[0];
        if (selected?.serverId) {
          try {
            await hydrateConversation(selected.id, selected, { signal: controller.signal });
          } catch {
            // Metadata and the bounded local copy remain available.
          }
        }
        if (!active) return;
        serverReadyRef.current = true;
        setSyncState('synced');
      })
      .catch(() => {
        if (!active) return;
        setSyncState('local');
        serverReadyRef.current = false;
      });
    return () => {
      active = false;
      controller.abort();
    };
    // Load once when the configured server surface changes; local edits merge by timestamp.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.profileEndpoint, deleteServerConversation, hydrateConversation, replaceConversations, serverEnabled]);

  const persistConversation = useCallback((sentConversation, { updateUi = true } = {}) => {
    if (!serverEnabledRef.current || !serverReadyRef.current || !sentConversation) {
      return Promise.resolve(null);
    }
    const canSave = sentConversation.messages.length > 0
      || (sentConversation.serverId && hydratedServerIdsRef.current.has(sentConversation.serverId));
    if (!canSave) return Promise.resolve(null);

    const existing = inFlightSavesRef.current.get(sentConversation.id);
    if (existing) return existing;
    if (updateUi && mountedRef.current) setSyncState('saving');

    let finalState = 'synced';
    let task;
    const requestConfig = configRef.current;
    task = saveWinstonConversationToServer({
      config: requestConfig,
      conversation: sentConversation,
    }).then((saved) => {
      if (!saved) return null;
      if (deletedConversationIdsRef.current.has(sentConversation.id)) {
        if (saved.serverId) {
          deleteTombstonesRef.current = saveWinstonConversationDeleteTombstone({
            localId: sentConversation.id,
            serverId: saved.serverId,
          });
          deletedConversationIdsRef.current.add(saved.serverId);
          deleteServerConversation({
            localId: sentConversation.id,
            serverId: saved.serverId,
            requestConfig,
          });
        }
        return saved;
      }
      const acknowledged = mergeSavedWinstonConversation(sentConversation, sentConversation, saved);
      syncedFingerprintsRef.current.set(
        sentConversation.id,
        winstonConversationSyncFingerprint(acknowledged),
      );
      if (saved.serverId) hydratedServerIdsRef.current.add(saved.serverId);

      const update = (current) => current.map((conversation) => (
        conversation.id === sentConversation.id
          ? mergeSavedWinstonConversation(conversation, sentConversation, saved)
          : conversation
      ));
      if (mountedRef.current) {
        replaceConversations(update);
      } else {
        const next = saveLocalWinstonConversations(update(conversationsRef.current));
        conversationsRef.current = next;
      }
      return saved;
    }).catch(async (saveError) => {
      if (
        saveError?.status === 409
        && saveError?.code === 'WINSTON_CONVERSATION_CONFLICT'
        && sentConversation.serverId
      ) {
        try {
          const remote = await loadWinstonConversationFromServer({
            config: requestConfig,
            conversationId: sentConversation.serverId,
          });
          if (remote) {
            const remoteSnapshot = { ...remote, id: sentConversation.id };
            syncedFingerprintsRef.current.set(
              sentConversation.id,
              winstonConversationSyncFingerprint(remoteSnapshot),
            );
            const update = (current) => current.map((conversation) => (
              conversation.id === sentConversation.id
                ? reconcileConflictedWinstonConversation(conversation, remote)
                : conversation
            ));
            if (mountedRef.current) {
              replaceConversations(update);
            } else {
              const next = saveLocalWinstonConversations(update(conversationsRef.current));
              conversationsRef.current = next;
            }
            finalState = 'saving';
            return null;
          }
        } catch {
          // Keep the complete local copy and show that cloud sync needs attention.
        }
      }
      finalState = 'local';
      if (updateUi && mountedRef.current) setSyncState('local');
      return null;
    }).finally(() => {
      if (inFlightSavesRef.current.get(sentConversation.id) === task) {
        inFlightSavesRef.current.delete(sentConversation.id);
      }
      if (updateUi && mountedRef.current && serverReadyRef.current) {
        setSyncState(inFlightSavesRef.current.size ? 'saving' : finalState);
      }
      if (finalState === 'saving' && mountedRef.current) {
        setSyncGeneration((current) => current + 1);
      }
    });
    inFlightSavesRef.current.set(sentConversation.id, task);
    return task;
  }, [deleteServerConversation, replaceConversations]);

  useEffect(() => {
    if (!serverEnabled || !serverReadyRef.current) return;
    const liveIds = new Set(conversations.map((conversation) => conversation.id));
    saveTimersRef.current.forEach(({ timer }, conversationId) => {
      if (liveIds.has(conversationId)) return;
      globalThis.clearTimeout(timer);
      saveTimersRef.current.delete(conversationId);
    });

    conversations.forEach((conversation) => {
      const fingerprint = winstonConversationSyncFingerprint(conversation);
      const clean = syncedFingerprintsRef.current.get(conversation.id) === fingerprint;
      const pending = saveTimersRef.current.get(conversation.id);
      if (clean) {
        if (pending) globalThis.clearTimeout(pending.timer);
        saveTimersRef.current.delete(conversation.id);
        return;
      }
      if (inFlightSavesRef.current.has(conversation.id)) return;

      const canSave = conversation.messages.length > 0
        || (conversation.serverId && hydratedServerIdsRef.current.has(conversation.serverId));
      if (!canSave) {
        if (conversation.serverId && !hydrationPromisesRef.current.has(conversation.id)) {
          hydrateConversation(conversation.id, conversation).catch(() => null);
        }
        return;
      }
      if (pending?.fingerprint === fingerprint) return;
      if (pending) globalThis.clearTimeout(pending.timer);
      const timer = globalThis.setTimeout(() => {
        saveTimersRef.current.delete(conversation.id);
        const latest = conversationsRef.current.find((entry) => entry.id === conversation.id);
        if (!latest) return;
        if (
          syncedFingerprintsRef.current.get(latest.id)
          !== winstonConversationSyncFingerprint(latest)
        ) {
          persistConversation(latest);
        }
      }, 800);
      saveTimersRef.current.set(conversation.id, { fingerprint, timer });
    });
  }, [conversations, hydrateConversation, persistConversation, serverEnabled, syncGeneration]);

  useEffect(() => {
    mountedRef.current = true;
    const flushDirtyConversations = () => {
      if (!serverEnabledRef.current || !serverReadyRef.current) return;
      saveTimersRef.current.forEach(({ timer }) => globalThis.clearTimeout(timer));
      saveTimersRef.current.clear();
      conversationsRef.current.forEach((conversation) => {
        if (
          syncedFingerprintsRef.current.get(conversation.id)
          !== winstonConversationSyncFingerprint(conversation)
        ) {
          persistConversation(conversation, { updateUi: false });
        }
      });
    };
    globalThis.window?.addEventListener?.('pagehide', flushDirtyConversations);
    return () => {
      globalThis.window?.removeEventListener?.('pagehide', flushDirtyConversations);
      mountedRef.current = false;
      globalThis.clearTimeout(localSaveTimerRef.current);
      saveLocalWinstonConversations(conversationsRef.current);
      flushDirtyConversations();
    };
  }, [persistConversation]);

  const newConversation = useCallback(() => {
    const conversation = createWinstonConversation();
    replaceConversations((current) => [conversation, ...current]);
    activateConversation(conversation.id);
    return conversation;
  }, [activateConversation, replaceConversations]);

  const selectConversation = useCallback(async (conversationId) => {
    const baseline = conversationsRef.current.find((conversation) => conversation.id === conversationId);
    activateConversation(conversationId);
    if (!serverEnabled || !serverReadyRef.current) return;
    try {
      await hydrateConversation(conversationId, baseline);
    } catch {
      // The bounded local copy remains available.
    }
  }, [activateConversation, hydrateConversation, serverEnabled]);

  const renameConversation = useCallback((conversationId, title) => {
    const safeTitle = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!safeTitle) return;
    const baseline = conversationsRef.current.find((conversation) => conversation.id === conversationId);
    replaceConversations((current) => current.map((conversation) => (
      conversation.id === conversationId
        ? { ...conversation, title: safeTitle, updatedAt: Date.now() }
        : conversation
    )));
    if (
      baseline?.serverId
      && !baseline.messages.length
      && serverReadyRef.current
      && !hydratedServerIdsRef.current.has(baseline.serverId)
    ) {
      hydrateConversation(conversationId, baseline).catch(() => null);
    }
  }, [hydrateConversation, replaceConversations]);

  const deleteConversation = useCallback((conversationId) => {
    const current = conversationsRef.current;
    const serverId = current.find((conversation) => conversation.id === conversationId)?.serverId || '';
    const remaining = current.filter((conversation) => conversation.id !== conversationId);
    const next = remaining.length ? remaining : [createWinstonConversation()];
    const fallbackId = next[0].id;
    const pending = saveTimersRef.current.get(conversationId);
    if (pending) globalThis.clearTimeout(pending.timer);
    saveTimersRef.current.delete(conversationId);
    deletedConversationIdsRef.current.add(conversationId);
    deleteTombstonesRef.current = saveWinstonConversationDeleteTombstone({
      localId: conversationId,
      serverId,
    });
    if (serverId) deletedConversationIdsRef.current.add(serverId);
    replaceConversations(next);
    if (activeIdRef.current === conversationId) activateConversation(fallbackId);
    syncedFingerprintsRef.current.delete(conversationId);
    if (serverEnabled) {
      if (serverId) deleteServerConversation({
        localId: conversationId,
        serverId,
        requestConfig: config,
      });
    }
  }, [activateConversation, config, deleteServerConversation, replaceConversations, serverEnabled]);

  return {
    activeConversation,
    activeId,
    conversations,
    deleteConversation,
    history,
    newConversation,
    renameConversation,
    selectConversation,
    setHistory,
    syncState: serverEnabled ? syncState : 'local',
  };
}

export function WinstonConversationDrawer({
  activeId,
  conversations,
  disabled = false,
  onClose,
  onDelete,
  onNew,
  onRename,
  onSelect,
  open,
  syncState,
}) {
  const [query, setQuery] = useState('');
  const [renamingId, setRenamingId] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return conversations;
    return conversations.filter((conversation) => (
      conversation.title.toLocaleLowerCase().includes(normalized)
      || conversation.messages.some((message) => message.content.toLocaleLowerCase().includes(normalized))
    ));
  }, [conversations, query]);

  const submitRename = useCallback((event) => {
    event.preventDefault();
    if (disabled) return;
    onRename(renamingId, renameValue);
    setRenamingId('');
  }, [disabled, onRename, renameValue, renamingId]);

  if (!open) return null;
  return (
    <aside className="pa-conversation-drawer" aria-label="Winston conversations">
      <div className="pa-enhancement-head">
        <span><strong>Conversations</strong><small>{syncState === 'synced' ? 'Synced' : syncState === 'saving' ? 'Saving…' : 'Available on this device'}</small></span>
        <button type="button" onClick={onClose} aria-label="Close conversations"><i className="ph-bold ph-x" aria-hidden="true" /></button>
      </div>
      <div className="pa-conversation-toolbar" role="toolbar" aria-label="Conversation controls">
        <label className="pa-enhancement-search">
          <i className="ph-bold ph-magnifying-glass" aria-hidden="true" />
          <span className="pa-sr-only">Search conversations</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search conversations" />
        </label>
        <button
          type="button"
          className="pa-conversation-new"
          onClick={onNew}
          disabled={disabled}
          aria-label="New conversation"
          title="New conversation"
        >
          <span className="pa-conversation-new-icon" aria-hidden="true"><i className="ph-bold ph-plus" /></span>
          <span>New</span>
        </button>
      </div>
      <div className="pa-conversation-list">
        {filtered.map((conversation) => (
          <article key={conversation.id} className={conversation.id === activeId ? 'is-active' : ''}>
            {renamingId === conversation.id ? (
              <form onSubmit={submitRename}>
                <input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} maxLength="80" autoFocus aria-label="Conversation title" />
                <button type="submit" aria-label="Save title" disabled={disabled}><i className="ph-bold ph-check" aria-hidden="true" /></button>
              </form>
            ) : (
              <button type="button" className="pa-conversation-select" onClick={() => onSelect(conversation.id)} disabled={disabled}>
                <strong>{conversation.title}</strong>
                <small>{conversation.messages.length ? `${conversation.messages.length} messages` : 'Empty'}</small>
              </button>
            )}
            <span className="pa-conversation-actions">
              <button type="button" disabled={disabled} onClick={() => {
                setRenamingId(conversation.id);
                setRenameValue(conversation.title);
              }} aria-label={`Rename ${conversation.title}`}><i className="ph-bold ph-pencil-simple" aria-hidden="true" /></button>
              <button type="button" disabled={disabled} onClick={() => onDelete(conversation.id)} aria-label={`Delete ${conversation.title}`}><i className="ph-bold ph-trash" aria-hidden="true" /></button>
            </span>
          </article>
        ))}
        {!filtered.length ? <p className="pa-enhancement-empty">No matching conversations.</p> : null}
      </div>
    </aside>
  );
}

export function WinstonWorkspaceSearchPanel({
  config,
  context,
  disabled = false,
  gateway,
  onClose,
  open,
  roomId,
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [state, setState] = useState('idle');
  const [message, setMessage] = useState('');
  const controllerRef = useRef(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const runSearch = useCallback(async (event) => {
    event.preventDefault();
    const cleanQuery = query.trim();
    if (!cleanQuery || disabled) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState('loading');
    setMessage('');
    try {
      const remote = gateway
        ? await searchWinstonWorkspace({
          config,
          query: cleanQuery,
          roomIds: [],
          signal: controller.signal,
        }).catch(() => null)
        : null;
      const next = remote?.results?.length
        ? remote.results
        : searchLocalWinstonContext(cleanQuery, context, roomId);
      setResults(next);
      setMessage(remote?.results?.length
        ? `Semantic results${remote.model ? ` · ${remote.model}` : ''}`
        : 'Searched the recent context available on this device.');
      setState(next.length ? 'complete' : 'empty');
    } catch (error) {
      if (controller.signal.aborted) return;
      setState('error');
      setMessage(error?.message || 'Workspace search is unavailable.');
    }
  }, [config, context, disabled, gateway, query, roomId]);

  if (!open) return null;
  return (
    <section className="pa-workspace-search" aria-label="Search your workspace">
      <div className="pa-enhancement-head">
        <span><strong>Search your workspace</strong><small>Only rooms you can access are searched.</small></span>
        <button type="button" onClick={onClose} aria-label="Close workspace search"><i className="ph-bold ph-x" aria-hidden="true" /></button>
      </div>
      <form className="pa-workspace-query" role="search" onSubmit={runSearch}>
        <label className="pa-enhancement-search">
          <i className="ph-bold ph-magnifying-glass" aria-hidden="true" />
          <span className="pa-sr-only">Semantic workspace search</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search messages, tasks, events, and docs" autoFocus />
        </label>
        <button
          className="pa-workspace-query-submit"
          type="submit"
          disabled={!query.trim() || state === 'loading' || disabled}
          aria-label={state === 'loading' ? 'Searching workspace' : 'Search workspace'}
          title={state === 'loading' ? 'Searching workspace' : 'Search workspace'}
        >
          <i className={`ph-bold ${state === 'loading' ? 'ph-spinner-gap' : 'ph-arrow-right'}`} aria-hidden="true" />
        </button>
      </form>
      {message ? <p className={`pa-enhancement-state is-${state}`} role="status">{message}</p> : null}
      <div className="pa-workspace-results">
        {results.map((result) => (
          <button key={result.id} type="button" onClick={() => openAiSourceContext(result.source)}>
            <span className="pa-result-type">{result.source.type}</span>
            <strong>[{result.source.id}] {result.title}</strong>
            <small>{result.excerpt}</small>
            <span className="pa-result-open">Open source <i className="ph-bold ph-arrow-square-out" aria-hidden="true" /></span>
          </button>
        ))}
        {state === 'empty' ? <p className="pa-enhancement-empty">No matching workspace items were found.</p> : null}
      </div>
    </section>
  );
}

export function WinstonProactiveSettings({
  active,
  config,
  roomId,
  rooms,
  serverEnabled,
}) {
  const [schedule, setSchedule] = useState(() => loadLocalWinstonSchedule(roomId));
  const [state, setState] = useState('idle');
  const [message, setMessage] = useState('');
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!active || loadedRef.current) return undefined;
    loadedRef.current = true;
    let mounted = true;
    const local = loadLocalWinstonSchedule(roomId);
    if (!serverEnabled) {
      return undefined;
    }
    loadWinstonScheduleFromServer({ config })
      .then((remote) => {
        if (!mounted) return;
        setSchedule(remote || local);
        setState(remote ? 'synced' : 'local');
      })
      .catch(() => {
        if (!mounted) return;
        setSchedule(local);
        setState('local');
      });
    return () => { mounted = false; };
  }, [active, config, roomId, serverEnabled]);

  const roomOptions = useMemo(() => {
    const source = rooms?.length ? rooms : [{ id: roomId, name: roomId === 'global' ? 'Global Chat' : 'Current room' }];
    return source.slice(0, 32);
  }, [roomId, rooms]);

  const toggleRoom = useCallback((id) => {
    setSchedule((current) => {
      const selected = current.selectedRoomIds.includes(id);
      const selectedRoomIds = selected
        ? current.selectedRoomIds.filter((room) => room !== id)
        : [...current.selectedRoomIds, id].slice(0, 8);
      return { ...current, selectedRoomIds: selectedRoomIds.length ? selectedRoomIds : current.selectedRoomIds };
    });
  }, []);

  const save = useCallback(async () => {
    if (schedule.enabled && !schedule.selectedRoomIds.length) return;
    setState('saving');
    setMessage('');
    const local = saveLocalWinstonSchedule(schedule, roomId);
    try {
      const saved = serverEnabled ? await saveWinstonScheduleToServer({ config, schedule: local }) : local;
      setSchedule(saved);
      setState(serverEnabled ? 'synced' : 'local');
      setMessage(schedule.enabled
        ? serverEnabled
          ? 'Daily briefing scheduled.'
          : 'Preference saved on this device. Synced Winston is required to deliver it.'
        : 'Proactive briefings remain off.');
    } catch (error) {
      setState('local');
      setMessage(`Saved on this device. ${error?.message || 'Cloud sync is unavailable.'}`);
    }
  }, [config, roomId, schedule, serverEnabled]);

  const remove = useCallback(async () => {
    setState('saving');
    const next = deleteLocalWinstonSchedule(roomId);
    setSchedule(next);
    try {
      if (serverEnabled) await deleteWinstonScheduleFromServer({ config, scheduleId: schedule.id });
      setState(serverEnabled ? 'synced' : 'local');
      setMessage('Proactive schedule removed.');
    } catch {
      setState('local');
      setMessage('Removed on this device. Cloud removal will need to be retried.');
    }
  }, [config, roomId, schedule.id, serverEnabled]);

  return (
    <section className="pa-proactive-settings" aria-label="Proactive Winston briefings">
      <div className="pa-memory-heading">
        <span><i className="ph-bold ph-bell-ringing" aria-hidden="true" /><span><strong>Proactive briefing</strong><small>Off until you explicitly opt in.</small></span></span>
        <span className="ai-memory-sync">{state === 'synced' ? 'Synced' : state === 'saving' ? 'Saving…' : 'This device'}</span>
      </div>
      <label className="pa-proactive-opt-in">
        <input
          type="checkbox"
          checked={schedule.enabled}
          onChange={(event) => setSchedule((current) => ({ ...current, enabled: event.target.checked }))}
        />
        <span><strong>Send my daily attention briefing</strong><small>Winston will review only the rooms selected below.</small></span>
      </label>
      {!serverEnabled ? <p className="pa-proactive-disclosure"><i className="ph-bold ph-info" aria-hidden="true" /> Local preferences do not run in the background. Cloud sync is required for delivery.</p> : null}
      <div className="pa-proactive-fields">
        <label>Time<input type="time" value={schedule.localTime} onChange={(event) => setSchedule((current) => ({ ...current, localTime: event.target.value }))} disabled={!schedule.enabled} /></label>
        <label>Timezone<input value={schedule.timeZone} onChange={(event) => setSchedule((current) => ({ ...current, timeZone: event.target.value }))} maxLength="80" disabled={!schedule.enabled} /></label>
      </div>
      <fieldset disabled={!schedule.enabled}>
        <legend>Rooms to review</legend>
        <div className="pa-proactive-rooms">
          {roomOptions.map((room) => (
            <label key={room.id}>
              <input type="checkbox" checked={schedule.selectedRoomIds.includes(room.id)} onChange={() => toggleRoom(room.id)} />
              <span>{room.name}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="pa-settings-actions">
        <button type="button" className="pa-btn pa-btn-accent" onClick={save} disabled={state === 'saving'}><i className="ph-bold ph-check" aria-hidden="true" /> Save schedule</button>
        <button type="button" className="pa-btn" onClick={remove} disabled={state === 'saving'}><i className="ph-bold ph-trash" aria-hidden="true" /> Remove</button>
      </div>
      {message ? <p className="pa-enhancement-state" role="status">{message}</p> : null}
    </section>
  );
}

export function WinstonMemorySuggestion({
  config,
  memories,
  onMemoriesChange,
  onRemove,
  roomId,
  serverEnabled,
  suggestion,
}) {
  const [text, setText] = useState(suggestion.text);
  const [scope, setScope] = useState(suggestion.scope === 'room' ? 'room' : 'personal');
  const [expiry, setExpiry] = useState('never');
  const [state, setState] = useState('idle');
  const [error, setError] = useState('');

  const remember = useCallback(async () => {
    const clean = text.trim();
    if (!clean || state === 'saving') return;
    const duplicate = normalizeAiMemories(memories).some((memory) => (
      memory.text.toLocaleLowerCase().replace(/\s+/g, ' ') === clean.toLocaleLowerCase().replace(/\s+/g, ' ')
    ));
    if (duplicate) {
      setError('Winston already remembers this.');
      return;
    }
    const memory = {
      text: clean,
      scope,
      ...(scope === 'room' ? { roomId: suggestion.roomId || roomId } : {}),
      provenance: 'Suggested by Winston and explicitly approved by you',
      ...(expiry === '90-days' ? { expiresAt: Date.now() + 90 * 86400000 } : {}),
    };
    setState('saving');
    setError('');
    try {
      if (serverEnabled) {
        const isServerSuggestion = /^[a-f0-9]{64}$/.test(String(suggestion.id || ''));
        const unchanged = clean === suggestion.text
          && scope === (suggestion.scope === 'room' ? 'room' : 'personal')
          && expiry === 'never';
        if (isServerSuggestion && unchanged) {
          const result = await approveWinstonMemorySuggestion({ config, suggestionId: suggestion.id });
          onMemoriesChange(result?.memory ? [result.memory, ...memories] : memories);
        } else {
          const result = await createPersonalAiMemoryOnServer({ config, memory });
          onMemoriesChange(result.memories.length ? result.memories : [result.memory, ...memories]);
          if (isServerSuggestion) {
            await dismissWinstonMemorySuggestion({ config, suggestionId: suggestion.id }).catch(() => null);
          }
        }
      } else {
        onMemoriesChange(createLocalAiMemory(memory).memories);
      }
      setState('saved');
      window.setTimeout(onRemove, 900);
    } catch (saveError) {
      setState('idle');
      setError(saveError?.message || 'Could not save this memory.');
    }
  }, [config, expiry, memories, onMemoriesChange, onRemove, roomId, scope, serverEnabled, state, suggestion.id, suggestion.roomId, suggestion.scope, suggestion.text, text]);

  const dismiss = useCallback(async () => {
    if (state === 'saving') return;
    setState('saving');
    try {
      if (serverEnabled && /^[a-f0-9]{64}$/.test(String(suggestion.id || ''))) {
        await dismissWinstonMemorySuggestion({ config, suggestionId: suggestion.id });
      }
      onRemove();
    } catch (dismissError) {
      setState('idle');
      setError(dismissError?.message || 'Could not dismiss this suggestion.');
    }
  }, [config, onRemove, serverEnabled, state, suggestion.id]);

  return (
    <section className="pa-memory-suggestion" aria-label="Memory suggestion">
      <span className="pa-memory-suggestion-kicker"><i className="ph-bold ph-brain" aria-hidden="true" /> Remember this?</span>
      <input value={text} onChange={(event) => setText(event.target.value)} maxLength="600" aria-label="Edit suggested memory" />
      <div className="pa-memory-suggestion-options">
        <label>Scope<select value={scope} onChange={(event) => setScope(event.target.value)}><option value="personal">Personal</option><option value="room">{suggestion.roomId ? `Room · ${suggestion.roomId}` : 'This room'}</option></select></label>
        <label>Expires<select value={expiry} onChange={(event) => setExpiry(event.target.value)}><option value="never">Never</option><option value="90-days">90 days</option></select></label>
      </div>
      <div className="pa-memory-suggestion-actions">
        <button type="button" onClick={remember} disabled={!text.trim() || state === 'saving'}><i className="ph-bold ph-check" aria-hidden="true" /> {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Remembered' : 'Remember'}</button>
        <button type="button" onClick={dismiss} disabled={state === 'saving'}>Not now</button>
      </div>
      {error ? <small role="alert">{error}</small> : null}
    </section>
  );
}

export function WinstonPendingMemorySuggestions({
  active,
  config,
  memories,
  onMemoriesChange,
  roomId,
  serverEnabled,
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [loadState, setLoadState] = useState('loading');

  useEffect(() => {
    if (!active || !serverEnabled) return undefined;
    const controller = new AbortController();
    loadWinstonMemorySuggestions({ config, signal: controller.signal })
      .then((next) => {
        setSuggestions(next);
        setLoadState('ready');
      })
      .catch((error) => {
        if (error?.code !== 'ABORTED') setLoadState('error');
      });
    return () => controller.abort();
  }, [active, config, serverEnabled]);

  if (!serverEnabled || (loadState === 'ready' && !suggestions.length)) return null;
  return (
    <section className="pa-pending-memories" aria-label="Pending Winston memory suggestions">
      <div className="pa-memory-heading">
        <span><i className="ph-bold ph-lightbulb" aria-hidden="true" /><span><strong>Suggested memories</strong><small>Nothing is saved until you approve it.</small></span></span>
        {loadState === 'loading' ? <span className="ai-memory-sync">Loading…</span> : null}
      </div>
      {loadState === 'error' ? <p className="pa-enhancement-state is-error">Could not load pending suggestions.</p> : null}
      {suggestions.map((suggestion) => (
        <WinstonMemorySuggestion
          key={suggestion.id}
          config={config}
          memories={memories}
          onMemoriesChange={onMemoriesChange}
          onRemove={() => setSuggestions((current) => current.filter((entry) => entry.id !== suggestion.id))}
          roomId={suggestion.roomId || roomId}
          serverEnabled={serverEnabled}
          suggestion={suggestion}
        />
      ))}
    </section>
  );
}

export function WinstonSavedResponses() {
  const [responses, setResponses] = useState(loadWinstonSavedResponses);
  const remove = useCallback((response) => {
    toggleWinstonSavedResponse(response);
    setResponses(loadWinstonSavedResponses());
  }, []);
  const copy = useCallback((content) => {
    Promise.resolve(globalThis.navigator?.clipboard?.writeText?.(content)).catch(() => null);
  }, []);

  return (
    <section className="pa-saved-responses" aria-label="Saved Winston responses">
      <div className="pa-memory-heading">
        <span><i className="ph-bold ph-bookmark-simple" aria-hidden="true" /><span><strong>Saved responses</strong><small>Stored only on this device.</small></span></span>
        <span className="ai-memory-sync">{responses.length}</span>
      </div>
      {!responses.length ? <p className="pa-enhancement-empty">Responses you bookmark will appear here.</p> : (
        <div className="pa-saved-response-list">
          {responses.map((response) => (
            <article key={response.id}>
              <p>{response.content}</p>
              <div>
                <button type="button" onClick={() => copy(response.content)}><i className="ph-bold ph-copy" aria-hidden="true" /> Copy</button>
                <button type="button" onClick={() => remove(response)}><i className="ph-bold ph-trash" aria-hidden="true" /> Remove</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function AssistantResponseToolbar({ config, conversationId, message }) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(() => isWinstonResponseSaved(message.id));
  const [speaking, setSpeaking] = useState(false);
  const [rating, setRating] = useState('');
  const [reason, setReason] = useState('');
  const [feedbackState, setFeedbackState] = useState('idle');
  const utteranceRef = useRef(null);

  useEffect(() => () => {
    if (utteranceRef.current && globalThis.speechSynthesis) globalThis.speechSynthesis.cancel();
  }, []);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }, [message.content]);

  const toggleSpeech = useCallback(() => {
    if (!globalThis.speechSynthesis || typeof SpeechSynthesisUtterance !== 'function') return;
    if (speaking) {
      globalThis.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(message.content);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    utteranceRef.current = utterance;
    setSpeaking(true);
    globalThis.speechSynthesis.speak(utterance);
  }, [message.content, speaking]);

  const toggleSaved = useCallback(() => {
    setSaved(toggleWinstonSavedResponse(message).saved);
  }, [message]);

  const submitFeedback = useCallback(async () => {
    if (!rating || feedbackState === 'saving') return;
    setFeedbackState('saving');
    try {
      await createWinstonFeedback({
        config,
        feedback: {
          conversationId,
          messageId: message.id,
          rating,
          reason,
          provider: message.provider,
          model: message.model,
          modelProfile: message.modelProfile,
        },
      });
      setFeedbackState('saved');
    } catch {
      setFeedbackState('error');
    }
  }, [config, conversationId, feedbackState, message, rating, reason]);

  return (
    <div className="pa-response-toolbar" aria-label="Winston response actions">
      <div className="pa-response-toolbar-buttons">
        <button type="button" onClick={copy} title="Copy response"><i className={`ph-bold ${copied ? 'ph-check' : 'ph-copy'}`} aria-hidden="true" /><span>{copied ? 'Copied' : 'Copy'}</span></button>
        <button type="button" onClick={toggleSpeech} disabled={!globalThis.speechSynthesis} title={speaking ? 'Stop reading' : 'Read aloud'}><i className={`ph-bold ${speaking ? 'ph-stop' : 'ph-speaker-high'}`} aria-hidden="true" /><span>{speaking ? 'Stop' : 'Read'}</span></button>
        <button type="button" onClick={toggleSaved} aria-pressed={saved} title="Save response on this device"><i className={`ph-bold ${saved ? 'ph-bookmark-simple-fill' : 'ph-bookmark-simple'}`} aria-hidden="true" /><span>{saved ? 'Saved' : 'Save'}</span></button>
        <span className="pa-response-feedback-buttons" aria-label="Rate response">
          <button type="button" onClick={() => setRating('helpful')} aria-pressed={rating === 'helpful'} title="Helpful"><i className="ph-bold ph-thumbs-up" aria-hidden="true" /><span className="pa-sr-only">Helpful</span></button>
          <button type="button" onClick={() => setRating('not-helpful')} aria-pressed={rating === 'not-helpful'} title="Not helpful"><i className="ph-bold ph-thumbs-down" aria-hidden="true" /><span className="pa-sr-only">Not helpful</span></button>
        </span>
      </div>
      {rating && feedbackState !== 'saved' ? (
        <form className="pa-response-feedback-form" onSubmit={(event) => { event.preventDefault(); submitFeedback(); }}>
          <select value={reason} onChange={(event) => setReason(event.target.value)} aria-label="Optional feedback reason">
            <option value="">Optional reason</option>
            <option value="accuracy">Accuracy</option>
            <option value="relevance">Relevance</option>
            <option value="formatting">Formatting</option>
            <option value="speed">Speed</option>
            <option value="citation">Citation</option>
            <option value="tool result">Tool result</option>
          </select>
          <button type="submit" disabled={feedbackState === 'saving'}>{feedbackState === 'saving' ? 'Sending…' : 'Send'}</button>
          {feedbackState === 'error' ? <small role="alert">Could not save feedback. Try again.</small> : null}
        </form>
      ) : null}
      {feedbackState === 'saved' ? <small className="pa-response-feedback-thanks" role="status">Thanks—feedback saved.</small> : null}
    </div>
  );
}
