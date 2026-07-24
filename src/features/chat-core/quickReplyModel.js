export const QUICK_REPLY_MESSAGE_LIMIT = 12;
export const QUICK_REPLY_PAGE_SIZE = 3;

const QUESTION_START = /^(can|could|would|will|do|does|did|is|are|should|what|when|where|who|why|how)\b/i;
const AUTOMATION_ERROR = /\b(error|failed|failure|unavailable|not responding|couldn'?t|cannot|can'?t|unable|timed? out|404|500)\b/i;

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isAutomationMessage(message = {}) {
  return Boolean(
    message.aiAgent
    || message.automation
    || message.automationId
    || message.bot
    || message.botName
  );
}

function hasReplyContent(message = {}) {
  return Boolean(
    cleanText(message.text)
    || message.attachedFile
    || message.attachedImage
    || message.poll
    || message.reminder
  );
}

function isConversationMessage(message = {}) {
  return hasReplyContent(message) && message.system !== true && message.activity !== true;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mentionHandles(viewerName, viewerShortId) {
  const values = [viewerShortId, viewerName]
    .map((value) => cleanText(value).replace(/^@+/, ''))
    .filter((value) => value && !/\s/.test(value));
  return [...new Set(values.map((value) => value.toLowerCase()))];
}

function strictlyMentionsViewer(text, viewerName, viewerShortId) {
  return mentionHandles(viewerName, viewerShortId).some((handle) => {
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_-])@${escapeRegExp(handle)}(?=$|[^\\p{L}\\p{N}_-])`, 'iu');
    return pattern.test(String(text || ''));
  });
}

function suggestionId(intent, text) {
  return `${intent}:${text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

function addSuggestions(list, intent, ...texts) {
  texts.forEach((value) => {
    const text = cleanText(value);
    if (!text || list.some((item) => item.text.toLowerCase() === text.toLowerCase())) return;
    list.push({ id: suggestionId(intent, text), intent, text });
  });
}

function sourceKind(message, text, mentioned) {
  if (message.attachedFile || message.attachedImage) return 'attachment';
  if (message.poll) return 'poll';
  if (message.reminder) return 'reminder';
  if (isAutomationMessage(message)) return AUTOMATION_ERROR.test(text) ? 'automation-error' : 'automation';
  if (mentioned) return 'mention';
  if (/[?？]\s*$/.test(text) || QUESTION_START.test(text)) return 'question';
  return 'message';
}

function buildSuggestionSets(candidates) {
  const bounded = candidates.slice(0, 6);
  const pageCount = Math.max(1, Math.min(2, Math.ceil(bounded.length / QUICK_REPLY_PAGE_SIZE)));
  return Array.from({ length: pageCount }, (_, pageIndex) => {
    const start = pageIndex * QUICK_REPLY_PAGE_SIZE;
    return Array.from({ length: Math.min(QUICK_REPLY_PAGE_SIZE, bounded.length) }, (_unused, offset) => (
      bounded[(start + offset) % bounded.length]
    ));
  });
}

function pickSource(messages, replyTarget) {
  if (replyTarget?.id && hasReplyContent(replyTarget)) {
    return { ...replyTarget, explicitReplyTarget: true };
  }

  const bounded = Array.isArray(messages) ? messages.slice(-QUICK_REPLY_MESSAGE_LIMIT) : [];
  for (let index = bounded.length - 1; index >= 0; index -= 1) {
    if (isConversationMessage(bounded[index])) return bounded[index];
  }
  return null;
}

export function buildQuickReplyModel(messages, {
  replyTarget = null,
  viewerId = '',
  viewerName = '',
  viewerShortId = '',
} = {}) {
  const source = pickSource(messages, replyTarget);
  if (!source) return null;

  const automation = isAutomationMessage(source);
  if (!source.explicitReplyTarget && viewerId && source.uid === viewerId && !automation) return null;

  const text = cleanText(source.text);
  const lower = text.toLowerCase();
  const mentioned = strictlyMentionsViewer(text, viewerName, viewerShortId);
  const candidates = [];

  if (automation && AUTOMATION_ERROR.test(text)) {
    addSuggestions(candidates, 'act', 'I’ll try another source.');
    addSuggestions(candidates, 'verify', 'Can someone verify this?');
    addSuggestions(candidates, 'clarify', 'What failed?');
    addSuggestions(candidates, 'retry', 'Let’s retry in a moment.');
    addSuggestions(candidates, 'clarify', 'Is there another source?');
    addSuggestions(candidates, 'act', 'I’ll check it manually.');
  } else if (source.attachedFile || source.attachedImage) {
    addSuggestions(candidates, 'review', 'I’ll review this.');
    addSuggestions(candidates, 'clarify', 'What should I focus on?');
    addSuggestions(candidates, 'thanks', 'Thanks for sharing this.');
    addSuggestions(candidates, 'review', 'I’ll take a closer look.');
    addSuggestions(candidates, 'clarify', 'Is there a deadline?');
    addSuggestions(candidates, 'act', 'I’ll reply with notes.');
  } else if (source.poll) {
    addSuggestions(candidates, 'review', 'I’ll look at the options.');
    addSuggestions(candidates, 'clarify', 'Which option do you recommend?');
    addSuggestions(candidates, 'clarify', 'When does voting close?');
    addSuggestions(candidates, 'decision', 'I’m leaning toward the first option.');
  } else if (source.reminder) {
    addSuggestions(candidates, 'thanks', 'Thanks for the reminder.');
    addSuggestions(candidates, 'clarify', 'What time is that?');
    addSuggestions(candidates, 'plan', 'I’ll plan around it.');
    addSuggestions(candidates, 'clarify', 'Can you share the details?');
  } else {
    if (mentioned) {
      addSuggestions(candidates, 'act', 'I’m on it.');
      addSuggestions(candidates, 'clarify', 'Can you send one more detail?');
      addSuggestions(candidates, 'plan', 'When do you need this?');
    }

    if (/\b(error|bug|broken|issue|not working|failed|crash|stuck|can'?t|unable)\b/i.test(text)) {
      addSuggestions(candidates, 'act', 'I’ll look into it.');
      addSuggestions(candidates, 'clarify', 'Can you share the exact error?');
      addSuggestions(candidates, 'clarify', 'What changed before it broke?');
    }

    if (/\b(meet|meeting|call|voice|video|schedule|calendar|today|tomorrow|tonight|deadline|due|time)\b/i.test(text)) {
      addSuggestions(candidates, 'confirm', 'That time works for me.');
      addSuggestions(candidates, 'clarify', 'Can we confirm the time?');
      addSuggestions(candidates, 'plan', 'I’ll plan for it.');
    }

    if (/\b(choose|which|option|vote|decide|pick|prefer|better)\b/i.test(text)) {
      addSuggestions(candidates, 'decision', 'I prefer the simpler option.');
      addSuggestions(candidates, 'clarify', 'Can we compare both?');
      addSuggestions(candidates, 'confirm', 'I’m good with that choice.');
    }

    if (/\b(done|finished|complete|fixed|works|working|looks good|sounds good|ship)\b/i.test(text)) {
      addSuggestions(candidates, 'confirm', 'Looks good to me.');
      addSuggestions(candidates, 'thanks', 'Thanks for the update.');
      addSuggestions(candidates, 'clarify', 'What’s next?');
    }

    if (/[?？]\s*$/.test(text) || QUESTION_START.test(text)) {
      if (/^(when|what time)\b/i.test(text)) {
        addSuggestions(candidates, 'plan', 'Today works for me.', 'What time are you thinking?', 'Can we do tomorrow?');
      } else if (/^where\b/i.test(text)) {
        addSuggestions(candidates, 'clarify', 'Can you send the location?', 'Can you share the link?');
        addSuggestions(candidates, 'confirm', 'I can meet there.');
      } else if (/^who\b/i.test(text)) {
        addSuggestions(candidates, 'act', 'I can take this.');
        addSuggestions(candidates, 'clarify', 'Who should we loop in?', 'Should we ask the room?');
      } else if (/^(how|why)\b/i.test(text)) {
        addSuggestions(candidates, 'act', 'I can walk through it.');
        addSuggestions(candidates, 'clarify', 'Can you show an example?', 'What have you tried so far?');
      } else {
        addSuggestions(candidates, 'confirm', 'Yes, that works for me.');
        addSuggestions(candidates, 'act', 'I’ll check and get back to you.');
        addSuggestions(candidates, 'clarify', 'Can you clarify one detail?');
      }
    }

    if (/\b(hi|hello|hey|yo|good morning|good afternoon|good evening)\b/i.test(lower)) {
      addSuggestions(candidates, 'greeting', 'Hey! What’s up?', 'Hi, good to see you.');
      addSuggestions(candidates, 'clarify', 'How can I help?');
    }

    if (/\b(thanks|thank you|appreciate)\b/i.test(lower)) {
      addSuggestions(candidates, 'thanks', 'Anytime!', 'No problem.', 'Glad it helped.');
    }

    if (/\b(sorry|my bad|apologies)\b/i.test(lower)) {
      addSuggestions(candidates, 'reassure', 'No worries.', 'You’re good.', 'All good—thanks for the update.');
    }

    if (automation) {
      addSuggestions(candidates, 'thanks', 'Thanks for the update.');
      addSuggestions(candidates, 'clarify', 'Can you explain that?', 'What should I do next?');
      addSuggestions(candidates, 'act', 'I’ll take a look.');
    }
  }

  addSuggestions(candidates, 'confirm', 'Sounds good.');
  addSuggestions(candidates, 'clarify', 'Tell me more.');
  addSuggestions(candidates, 'act', 'I’ll take a look.');

  const name = cleanText(source.name || source.botName) || 'Latest message';
  return {
    sets: buildSuggestionSets(candidates),
    source: {
      id: String(source.id || ''),
      kind: sourceKind(source, text, mentioned),
      mode: source.explicitReplyTarget ? 'reply' : 'latest',
      name,
      preview: text.slice(0, 120),
    },
  };
}
