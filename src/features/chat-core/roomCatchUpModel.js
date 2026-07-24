const RECENT_MESSAGE_LIMIT = 18;
const FIRST_USE_MINIMUM = 3;
const ACTION_PATTERN = /\b(need|please|todo|task|fix|review|follow[ -]?up|remind|deadline|due|ship|decide|confirm|can you|could you|should)\b/i;
const QUESTION_PATTERN = /[?？]\s*$|^(can|could|would|will|do|does|did|is|are|should|what|when|where|who|why|how)\b/i;

function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function messageText(message) {
  return compactText(message?.text || message?.reminder?.text || message?.poll?.question || '');
}

function hasContent(message) {
  return Boolean(
    message?.id
    && message?.deleted !== true
    && (
      message?.text
      || message?.attachedImage
      || message?.attachedFile
      || message?.poll
      || message?.reminder
    )
  );
}

function isAutomation(message) {
  return Boolean(message?.aiAgent || message?.automation || message?.bot);
}

function escapePattern(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mentionHandles(viewer = {}) {
  const name = compactText(viewer.name).replace(/^@+/, '');
  const shortId = compactText(viewer.shortId).replace(/^@+/, '');
  return [...new Set([
    shortId,
    name && !/\s/.test(name) ? name : '',
  ].filter(Boolean).map((value) => value.toLowerCase()))];
}

function mentionsViewer(text, viewer) {
  return mentionHandles(viewer).some((handle) => (
    new RegExp(`(^|[^A-Za-z0-9_-])@${escapePattern(handle)}(?=$|[^A-Za-z0-9_-])`, 'i').test(text)
  ));
}

function contributorKey(message, index) {
  return compactText(message?.uid) || compactText(message?.name).toLowerCase() || `message-${index}`;
}

function attachmentFallback(message) {
  if (message?.attachedFile?.name) return `Shared ${compactText(message.attachedFile.name)}`;
  if (message?.attachedFile) return 'Shared a file';
  if (message?.attachedImage) return 'Shared an image';
  if (message?.poll?.question) return `Poll: ${compactText(message.poll.question)}`;
  if (message?.reminder?.text) return `Reminder: ${compactText(message.reminder.text)}`;
  return 'Shared an update';
}

function previewText(message, maxLength = 148) {
  const text = messageText(message) || attachmentFallback(message);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function classify(message, viewer) {
  const text = messageText(message);
  return {
    action: ACTION_PATTERN.test(text),
    automation: isAutomation(message),
    file: Boolean(message?.attachedFile || message?.attachedImage),
    important: message?.important === true,
    mention: mentionsViewer(text, viewer),
    question: QUESTION_PATTERN.test(text),
    text,
  };
}

function highlightScore(message, viewer) {
  const flags = classify(message, viewer);
  const humanBoost = flags.automation ? 0 : 100;
  if (flags.mention) return humanBoost + 70;
  if (flags.important) return humanBoost + 60;
  if (flags.action) return humanBoost + 50;
  if (flags.question) return humanBoost + 40;
  if (flags.file) return humanBoost + 30;
  return humanBoost + 10;
}

function highlightLabel(message, viewer) {
  const flags = classify(message, viewer);
  if (flags.mention) return 'Mentioned you';
  if (flags.important) return 'Important';
  if (flags.action) return 'Needs attention';
  if (flags.question) return 'Open question';
  if (flags.file) return 'Shared file';
  return flags.automation ? 'Automation update' : 'Latest update';
}

function selectHighlight(messages, viewer) {
  return messages.reduce((best, message, index) => {
    const score = highlightScore(message, viewer);
    if (!best || score > best.score || (score === best.score && index > best.index)) {
      return { index, message, score };
    }
    return best;
  }, null)?.message || messages[messages.length - 1];
}

function plural(count, singular, pluralValue = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralValue}`;
}

/**
 * Builds a truthful, deterministic digest over the bounded message tail.
 * A saved review boundary turns the next batch into "new" activity. Without a
 * boundary, the model deliberately says "Recent activity" instead of unread.
 */
export function buildRoomCatchUp(messages, options = {}) {
  const source = Array.isArray(messages) ? messages : [];
  const recent = source.filter(hasContent).slice(-RECENT_MESSAGE_LIMIT);
  const viewer = {
    uid: compactText(options.viewerUid),
    name: compactText(options.viewerName),
    shortId: compactText(options.viewerShortId),
  };
  const reviewedMessageId = compactText(options.reviewedMessageId);
  const reviewedIndex = reviewedMessageId
    ? recent.findIndex((message) => message.id === reviewedMessageId)
    : -1;
  const hasBoundary = reviewedIndex >= 0;
  const boundaryMissing = Boolean(reviewedMessageId) && !hasBoundary;
  const scoped = hasBoundary ? recent.slice(reviewedIndex + 1) : recent;
  const reviewMessages = scoped.filter((message) => (
    !viewer.uid || message.uid !== viewer.uid || isAutomation(message)
  ));

  if (!reviewMessages.length) return null;
  if (!reviewedMessageId && reviewMessages.length < FIRST_USE_MINIMUM) return null;

  const flags = reviewMessages.map((message) => classify(message, viewer));
  const contributors = new Set(reviewMessages.map(contributorKey));
  const counts = {
    files: flags.filter((item) => item.file).length,
    important: flags.filter((item) => item.important).length,
    mentions: flags.filter((item) => item.mention).length,
    questions: flags.filter((item) => item.question).length,
  };
  const highlightMessage = selectHighlight(reviewMessages, viewer);
  const taskMessage = [...reviewMessages].reverse().find((message) => {
    const item = classify(message, viewer);
    return item.action && !item.automation;
  });
  const updateCount = reviewMessages.length;
  const title = hasBoundary
    ? plural(updateCount, 'new update')
    : boundaryMissing
      ? `${updateCount}+ recent updates`
      : 'Recent activity';
  const signals = [
    plural(contributors.size || 1, 'contributor'),
    counts.mentions ? plural(counts.mentions, 'mention') : '',
    counts.questions ? plural(counts.questions, 'question') : '',
    counts.files ? plural(counts.files, 'file') : '',
    counts.important ? `${counts.important} important` : '',
  ].filter(Boolean);

  return {
    boundaryMissing,
    counts,
    highlight: {
      id: highlightMessage.id,
      label: highlightLabel(highlightMessage, viewer),
      name: compactText(highlightMessage.name) || (isAutomation(highlightMessage) ? 'Automation' : 'Someone'),
      text: previewText(highlightMessage),
    },
    latestId: recent[recent.length - 1]?.id || reviewMessages[reviewMessages.length - 1]?.id || '',
    reviewMessageIds: reviewMessages.map((message) => message.id),
    signals,
    taskText: taskMessage ? previewText(taskMessage, 220) : '',
    title,
    updateCount,
  };
}

export const ROOM_CATCHUP_MODEL_LIMIT = RECENT_MESSAGE_LIMIT;
