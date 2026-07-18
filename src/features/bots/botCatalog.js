/**
 * @typedef {'stockTracker' | 'autoModeration'} RoomBotId
 * @typedef {'stock' | 'automod'} RoomBotDetailKey
 * @typedef {'client-after-send' | 'client-before-send'} RoomBotExecutionMode
 * @typedef {{
 *   id: RoomBotId,
 *   name: string,
 *   category: 'Productivity' | 'Safety',
 *   summary: string,
 *   icon: string,
 *   iconTone: 'yellow' | 'ink',
 *   detailKey: RoomBotDetailKey,
 *   domKey: RoomBotDetailKey,
 *   installedRowId: string,
 *   statusId: string,
 *   marketActionId: string,
 *   marketStatusId: string,
 *   installLabel: string,
 *   configureLabel: string,
 *   executionMode: RoomBotExecutionMode,
 *   executionLabel: string,
 *   trustLabel: string,
 *   trustDetails: string,
 *   trigger: string,
 *   capabilities: readonly string[],
 *   dataAccess: readonly string[],
 *   networkAccess: readonly string[],
 *   writes: readonly string[],
 *   limitations: readonly string[],
 *   manifest: Readonly<{
 *     id: RoomBotId,
 *     publisher: string,
 *     distribution: string,
 *     permission: 'manageBots',
 *     configPath: string,
 *     scope: string,
 *   }>,
 * }} RoomBotCatalogEntry
 */

const freezeList = (items) => Object.freeze(items);

/** @type {readonly RoomBotCatalogEntry[]} */
export const ROOM_BOT_CATALOG = Object.freeze([
  Object.freeze({
    id: 'stockTracker',
    name: 'Ticker Mention Watcher',
    category: 'Productivity',
    summary: 'Posts a quote after a sent room message contains $TICKER or one of the room’s configured watch symbols.',
    icon: 'ph-trend-up',
    iconTone: 'yellow',
    detailKey: 'stock',
    domKey: 'stock',
    installedRowId: 'rs-installed-stock-row',
    statusId: 'rs-stock-status',
    marketActionId: 'rs-stock-market-action',
    marketStatusId: 'rs-stock-market-status',
    installLabel: 'Install watcher',
    configureLabel: 'Configure watcher',
    executionMode: 'client-after-send',
    executionLabel: 'Sender client · after send',
    trustLabel: 'Client-run · not server-enforced',
    trustDetails: 'Room rules protect who can save this configuration, but there is no server worker watching messages. The sender’s current app detects symbols, requests quotes, and posts each automation reply under that user’s UID.',
    trigger: 'A newly sent message contains a $CASHTAG or a configured symbol; at most three symbols are handled per message.',
    capabilities: freezeList([
      'Watch up to 12 configured ticker symbols',
      'Recognize $TICKER mentions',
      'Post up to 3 quote replies for one message',
    ]),
    dataAccess: freezeList([
      'The current sent message text, processed in the sender’s app',
      'The room’s stockTracker configuration',
      'The requesting user’s profile metadata used on the automation reply',
    ]),
    networkAccess: freezeList([
      'Sends only the extracted ticker symbol to Minimalist’s authenticated stockQuote endpoint',
      'That server endpoint requests public quote data from Yahoo Finance, with Stooq as fallback',
    ]),
    writes: freezeList([
      'A quote or provider-error reply in the same channel, marked as automation and owned by the requesting user',
      'The room last-message preview after an automation reply posts',
    ]),
    limitations: freezeList([
      'No background or server-side room watcher runs when clients are offline',
      'The built-in /stock command works without installing this watcher',
      'Quotes are informational and may be delayed',
    ]),
    manifest: Object.freeze({
      id: 'stockTracker',
      publisher: 'Minimalist Chat',
      distribution: 'Bundled with the current app',
      permission: 'manageBots',
      configPath: '/rooms_meta/{roomId}/bots/stockTracker',
      scope: 'Room configuration; execution in the sender’s current client',
    }),
  }),
  Object.freeze({
    id: 'autoModeration',
    name: 'Basic Message Filter',
    category: 'Safety',
    summary: 'Checks a draft for configured words, links, flood text, and excessive caps before a supported current client posts it.',
    icon: 'ph-shield-check',
    iconTone: 'ink',
    detailKey: 'automod',
    domKey: 'automod',
    installedRowId: 'rs-installed-automod-row',
    statusId: 'rs-automod-status',
    marketActionId: 'rs-automod-market-action',
    marketStatusId: 'rs-automod-market-status',
    installLabel: 'Install guard',
    configureLabel: 'Configure guard',
    executionMode: 'client-before-send',
    executionLabel: 'Sender client · before send',
    trustLabel: 'Client-run · not server-enforced',
    trustDetails: 'Room rules protect who can save this configuration, but they do not apply the filter to message writes. The check runs only in supported current clients, so older or modified clients can bypass it.',
    trigger: 'A member attempts to send text from a supported current client while the room filter is enabled.',
    capabilities: freezeList([
      'Block up to 40 configured words or phrases',
      'Optionally block links',
      'Detect repeated-character flood text',
      'Detect long messages with excessive caps',
    ]),
    dataAccess: freezeList([
      'Draft message text before send, processed in the sender’s app',
      'The room’s autoModeration configuration',
      'The requesting user’s display name used in a blocked-message notice',
    ]),
    networkAccess: freezeList([
      'Filtering itself makes no third-party request',
      'The room configuration is loaded from Firebase Realtime Database',
    ]),
    writes: freezeList([
      'Prevents the original draft from being posted by the current client when a check matches',
      'Posts a reason-only room notice under the requesting user; the full original draft is not included',
    ]),
    limitations: freezeList([
      'This is not server-enforced moderation',
      'Older or modified clients can bypass client-side checks',
      'The notice can include the matched blocked keyword as part of the reason',
    ]),
    manifest: Object.freeze({
      id: 'autoModeration',
      publisher: 'Minimalist Chat',
      distribution: 'Bundled with the current app',
      permission: 'manageBots',
      configPath: '/rooms_meta/{roomId}/bots/autoModeration',
      scope: 'Room configuration; execution in the sender’s current client',
    }),
  }),
]);

export const ROOM_BOT_IDS = Object.freeze(ROOM_BOT_CATALOG.map((bot) => bot.id));

/**
 * Slash commands owned by the platform/bot surface. `/stock` is deliberately
 * described as a built-in quote command; installing the watcher only enables
 * automatic ticker-mention responses.
 */
export const PLATFORM_BOT_SLASH_COMMANDS = Object.freeze([
  Object.freeze({
    command: '/stock',
    description: 'Get a built-in stock quote (the mention watcher is not required)',
    action: 'stock',
  }),
  Object.freeze({
    command: '/automod on',
    description: 'Enable the room’s client-side basic message filter',
    action: 'automodOn',
  }),
  Object.freeze({
    command: '/automod off',
    description: 'Disable the room’s client-side basic message filter',
    action: 'automodOff',
  }),
]);

/** @param {RoomBotId | string} id */
export function getRoomBotCatalogEntry(id) {
  return ROOM_BOT_CATALOG.find((bot) => bot.id === id) || null;
}
