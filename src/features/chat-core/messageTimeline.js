function validTimestamp(value, fallback = Date.now()) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : fallback;
}

export function messageDayKey(timestamp, fallback = Date.now()) {
  const date = new Date(validTimestamp(timestamp, fallback));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function messageDateLabel(timestamp, now = Date.now()) {
  const date = new Date(validTimestamp(timestamp, now));
  const today = new Date(now);
  const yesterday = new Date(now);
  yesterday.setDate(today.getDate() - 1);

  if (messageDayKey(date.getTime(), now) === messageDayKey(today.getTime(), now)) return 'Today';
  if (messageDayKey(date.getTime(), now) === messageDayKey(yesterday.getTime(), now)) return 'Yesterday';

  const daysAgo = Math.floor((new Date(today.getFullYear(), today.getMonth(), today.getDate())
    - new Date(date.getFullYear(), date.getMonth(), date.getDate())) / 86400000);
  if (daysAgo >= 0 && daysAgo < 7) return date.toLocaleDateString([], { weekday: 'long' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

export function activityEventPresentation(activityEvent = {}) {
  const type = String(activityEvent.type || 'activity');
  const defaults = {
    poll_closed: { icon: 'ph-chart-bar', label: 'Poll closed' },
    task_created: { icon: 'ph-check-square-offset', label: 'Task created' },
  };
  const fallback = defaults[type] || { icon: 'ph-lightning', label: 'Room activity' };
  return {
    type,
    icon: fallback.icon,
    label: String(activityEvent.label || fallback.label).slice(0, 80),
    detail: String(activityEvent.detail || '').replace(/\s+/g, ' ').trim().slice(0, 180),
  };
}

export function buildMessageTimeline(messages = [], now = Date.now()) {
  const items = [];
  let previousDay = '';

  messages.forEach((message) => {
    const dayKey = messageDayKey(message.timestamp, now);
    if (dayKey !== previousDay) {
      items.push({
        type: 'date',
        key: `date:${dayKey}`,
        label: messageDateLabel(message.timestamp, now),
      });
      previousDay = dayKey;
    }

    if (message.activityEvent) {
      items.push({
        type: 'activity',
        key: `activity:${message.id}`,
        message,
        presentation: activityEventPresentation(message.activityEvent),
      });
      return;
    }

    items.push({ type: 'message', key: message.id, message });
  });

  return items;
}

const DEFAULT_TIMELINE_ROW_HEIGHT = 96;

export function estimateTimelineItemHeight(item = {}) {
  if (item.type === 'date') return 22;
  if (item.type === 'activity') return 42;
  if (item.type === 'unread') return 30;
  if (item.type !== 'message') return DEFAULT_TIMELINE_ROW_HEIGHT;

  const message = item.message || {};
  const textLength = String(message.text || message.transcript || '').length;
  const estimatedTextLines = Math.min(10, Math.max(1, Math.ceil(textLength / 64)));
  let height = 66 + estimatedTextLines * 20;

  if (message.replyTo) height += 44;
  if (message.linkPreview) height += 96;
  if (message.poll) height += 132;
  if (
    message.attachedImage
    || message.imageUrl
    || message.image
    || message.photoUrl && message.type === 'image'
  ) height += 180;
  if (message.attachedFile || message.file || message.fileUrl || message.attachment) height += 58;
  if (message.deliveryState) height += 28;

  return Math.min(420, Math.max(DEFAULT_TIMELINE_ROW_HEIGHT, height));
}

function measuredTimelineHeight(measurements, item) {
  if (!measurements) return 0;
  const key = item.measurementKey || item.key;
  const value = typeof measurements.get === 'function'
    ? measurements.get(key)
    : measurements[key];
  const height = Number(value);
  return Number.isFinite(height) && height > 0 ? height : 0;
}

export function buildVirtualTimelineLayout(items = [], measurements, gap = 0) {
  const safeGap = Math.max(0, Number(gap) || 0);
  const offsets = new Array(items.length + 1);
  const heights = new Array(items.length);
  offsets[0] = 0;

  items.forEach((item, index) => {
    const height = measuredTimelineHeight(measurements, item)
      || estimateTimelineItemHeight(item);
    heights[index] = height;
    offsets[index + 1] = offsets[index] + height + safeGap;
  });

  return {
    gap: safeGap,
    heights,
    offsets,
    totalHeight: items.length ? Math.max(0, offsets.at(-1) - safeGap) : 0,
  };
}

export function timelineIndexAtOffset(offsets = [0], offset = 0) {
  const itemCount = Math.max(0, offsets.length - 1);
  if (!itemCount) return 0;

  const target = Math.max(0, Number(offset) || 0);
  let low = 0;
  let high = itemCount;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle + 1] <= target) low = middle + 1;
    else high = middle;
  }

  return Math.min(itemCount - 1, low);
}

export function buildVirtualTimelineWindow(layout, {
  maxRows = 68,
  minRows = 40,
  overscan = 1200,
  scrollTop = 0,
  viewportHeight = 720,
} = {}) {
  const itemCount = Math.max(0, (layout?.offsets?.length || 1) - 1);
  if (!itemCount) return { start: 0, end: 0, visibleStart: 0, visibleEnd: 0 };

  const safeScrollTop = Math.max(0, Number(scrollTop) || 0);
  const safeViewportHeight = Math.max(1, Number(viewportHeight) || 1);
  const safeOverscan = Math.max(0, Number(overscan) || 0);
  const visibleStart = timelineIndexAtOffset(layout.offsets, safeScrollTop);
  const visibleEnd = Math.min(
    itemCount,
    timelineIndexAtOffset(layout.offsets, safeScrollTop + safeViewportHeight) + 1,
  );
  let start = timelineIndexAtOffset(layout.offsets, Math.max(0, safeScrollTop - safeOverscan));
  let end = Math.min(
    itemCount,
    timelineIndexAtOffset(layout.offsets, safeScrollTop + safeViewportHeight + safeOverscan) + 1,
  );

  const minimum = Math.min(itemCount, Math.max(1, Number(minRows) || 1));
  if (end - start < minimum) {
    const missing = minimum - (end - start);
    const before = Math.min(start, Math.ceil(missing / 2));
    start -= before;
    end = Math.min(itemCount, end + missing - before);
    start = Math.max(0, end - minimum);
  }

  const visibleRows = Math.max(1, visibleEnd - visibleStart);
  const maximum = Math.min(
    itemCount,
    Math.max(visibleRows, minimum, Number(maxRows) || minimum),
  );
  if (end - start > maximum) {
    const visibleCenter = Math.floor((visibleStart + visibleEnd) / 2);
    start = Math.max(0, visibleCenter - Math.floor(maximum / 2));
    end = Math.min(itemCount, start + maximum);
    start = Math.max(0, end - maximum);
  }

  return { start, end, visibleStart, visibleEnd };
}

export function mergeVirtualTimelineRanges(primaryRange, pinnedIndices = [], itemCount = 0) {
  const safeCount = Math.max(0, Number(itemCount) || 0);
  if (!safeCount) return [];

  const ranges = [];
  if (primaryRange?.end > primaryRange?.start) {
    ranges.push({
      start: Math.max(0, primaryRange.start),
      end: Math.min(safeCount, primaryRange.end),
    });
  }
  pinnedIndices.forEach((index) => {
    const safeIndex = Number(index);
    if (!Number.isInteger(safeIndex) || safeIndex < 0 || safeIndex >= safeCount) return;
    ranges.push({ start: safeIndex, end: safeIndex + 1 });
  });
  ranges.sort((left, right) => left.start - right.start);

  return ranges.reduce((merged, range) => {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
    return merged;
  }, []);
}
