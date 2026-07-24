import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  DEFAULT_LOCALE,
  getLocale,
  subscribeLocale,
  translate,
} from '../../lib/i18n.js';
import MessageDeliveryState from './MessageDeliveryState.jsx';
import { mergeMessageDeliveries } from './messageDeliveryState.js';
import {
  buildMessageTimeline,
  buildVirtualTimelineLayout,
  buildVirtualTimelineWindow,
  estimateTimelineItemHeight,
  mergeVirtualTimelineRanges,
} from './messageTimeline.js';
import './MessageTimeline.css';

const VIRTUALIZE_AFTER_ROWS = 120;
const VIRTUAL_MIN_ROWS = 40;
const VIRTUAL_MAX_ROWS = 68;
const DEFAULT_TIMELINE_GAP = 13;

function Separator({ item, virtualKey }) {
  if (item.type === 'date') {
    return (
      <li className="message-date-separator" data-timeline-key={virtualKey}>
        <span aria-label={item.label} role="separator">{item.label}</span>
      </li>
    );
  }

  const { presentation } = item;
  const accessibleLabel = presentation.detail
    ? `${presentation.label}: ${presentation.detail}`
    : presentation.label;
  return (
    <li
      className={`message-activity-separator activity-${presentation.type}`}
      data-timeline-key={virtualKey}
    >
      <span className="message-activity-line" aria-hidden="true" />
      <span aria-label={accessibleLabel} className="message-activity-label" role="separator">
        <i className={`ph-bold ${presentation.icon}`} aria-hidden="true" />
        <strong>{presentation.label}</strong>
        {presentation.detail ? <span>{presentation.detail}</span> : null}
      </span>
      <span className="message-activity-line" aria-hidden="true" />
    </li>
  );
}

function timelineRows(items, firstUnreadMessageId, scopeKey) {
  const rows = [];
  items.forEach((item, renderIndex) => {
    if (item.type === 'message' && item.message.id === firstUnreadMessageId) {
      const key = `unread:${item.message.id}`;
      rows.push({
        key,
        measurementKey: `${scopeKey}:${key}`,
        messageId: item.message.id,
        renderIndex,
        type: 'unread',
      });
    }
    rows.push({
      ...item,
      measurementKey: `${scopeKey}:${item.key}`,
      renderIndex,
    });
  });
  return rows;
}

function hiddenRangeHeight(layout, start, end) {
  if (!layout || end <= start) return 0;
  return Math.max(0, layout.offsets[end] - layout.offsets[start] - layout.gap);
}

function VirtualSpacer({ end, height, spacerRef, start }) {
  return (
    <li
      aria-hidden="true"
      className="message-timeline-spacer"
      data-virtual-end={end}
      data-virtual-start={start}
      ref={spacerRef}
      role="presentation"
      style={{
        '--message-timeline-spacer-height': `${Math.max(0, height)}px`,
        display: height > 0 ? 'block' : 'none',
      }}
    />
  );
}

function pendingJumpMessageId() {
  if (typeof window === 'undefined') return '';
  return String(window.pendingMessageJump?.messageId || '');
}

