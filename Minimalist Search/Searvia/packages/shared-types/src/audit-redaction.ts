const URL_LIKE_TEXT =
  /https?:\/\/[^\s<>"']+|\/\/[^\s<>"'/?#]*@[^\s<>"']+|\/\/[a-z0-9[\].:-]+(?:\/[^\s<>"'?#]*)?[?#][^\s<>"']+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?(?:\/[^\s<>"'?#]*)?[?#][^\s<>"']+|\/(?!\/)[^\s<>"'?#]*[?#][^\s<>"']+/giu;

function splitTrailingDelimiters(value: string): Readonly<{ core: string; suffix: string }> {
  let end = value.length;
  const unmatchedClosers = new Map<string, number>([
    [")", 0],
    ["]", 0],
    ["}", 0],
  ]);
  const openers = new Map<string, string>([
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
  ]);
  for (const character of value) {
    const closer = openers.get(character);
    if (closer !== undefined) {
      unmatchedClosers.set(closer, (unmatchedClosers.get(closer) ?? 0) - 1);
    } else if (unmatchedClosers.has(character)) {
      unmatchedClosers.set(character, (unmatchedClosers.get(character) ?? 0) + 1);
    }
  }
  while (end > 0) {
    const last = value[end - 1] ?? "";
    if (".,;!".includes(last)) {
      end -= 1;
      continue;
    }
    const unmatched = unmatchedClosers.get(last) ?? 0;
    if (unmatched <= 0) break;
    unmatchedClosers.set(last, unmatched - 1);
    end -= 1;
  }
  return Object.freeze({ core: value.slice(0, end), suffix: value.slice(end) });
}

function isHttpUrlLike(value: string): boolean {
  try {
    const parseable = value.startsWith("//")
      ? `https:${value}`
      : value.startsWith("/")
        ? new URL(value, "https://redaction.invalid").href
        : /^https?:\/\//iu.test(value)
          ? value
          : `https://${value}`;
    const parsed = new URL(parseable);
    return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname !== "";
  } catch {
    return false;
  }
}

function redactQuerySegment(segment: string): string {
  if (segment === "") return "";
  const equals = segment.indexOf("=");
  return equals < 0 ? "[redacted]" : `${segment.slice(0, equals)}=[redacted]`;
}

function redactUrlUserInfo(value: string): string {
  const protocol = /^https?:\/\//iu.exec(value);
  const authorityStart = protocol?.[0].length ?? (value.startsWith("//") ? 2 : -1);
  if (authorityStart < 0) return value;
  const firstPathDetail = [
    value.indexOf("/", authorityStart),
    value.indexOf("?", authorityStart),
    value.indexOf("#", authorityStart),
  ]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  const authorityEnd = firstPathDetail ?? value.length;
  const lastAt = value.lastIndexOf("@", authorityEnd - 1);
  if (lastAt < authorityStart) return value;
  return `${value.slice(0, authorityStart)}[redacted]@${value.slice(lastAt + 1)}`;
}

/**
 * Preserves useful URL origins and paths while removing user-info, query values,
 * and fragment details from audit-bound text.
 */
export function redactAuditUrlDetails(value: string): string {
  return value.replace(URL_LIKE_TEXT, (candidate) => {
    const { core, suffix } = splitTrailingDelimiters(candidate);
    if (!isHttpUrlLike(core)) return candidate;

    const safeCore = redactUrlUserInfo(core);
    const query = safeCore.indexOf("?");
    const fragment = safeCore.indexOf("#");
    const detailIndexes = [query, fragment].filter((index) => index >= 0);
    if (detailIndexes.length === 0) return `${safeCore}${suffix}`;
    const pathEnd = Math.min(...detailIndexes);
    let redacted = safeCore.slice(0, pathEnd);
    if (query >= 0 && (fragment < 0 || query < fragment)) {
      const queryEnd = fragment < 0 ? safeCore.length : fragment;
      redacted += `?${safeCore
        .slice(query + 1, queryEnd)
        .split("&")
        .map(redactQuerySegment)
        .join("&")}`;
    }
    if (fragment >= 0) redacted += "#[redacted]";
    return `${redacted}${suffix}`;
  });
}