export default function MessageTimeline({
  deliveries,
  firstUnreadMessageId,
  matchesMessage,
  messages,
  onCancelDelivery,
  onRetryDelivery,
  pinnedMessageId,
  renderMessage,
  scopeKey,
}) {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, () => DEFAULT_LOCALE);
  const controllerRef = useRef(null);
  const gapFrameRef = useRef(null);
  const measurementFrameRef = useRef(null);
  const pendingMeasurementsRef = useRef(new Map());
  const pendingCompensationRef = useRef(0);
  const pendingStickToBottomRef = useRef(false);
  const viewportFrameRef = useRef(null);
  const notifiedJumpRef = useRef('');
  const [measurements, setMeasurements] = useState(() => new Map());
  const [timelineGap, setTimelineGap] = useState(DEFAULT_TIMELINE_GAP);
  const [viewport, setViewport] = useState({
    anchorMessageId: '',
    focusedMessageId: '',
    height: 720,
    jumpMessageId: '',
    scrollTop: 0,
  });

  const displayedMessages = useMemo(
    () => mergeMessageDeliveries(messages, deliveries, scopeKey),
    [deliveries, messages, scopeKey],
  );
  const visibleMessages = useMemo(
    () => displayedMessages.filter(matchesMessage),
    [displayedMessages, matchesMessage],
  );
  const timeline = useMemo(() => buildMessageTimeline(visibleMessages), [visibleMessages]);
  const rows = useMemo(
    () => timelineRows(timeline, firstUnreadMessageId, scopeKey),
    [firstUnreadMessageId, scopeKey, timeline],
  );
  const messagePositionById = useMemo(() => {
    const positions = new Map();
    let position = 0;
    rows.forEach((row, index) => {
      if (row.type !== 'message') return;
      positions.set(String(row.message.id), {
        index,
        key: row.key,
        position: position + 1,
      });
      position += 1;
    });
    return positions;
  }, [rows]);
  const rowIndexByKey = useMemo(
    () => new Map(rows.map((row, index) => [row.key, index])),
    [rows],
  );
  const virtualized = rows.length > VIRTUALIZE_AFTER_ROWS;
  const layout = useMemo(
    () => buildVirtualTimelineLayout(rows, measurements, timelineGap),
    [measurements, rows, timelineGap],
  );
  const primaryRange = useMemo(() => buildVirtualTimelineWindow(layout, {
    maxRows: VIRTUAL_MAX_ROWS,
    minRows: VIRTUAL_MIN_ROWS,
    overscan: Math.max(1200, viewport.height * 1.5),
    scrollTop: viewport.scrollTop,
    viewportHeight: viewport.height,
  }), [layout, viewport.height, viewport.scrollTop]);
  const activeJumpMessageId = pendingJumpMessageId() || viewport.jumpMessageId;
  const pinnedIndices = useMemo(() => {
    const indices = new Set();
    [
      firstUnreadMessageId,
      pinnedMessageId,
      viewport.focusedMessageId,
      activeJumpMessageId,
      viewport.anchorMessageId,
    ].forEach((messageId) => {
      const position = messagePositionById.get(String(messageId || ''));
      if (!position) return;
      indices.add(position.index);
      if (rows[position.index - 1]?.type === 'unread') indices.add(position.index - 1);
    });
    return [...indices];
  }, [
    activeJumpMessageId,
    firstUnreadMessageId,
    messagePositionById,
    pinnedMessageId,
    rows,
    viewport.anchorMessageId,
    viewport.focusedMessageId,
  ]);
  const ranges = mergeVirtualTimelineRanges(primaryRange, pinnedIndices, rows.length);
  const renderedKeys = ranges.flatMap(
    ({ start, end }) => rows.slice(start, end).map((row) => row.key),
  );
  const renderedKeySignature = renderedKeys.join('\u001f');

  useLayoutEffect(() => {
    const activeKeys = new Set(rows.map((row) => row.measurementKey));
    const frame = requestAnimationFrame(() => {
      setMeasurements((current) => {
        if ([...current.keys()].every((key) => activeKeys.has(key))) return current;
        return new Map([...current].filter(([key]) => activeKeys.has(key)));
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [rows]);

  useLayoutEffect(() => {
    if (!virtualized) return undefined;
    const list = controllerRef.current?.parentElement;
    if (!list) return undefined;

    list.classList.add('message-timeline-virtualized');

    const readViewport = (requestedJumpId = '') => {
      const activeMessage = document.activeElement?.closest?.('li.chat-message');
      const listTop = list.getBoundingClientRect().top;
      const anchor = [...list.querySelectorAll(':scope > li.chat-message')]
        .find((candidate) => candidate.getBoundingClientRect().bottom > listTop);
      const next = {
        anchorMessageId: anchor?.id?.startsWith('msg-') ? anchor.id.slice(4) : '',
        focusedMessageId: activeMessage?.id?.startsWith('msg-')
          ? activeMessage.id.slice(4)
          : '',
        height: Math.max(1, list.clientHeight),
        jumpMessageId: String(requestedJumpId || pendingJumpMessageId()),
        scrollTop: Math.max(0, list.scrollTop),
      };
      setViewport((current) => (
        current.anchorMessageId === next.anchorMessageId
        && current.focusedMessageId === next.focusedMessageId
        && current.height === next.height
        && current.jumpMessageId === next.jumpMessageId
        && current.scrollTop === next.scrollTop
          ? current
          : next
      ));
    };
    const scheduleViewportRead = (requestedJumpId = '') => {
      if (viewportFrameRef.current) cancelAnimationFrame(viewportFrameRef.current);
      viewportFrameRef.current = requestAnimationFrame(() => {
        viewportFrameRef.current = null;
        readViewport(requestedJumpId);
      });
    };
    const handleJump = (event) => scheduleViewportRead(event.detail?.messageId);
    const handleInteraction = () => scheduleViewportRead();

    list.addEventListener('click', handleInteraction);
    list.addEventListener('focusin', handleInteraction);
    list.addEventListener('focusout', handleInteraction);
    list.addEventListener('scroll', handleInteraction, { passive: true });
    window.addEventListener('minimalist:message-jump', handleJump);
    const viewportObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(handleInteraction);
    viewportObserver?.observe(list);
    scheduleViewportRead();

    return () => {
      list.classList.remove('message-timeline-virtualized');
      list.removeEventListener('click', handleInteraction);
      list.removeEventListener('focusin', handleInteraction);
      list.removeEventListener('focusout', handleInteraction);
      list.removeEventListener('scroll', handleInteraction);
      window.removeEventListener('minimalist:message-jump', handleJump);
      viewportObserver?.disconnect();
      if (viewportFrameRef.current) {
        cancelAnimationFrame(viewportFrameRef.current);
        viewportFrameRef.current = null;
      }
      if (gapFrameRef.current) {
        cancelAnimationFrame(gapFrameRef.current);
        gapFrameRef.current = null;
      }
      if (measurementFrameRef.current) {
        cancelAnimationFrame(measurementFrameRef.current);
        measurementFrameRef.current = null;
      }
    };
  }, [scopeKey, virtualized]);

  useLayoutEffect(() => {
    if (!virtualized) return undefined;
    const list = controllerRef.current?.parentElement;
    if (!list) return undefined;

    const nextGap = Number.parseFloat(getComputedStyle(list).rowGap) || DEFAULT_TIMELINE_GAP;
    if (Math.abs(nextGap - timelineGap) > 0.25 && !gapFrameRef.current) {
      gapFrameRef.current = requestAnimationFrame(() => {
        gapFrameRef.current = null;
        setTimelineGap((current) => (
          Math.abs(current - nextGap) > 0.25 ? nextGap : current
        ));
      });
    }

    const commitPendingMeasurements = () => {
      if (measurementFrameRef.current) return;
      measurementFrameRef.current = requestAnimationFrame(() => {
        measurementFrameRef.current = null;
        const updates = pendingMeasurementsRef.current;
        pendingMeasurementsRef.current = new Map();
        if (!updates.size) return;
        setMeasurements((current) => {
          const next = new Map(current);
          updates.forEach((height, key) => next.set(key, height));
          return next;
        });
      });
    };

    const rowByKey = new Map(rows.map((row) => [row.key, row]));
    const measuredElements = [...list.querySelectorAll(':scope > li:not(.message-timeline-spacer)')]
      .filter((element) => {
        let key = element.dataset.timelineKey || '';
        if (!key && element.id?.startsWith('msg-')) {
          const messageId = element.id.slice(4);
          const position = messagePositionById.get(messageId);
          key = position?.key || '';
          if (position) {
            element.setAttribute('aria-posinset', String(position.position));
            element.setAttribute('aria-setsize', String(visibleMessages.length));
          }
        }
        if (!key || !rowByKey.has(key)) return false;
        element.dataset.timelineKey = key;
        return true;
      });

    const recordMeasurements = (entries) => {
      let changed = false;
      let compensation = 0;
      const wasAtBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 120;

      entries.forEach((entry) => {
        const element = entry.target;
        const key = element.dataset.timelineKey;
        const row = rowByKey.get(key);
        if (!row) return;
        const borderBox = Array.isArray(entry.borderBoxSize)
          ? entry.borderBoxSize[0]
          : entry.borderBoxSize;
        const height = Number(borderBox?.blockSize)
          || Number(element.offsetHeight)
          || element.getBoundingClientRect().height;
        if (!Number.isFinite(height) || height <= 0) return;

        const previous = pendingMeasurementsRef.current.get(row.measurementKey)
          || measurements.get(row.measurementKey)
          || estimateTimelineItemHeight(row);
        if (Math.abs(previous - height) < 0.5) return;
        pendingMeasurementsRef.current.set(row.measurementKey, height);
        changed = true;
        if ((rowIndexByKey.get(key) ?? Number.POSITIVE_INFINITY) < primaryRange.visibleStart) {
          compensation += height - previous;
        }
      });

      if (!changed) return;
      pendingCompensationRef.current += compensation;
      pendingStickToBottomRef.current ||= wasAtBottom;
      commitPendingMeasurements();
    };

    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(recordMeasurements);
    measuredElements.forEach((element) => observer?.observe(element));
    recordMeasurements(measuredElements.map((element) => ({
      contentRect: element.getBoundingClientRect(),
      target: element,
    })));

    return () => observer?.disconnect();
  }, [
    messagePositionById,
    measurements,
    primaryRange.visibleStart,
    renderedKeySignature,
    rowIndexByKey,
    rows,
    timelineGap,
    virtualized,
    visibleMessages.length,
  ]);

  useLayoutEffect(() => {
    if (!virtualized) return;
    const list = controllerRef.current?.parentElement;
    if (!list) return;

    if (pendingStickToBottomRef.current) {
      pendingStickToBottomRef.current = false;
      pendingCompensationRef.current = 0;
      list.scrollTo({ behavior: 'auto', top: list.scrollHeight });
      return;
    }
    if (!pendingCompensationRef.current) return;
    const compensation = pendingCompensationRef.current;
    pendingCompensationRef.current = 0;
    list.scrollBy({ behavior: 'auto', top: compensation });
  }, [measurements, virtualized]);

  useLayoutEffect(() => {
    if (!virtualized) return;
    const list = controllerRef.current?.parentElement;
    if (!list) return;

    const jump = window.pendingMessageJump;
    const jumpId = String(jump?.messageId || '');
    const jumpTarget = jumpId ? document.getElementById(`msg-${jumpId}`) : null;
    if (!jumpId) {
      notifiedJumpRef.current = '';
    } else if (jumpTarget && notifiedJumpRef.current !== jumpId) {
      notifiedJumpRef.current = jumpId;
      window.dispatchEvent(new CustomEvent('minimalist:message-jump', { detail: jump }));
    }
  });

  const renderRow = (row) => {
    if (row.type === 'date' || row.type === 'activity') {
      return <Separator item={row} key={row.key} virtualKey={row.key} />;
    }
    if (row.type === 'unread') {
      return (
        <li
          className="message-unread-separator"
          data-timeline-key={row.key}
          key={row.key}
        >
          <span
            aria-label={translate('chat.unread.label', {}, locale)}
            role="separator"
          >
            {translate('chat.unread.label', {}, locale)}
          </span>
        </li>
      );
    }

    return renderMessage(row.message, row.renderIndex, row.message.deliveryState ? (
      <MessageDeliveryState
        error={row.message.deliveryError}
        messageId={row.message.id}
        onCancel={onCancelDelivery}
        onRetry={onRetryDelivery}
        progress={row.message.deliveryProgress}
        state={row.message.deliveryState}
      />
    ) : null);
  };

  if (!virtualized) return rows.map(renderRow);

  const children = [];
  let cursor = 0;
  ranges.forEach((range, rangeIndex) => {
    if (rangeIndex === 0) {
      children.push(
        <VirtualSpacer
          end={range.start}
          height={hiddenRangeHeight(layout, 0, range.start)}
          key="virtual-controller"
          spacerRef={controllerRef}
          start={0}
        />,
      );
    } else if (range.start > cursor) {
      children.push(
        <VirtualSpacer
          end={range.start}
          height={hiddenRangeHeight(layout, cursor, range.start)}
          key={`virtual-gap:${cursor}:${range.start}`}
          start={cursor}
        />,
      );
    }

    for (let index = range.start; index < range.end; index += 1) {
      children.push(renderRow(rows[index]));
    }
    cursor = range.end;
  });

  if (cursor < rows.length) {
    children.push(
      <VirtualSpacer
        end={rows.length}
        height={hiddenRangeHeight(layout, cursor, rows.length)}
        key={`virtual-gap:${cursor}:${rows.length}`}
        start={cursor}
      />,
    );
  }

  return children;
}
