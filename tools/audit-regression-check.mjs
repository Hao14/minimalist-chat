import { readFileSync } from 'node:fs';
import { buildGoogleCalendarUrl } from '../src/features/calendar/googleCalendarLink.js';
import { PLATFORM_BOT_SLASH_COMMANDS, ROOM_BOT_CATALOG } from '../src/features/bots/botCatalog.js';
import {
  detectAutoModeration,
  extractStockSymbols,
  normalizeRoomBotConfig,
} from '../src/features/bots/botRuntime.js';
import {
  loadPersonalAgentPreferences,
  PERSONAL_AGENT_DESKTOP_ENABLED_STORAGE_KEY,
  PERSONAL_AGENT_ENABLED_STORAGE_KEY,
  PERSONAL_AGENT_MOBILE_ENABLED_STORAGE_KEY,
  resolvePersonalAgentSurface,
  savePersonalAgentEnabled,
} from '../src/features/ai/personalAgentPreference.js';

const checks = [];

function check(name, predicate) {
  checks.push({ name, ok: Boolean(predicate()) });
}

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

function parseCompactUtc(value) {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(String(value || ''));
  if (!match) return Number.NaN;
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
}

const rules = JSON.parse(read('database.rules.json')).rules;
const functionsSource = read('functions/index.js');
const configSource = read('public/config.js');
const firebaseSource = read('src/lib/firebase.js');
const authTokenSource = read('src/lib/authToken.js');
const searchSource = read('src/features/search/Search.jsx');
const searchCssSource = read('src/features/search/search.css');
const tasksSource = read('src/features/tasks/Tasks.jsx');
const tasksCssSource = read('src/features/tasks/tasks.css');
const aiClientSource = read('src/features/ai/localAiClient.js');
const aiSource = read('src/features/ai/AI.jsx');
const roomAiSource = aiSource.slice(aiSource.indexOf('function RoomAgent'), aiSource.indexOf('function PersonalAgentShell'));
const aiModelProfilesSource = read('functions/ai-model-profiles.js');
const aiQueueSource = read('functions/ai-request-queue.js');
const aiModelCatalog = JSON.parse(read('functions/ai-model-profiles.json'));
const aiGatewayPayloadSource = read('src/features/ai/gatewayPayload.js');
const socialSource = read('src/features/community/social.js');
const timedSingleFlightCacheSource = read('src/features/community/timedSingleFlightCache.js');
const roomHomeSource = read('src/features/room-home/RoomHome.jsx');
const roomFeatureLoadersSource = read('src/features/shell/roomFeatureLoaders.js');
const featureMountCoordinatorSource = read('src/features/shell/featureMountCoordinator.js');
const featureMountCoordinatorTestSource = read('tools/feature-mount-coordinator.test.mjs');
const hostAwareRootSource = read('src/features/shell/hostAwareRoot.js');
const roomTabActivitySource = read('src/features/shell/roomTabActivity.js');
const chatPageSource = read('src/pages/ChatPage.jsx');
const authStateReadySource = read('src/lib/authStateReady.js');
const authGateSource = read('src/features/shell/authGate.js');
const promiseTimeoutSource = read('src/lib/promiseTimeout.js');
const calendarSource = read('src/features/calendar/Calendar.jsx');
const eventsSource = read('src/features/events/Events.jsx');
const eventsCssSource = read('src/features/events/events.css');
const googleCalendarLinkSource = read('src/features/calendar/GoogleCalendarLink.jsx');
const allDayGoogleCalendarUrl = new URL(buildGoogleCalendarUrl({ title: 'Launch & review', date: '2026-07-13', desc: 'Plan #1' }));
const timedGoogleCalendarUrl = new URL(buildGoogleCalendarUrl({ title: 'Standup', date: '2026-07-13', time: '23:30', duration: 90, location: 'Room A' }));
const chatCoreSource = read('src/features/chat-core/ChatCore.jsx');
const chatCorePerformanceCssSource = read('src/features/chat-core/chatCore.performance.css');
const botCatalogSource = read('src/features/bots/botCatalog.js');
const botRuntimeSource = read('src/features/bots/botRuntime.js');
const emojiPickerSource = read('src/features/chat-core/emojiPicker.js');
const messageToolsSource = read('src/features/message-tools/messageTools.js');
const messageToolsUiSource = read('src/features/message-tools/MessageToolsUI.jsx');
const contactsSource = read('src/features/contacts/contactsService.js');
const contactsListSource = read('src/features/contacts/ContactsList.jsx');
const roomsSource = read('src/features/rooms/roomControls.js');
const roomAppsPanelSource = read('src/features/rooms/RoomAppsPanel.jsx');
const roomPlatformServiceSource = read('src/features/rooms/roomPlatformService.js');
const roomSettingsCssSource = read('src/features/rooms/roomSettings.css');
const roomCreateCssSource = read('src/features/rooms/roomCreate.css');
const baseCssSource = read('public/base.css');
const mobileCssSource = read('public/mobile.css');
const featuresCssSource = read('public/features.css');
const loadCssSource = read('public/load-css.js');
const indexSource = read('index.html');
const mainSource = read('src/main.jsx');
const entryLoaderSource = read('src/entry-loader.js');
const appSource = read('src/App.jsx');
const authPresenceHintSource = read('src/lib/authPresenceHint.js');
const chatBootSource = read('src/features/shell/chatBoot.js');
const chatShellSource = read('src/features/shell/chatShellControls.js');
const chatAppSource = read('src/features/shell/chatApp.js');
const settingsSource = read('src/features/settings/settingsService.js');
const personalAgentPreferenceSource = read('src/features/ai/personalAgentPreference.js');
const performanceSettingsSource = read('src/features/performance/performanceSettings.js');
const modernThemeMotionSource = read('src/features/shell/modernThemeMotion.js');
const themeRuntimeSource = read('src/features/settings/themeRuntime.js');
const prerenderSource = read('tools/prerender-marketing.mjs');
const marketingContentSource = read('src/content/marketingContent.js');
const robotsSource = read('public/robots.txt');
const sitemapSource = read('public/sitemap.xml');
const serverSource = read('server.js');
const seoBuildSmokeSource = read('tools/seo-build-smoke.test.mjs');
const seoHostingSmokeSource = read('tools/seo-hosting-smoke.mjs');
const swSource = read('public/sw.js');
const backgroundServicesSource = read('src/features/shell/backgroundServices.js');
const authProfileSource = read('src/lib/authProfile.js');
const pmInboxSource = read('src/features/private-messages/pmInboxService.js');
const privateMessagesSource = read('src/features/private-messages/PrivateMessages.jsx');
const githubUpdatesSource = read('src/features/updates/githubUpdates.js');
const directAudioCallSource = read('src/features/private-messages/useDirectAudioCall.js');
const gamifySource = read('src/features/community/gamify.js');
const questListSource = read('src/features/community/QuestList.jsx');
const questListCssSource = read('src/features/community/questList.css');
const updatesCenterShellSource = read('src/features/updates/UpdatesCenterShell.jsx');
const profilePopupSource = read('src/features/profile/profilePopupService.js');
const profileActionsSource = read('src/features/profile/profileActions.js');
const accountProfilesSource = read('src/lib/accountProfiles.js');
const loginPageSource = read('src/pages/LoginPage.jsx');
const googleIdentityAuthSource = read('src/lib/googleIdentityAuth.js');
const marketingPagesSource = read('src/pages/MarketingPages.jsx');
const marketingNavSource = read('src/features/shell/MarketingNav.jsx');
const bridgeSource = read('tools/ollama-bridge/ollama-bridge.cjs');
const bridgeLauncherSource = read('tools/ollama-bridge/start-ollama-bridge.ps1');
const bridgeControlSource = read('tools/ollama-bridge/BridgeControl.ps1');
const managedOllamaConfigSource = read('tools/ollama-bridge/managed-ollama-config.cjs');
const aiProviderRoutingSource = read('functions/ai-provider-routing.js');
const analysisAppSource = read('tools/ai-analysis-app/Program.cs');
const modernAnalysisAppSource = read('tools/ai-analysis-app/ModernAnalysisForm.cs');
const analysisAppLogicSource = read('tools/ai-analysis-app/Logic/AnalysisAppLogic.cs');
const firebaseUserDeleteSource = read('tools/delete-firebase-user.cjs');
const analysisProjectSource = read('tools/ai-analysis-app/MinimalistAIAnalysis.csproj');
const packageJson = JSON.parse(read('package.json'));
const firebaseJson = JSON.parse(read('firebase.json'));
const rulesSmokeSource = read('tools/rtdb-rules-smoke-test.mjs');
const deployedSmokeSource = read('tools/deployed-smoke-test.mjs');
const uiSmokeSource = read('tools/ui-smoke-test.mjs');

check('discoverable search function is exported', () => functionsSource.includes('exports.searchDiscoverableRooms'));
check('discoverable join function is exported', () => functionsSource.includes('exports.joinDiscoverableRoom'));
check('member-add room index backfill exists', () => functionsSource.includes('exports.backfillUserRoomIndexOnMemberAdded'));
check('public config exposes room search endpoint', () => configSource.includes('ROOM_SEARCH_ENDPOINT'));
check('public config exposes discoverable join endpoint', () => configSource.includes('JOIN_DISCOVERABLE_ROOM_ENDPOINT'));
check('search UI uses protected discovery search', () => /searchDiscoverableRooms\(queryText(?:,\s*signal)?\)/.test(searchSource));
check('search UI joins discoverable rooms through backend', () => searchSource.includes('joinDiscoverableRoom(room)'));
check('universal search keeps typing responsive and cancels stale discovery requests', () => searchSource.includes('useDeferredValue')
  && searchSource.includes('new AbortController()')
  && searchSource.includes('controller.abort()'));
check('universal search cancels deferred focus when it closes', () => searchSource.includes('let focusFrame = 0')
  && searchSource.includes('window.cancelAnimationFrame(focusFrame)'));
check('universal search reuses bounded local indexes and deep-links message results', () => searchSource.includes('SEARCH_INDEX_TTL')
  && searchSource.includes('MESSAGE_INDEX_TTL')
  && searchSource.includes("source: 'search'")
  && searchSource.includes("minimalist:message-jump"));
check('universal search uses one scoped responsive command palette stylesheet', () => searchSource.includes("import './search.css'")
  && searchCssSource.includes('@media (max-height: 480px)')
  && searchCssSource.includes('@media (max-width: 390px)'));
check('GitHub changelog requests are cached, single-flight, and stale guarded', () => (
  githubUpdatesSource.includes('UPDATES_CACHE_TTL_MS')
  && githubUpdatesSource.includes('if (updatesRequest) return updatesRequest.promise')
  && githubUpdatesSource.includes('requestId !== updatesRequestVersion')
));
check('tasks switch between board and list without losing task detail controls', () => tasksSource.includes("setViewMode('board')")
  && tasksSource.includes("setViewMode('list')")
  && tasksSource.includes('TaskDetail'));
check('tasks use a keyed room lifecycle and scoped responsive stylesheet', () => tasksSource.includes('<TasksRoom key={props.roomId}')
  && tasksSource.includes("import './tasks.css'")
  && tasksCssSource.includes('@media (max-width: 620px)'));
check('events classify live and past time states and use a keyed room lifecycle', () => eventsSource.includes("return 'live'")
  && eventsSource.includes('<EventsRoom key={props.roomId}')
  && eventsSource.includes('window.setInterval(refresh, 60_000)'));
check('events use a scoped responsive agenda and composer stylesheet', () => eventsSource.includes("import './events.css'")
  && eventsCssSource.includes('.events-workspace')
  && eventsCssSource.includes('@media (max-width: 620px)'));
check('create room exposes live preview, privacy summary, and a compact responsive sheet', () => chatPageSource.includes('room-create-review-card')
  && roomsSource.includes('updateCreateRoomPreview')
  && roomCreateCssSource.includes('#room-action-modal[data-mode="create"]')
  && roomCreateCssSource.includes('@media (max-width: 680px)'));

check('AI gateway status action exists', () => functionsSource.includes("const action = String(req.body?.action || '').toLowerCase()")
  && functionsSource.includes("if (action === 'status')"));
check('AI gateway status reports unconfigured as unavailable', () => functionsSource.includes("provider === 'unconfigured'") && functionsSource.includes('res.status(503)'));
check('AI gateway status reports the selected server-owned model profile', () => functionsSource.includes('modelProfile: probe.modelProfile') && functionsSource.includes('profiles: probe.profiles'));
check('AI gateway probes protected Ollama bridge status', () => functionsSource.includes('async function probeOllamaBridge') && functionsSource.includes('/api/tags') && functionsSource.includes('ollamaModelInstalled'));
check('AI gateway sanitizes bridge health errors', () => functionsSource.includes('bridgeHealthErrorMessage') && !functionsSource.includes('body.slice(0, 240)'));
check('AI gateway only uses Ollama bridge when token is configured', () => functionsSource.includes('function canUseOllamaBridge()') && functionsSource.includes('if (ollamaUrl && canUseOllamaBridge())'));
check('AI gateway only falls back after explicit bridge transport failures', () => functionsSource.includes('bridgeTransportFailure === true') && functionsSource.includes('error.noExternalFallback = true'));
check('AI gateway verifies protected bridge marker', () => functionsSource.includes('function assertProtectedBridgeResponse') && functionsSource.includes('assertProtectedBridgeResponse(response);') && bridgeSource.includes("'X-Minimalist-Ollama-Bridge': '1'"));
check('protected bridge manages Ollama on demand without killing user-owned instances', () => bridgeSource.includes('async function ensureOllamaReady()')
  && bridgeSource.includes('ownedOllamaProcess')
  && bridgeSource.includes('scheduleIdleShutdown()')
  && bridgeSource.includes("spawn(ollamaCommand(), ['serve']")
  && bridgeSource.includes('if (!child || child.exitCode !== null) return;'));
check('protected bridge persists Off, On, and Auto control modes', () => bridgeSource.includes("['off', 'on', 'auto'].includes(saved.mode)")
  && bridgeSource.includes("pathname === '/control/status'")
  && bridgeSource.includes("pathname === '/control/mode'")
  && bridgeSource.includes('idleMinutes'));
check('bridge launchers stay aligned with the configured Cloudflare origin port', () => bridgeSource.includes('BRIDGE_PORT || 8790')
  && bridgeLauncherSource.includes('[int]$Port = 8790')
  && bridgeControlSource.includes('[int]$Port = 8790'));
check('protected runtime is isolated from tray Ollama and its model store', () => managedOllamaConfigSource.includes("DEFAULT_UPSTREAM = 'http://127.0.0.1:11435'")
  && managedOllamaConfigSource.includes("DEFAULT_MANAGED_HOST = '127.0.0.1:11435'")
  && managedOllamaConfigSource.includes("OLLAMA_HOST: config.host")
  && managedOllamaConfigSource.includes("OLLAMA_MODELS: config.modelStore")
  && managedOllamaConfigSource.includes("upstream.port === '11434'")
  && bridgeSource.includes('managedOllamaEnvironment(process.env, MANAGED_OLLAMA)')
  && bridgeLauncherSource.includes('[string]$OllamaUpstream = "http://127.0.0.1:11435"')
  && bridgeControlSource.includes('$DedicatedOllamaBaseUrl = "http://127.0.0.1:11435"')
  && analysisAppLogicSource.includes('DedicatedOllamaBaseUrl = "http://127.0.0.1:11435"')
  && analysisAppSource.includes('["OLLAMA_HOST"] = AnalysisAppLogic.DedicatedOllamaHost')
  && analysisAppSource.includes('["OLLAMA_MODELS"] = DedicatedOllamaModelStore'));
check('AI model catalog exposes exactly Fast and Smart while keeping vision separate', () => JSON.stringify(aiModelCatalog.profiles.map(({ id, model }) => ({ id, model }))) === JSON.stringify([
  { id: 'fast', model: 'qwen3:4b-instruct' },
  { id: 'smart', model: 'qwen3:14b' },
]) && aiModelCatalog.visionModel === 'qwen2.5vl:7b');
check('Analysis website routing metadata mirrors the server-owned 10/40/40 provider tiers', () => aiProviderRoutingSource.includes("Object.freeze({ provider: 'ollama-bridge', capacity: 10 })")
  && aiProviderRoutingSource.includes("Object.freeze({ provider: 'cloudflare-workers-ai', capacity: 40 })")
  && aiProviderRoutingSource.includes("Object.freeze({ provider: 'groq', capacity: 40 })")
  && analysisAppLogicSource.includes('WebsiteAiTotalCapacity = 90')
  && analysisAppLogicSource.includes('new("ollama-bridge", "PC · Ollama", 10, false, [ApprovedFastModel, ApprovedSmartModel])')
  && analysisAppLogicSource.includes('new("cloudflare-workers-ai", "Cloudflare Workers AI", 40, true, [WebsiteCloudflareModel])')
  && analysisAppLogicSource.includes('new("groq", "Groq", 40, true, [WebsiteGroqModel])'));
check('Analysis website routing metadata mirrors hosted server model defaults', () => functionsSource.includes("DEFAULT_CLOUDFLARE_AI_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8'")
  && functionsSource.includes("DEFAULT_GROQ_CHAT_MODEL = 'openai/gpt-oss-20b'")
  && analysisAppLogicSource.includes('WebsiteCloudflareModel = "@cf/qwen/qwen3-30b-a3b-fp8"')
  && analysisAppLogicSource.includes('WebsiteGroqModel = "openai/gpt-oss-20b"'));
check('AI gateway rejects unknown profiles before server model resolution', () => aiModelProfilesSource.includes('function requireAiModelProfile')
  && aiModelProfilesSource.includes("error.code = 'INVALID_AI_MODEL_PROFILE'")
  && functionsSource.includes('const modelProfile = requireAiModelProfile(req.body?.modelProfile)'));
check('browser sends only a model profile and never a raw model tag to the gateway', () => aiGatewayPayloadSource.includes('modelProfile: normalizeAiModelProfile(modelProfile)')
  && !aiGatewayPayloadSource.includes('model:'));
check('protected bridge default allowlist contains only approved text and vision models', () => bridgeLauncherSource.includes('qwen3:4b-instruct,qwen3:14b,qwen2.5vl:7b')
  && !bridgeLauncherSource.includes('llama3.1:latest')
  && !bridgeLauncherSource.includes('@cf/qwen')
  && !bridgeLauncherSource.includes('gpt-oss'));
check('member spotlight stays on the authenticated gateway in public mode', () => aiClientSource.includes("mode: 'spotlight'")
  && aiClientSource.includes('if (shouldUseGatewayAi(config))')
  && socialSource.includes('targetUid: uid')
  && functionsSource.includes("requestedMode === 'personal' || requestedMode === 'spotlight'"));
check('standalone AI Analysis app is self-contained and never embeds the bridge secret', () => analysisProjectSource.includes('<PublishSingleFile>true</PublishSingleFile>')
  && analysisProjectSource.includes('<SelfContained>true</SelfContained>')
  && analysisAppSource.includes('functions:secrets:access')
  && !analysisAppSource.includes('OLLAMA_SERVER_TOKEN='));
check('standalone AI Analysis app exposes modes, health, and privacy-safe activity', () => analysisAppSource.includes('SetModeAsync')
  && modernAnalysisAppSource.includes('AI request activity')
  && modernAnalysisAppSource.includes('Recent local activity')
  && bridgeSource.includes('OLLAMA_BRIDGE_ACTIVITY_FILE')
  && bridgeSource.includes('activity: activityRows.slice(-40).reverse()'));
check('standalone Analysis app derives aggregate users, presence, growth, and paid memberships from admin sources', () => analysisAppSource.includes('auth:export')
  && analysisAppSource.includes('database:get", "/users"')
  && analysisAppSource.includes('database:get", "/presence"')
  && analysisAppSource.includes('stripeSubscriptionStatus')
  && modernAnalysisAppSource.includes('User growth')
  && modernAnalysisAppSource.includes('Paid memberships')
  && analysisAppSource.includes('File.Delete(tempAuthFile)'));
check('standalone Analysis app uses bottom navigation and an approved privacy-safe console', () => modernAnalysisAppSource.includes('BuildBottomNavigation')
  && modernAnalysisAppSource.includes('("Overview", "Overview", AppleNavIcon.Overview)')
  && modernAnalysisAppSource.includes('("Users", "Users", AppleNavIcon.Users)')
  && modernAnalysisAppSource.includes('("AI", "AI Control", AppleNavIcon.Ai)')
  && modernAnalysisAppSource.includes('("Health", "Health", AppleNavIcon.Health)')
  && modernAnalysisAppSource.includes('("Console", "Console", AppleNavIcon.Console)')
  && modernAnalysisAppSource.includes('case "status"')
  && modernAnalysisAppSource.includes('case "logs"')
  && analysisAppSource.includes('ReadSanitizedLogs()')
  && !modernAnalysisAppSource.includes('Process.Start(command'));
check('standalone Analysis moderation commands are fixed, confirmed, and protect the administrator', () => analysisAppLogicSource.includes('moderation-help')
  && analysisAppLogicSource.includes('ban <uid> CONFIRM')
  && analysisAppLogicSource.includes('kick <roomId> <uid> CONFIRM')
  && analysisAppLogicSource.includes('delete-account <uid> DELETE <uid>')
  && modernAnalysisAppSource.includes('MessageBoxDefaultButton.Button2')
  && analysisAppSource.includes('ProtectedAdminUid')
  && analysisAppSource.includes('ValidateFirebaseKey')
  && firebaseUserDeleteSource.includes("https://identitytoolkit.googleapis.com/v1/accounts:delete")
  && firebaseUserDeleteSource.includes('confirmation !== uid')
  && !modernAnalysisAppSource.includes('Process.Start(command'));
check('AI control endpoint is protected and administrator-only', () => functionsSource.includes('exports.aiControl')
  && functionsSource.includes('await requireFirebaseUser(req)')
  && functionsSource.includes('userIsIssuePublisher(decoded)'));
check('website no longer exposes the desktop-only Analysis app', () => !configSource.includes('AI_CONTROL_ENDPOINT')
  && !roomHomeSource.includes('data-open-ai-control')
  && !roomFeatureLoadersSource.includes('window.openAiControl')
  && !chatPageSource.includes('open-ai-control-btn')
  && !chatPageSource.includes('ai-control-panel'));
check('website bundle omits the retired Analysis panel and styles', () => !roomFeatureLoadersSource.includes("import('../ai-control/")
  && !featuresCssSource.includes('#ai-control-panel')
  && !featuresCssSource.includes('.aic-shell')
  && !featuresCssSource.includes('.rh-ai-control-shortcut'));
check('AI abuse scan covers full inference window', () => functionsSource.includes('sanitizeAiMessages(messages, AI_CONVERSATION_LIMIT)') && !functionsSource.includes('sanitizeAiMessages(messages, 4)'));
check('personal AI charge refunds profile-load failures', () => functionsSource.indexOf("if (mode === 'personal')") > functionsSource.indexOf('try {') && functionsSource.includes('AI banana release failed'));
check('AI text functions have 120s timeout', () => (functionsSource.match(/timeoutSeconds: 120/g) || []).length >= 3);
check('AI overflow uses a durable fenced queue instead of dropping request 91', () => functionsSource.includes('exports.aiQueueWorker')
  && functionsSource.includes('exports.aiQueueSweeper')
  && functionsSource.includes('result?.queued ? 202 : 200')
  && aiQueueSource.includes('claimAiQueueJob')
  && aiQueueSource.includes('claimId'));
check('AI queue status is owner-readable and private queue state remains server-only', () => rules.ai_runtime?.['.read'] === false
  && rules.ai_runtime?.['.write'] === false
  && rules.ai_queue_status?.$uid?.['.read'] === 'auth != null && auth.uid === $uid'
  && rules.ai_queue_status?.$uid?.['.write'] === false);
check('AI queue client prefers realtime completion with authenticated polling recovery', () => aiClientSource.includes('ai_queue_status/${uid}/${initial.jobId}')
  && aiClientSource.includes('buildAiGatewayQueueStatusPayload(initial.jobId)')
  && aiClientSource.includes('unsubscribe?.()'));
check('client probes AI gateway status with the selected profile', () => aiClientSource.includes('buildAiGatewayStatusPayload(config.modelProfile)')
  && aiGatewayPayloadSource.includes("action: 'status'"));
check('Room AI keeps an idle gateway neutral until an explicit wake', () => aiSource.includes("if (state === 'standby') return 'Ready on demand'")
  && roomAiSource.includes("state: 'standby'")
  && roomAiSource.includes("!['ready', 'standby', 'checking', 'warming'].includes")
  && roomAiSource.includes('if (!active || gateway) return undefined;')
  && roomAiSource.includes('let subscribed = true;')
  && roomAiSource.includes('getLocalAiStatus(config, { wake: gateway })'));
check('AI tab reads only recent room messages', () => aiSource.includes("limitToLast(120)") && aiSource.includes("orderByChild('timestamp')"));
check('hidden Room AI work is aborted and room changes rescope mounted AI', () => aiSource.includes("useRoomTabActivity('ai')")
  && roomAiSource.includes("if (!active) requestAbortRef.current?.abort()")
  && chatShellSource.includes('ai: window.loadRoomAI'));
check('Personal AI is available from mobile navigation and reuses the lazy drawer path', () => chatPageSource.includes('open-personal-agent-btn-mobile')
  && chatShellSource.includes("target.closest('#open-personal-agent-btn-mobile')")
  && roomFeatureLoadersSource.includes("import('../ai/mountPersonalAgent.js')"));
check('Personal AI split preference migrates the shared value and persists each surface independently', () => {
  const makeStorage = (entries = []) => {
    const values = new Map(entries);
    return {
      values,
      storage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
      },
    };
  };

  const defaultsOn = loadPersonalAgentPreferences(makeStorage().storage);
  const legacyOffStorage = makeStorage([[PERSONAL_AGENT_ENABLED_STORAGE_KEY, 'false']]);
  const legacyOff = loadPersonalAgentPreferences(legacyOffStorage.storage);
  const desktopOverride = makeStorage([
    [PERSONAL_AGENT_ENABLED_STORAGE_KEY, 'false'],
    [PERSONAL_AGENT_DESKTOP_ENABLED_STORAGE_KEY, 'true'],
  ]);
  const mixed = loadPersonalAgentPreferences(desktopOverride.storage);
  const desktopSaved = savePersonalAgentEnabled('desktop', true, legacyOffStorage.storage, null);
  const mobileKeyStayedUnset = !legacyOffStorage.values.has(PERSONAL_AGENT_MOBILE_ENABLED_STORAGE_KEY);
  const mobileSaved = savePersonalAgentEnabled('mobile', true, legacyOffStorage.storage, null);
  const blockedStorageDefaultsOn = loadPersonalAgentPreferences({
    getItem: () => { throw new Error('blocked'); },
  });

  return defaultsOn.desktop && defaultsOn.mobile
    && !legacyOff.desktop && !legacyOff.mobile
    && mixed.desktop && !mixed.mobile
    && desktopSaved.desktop && !desktopSaved.mobile && mobileKeyStayedUnset
    && mobileSaved.desktop && mobileSaved.mobile
    && blockedStorageDefaultsOn.desktop && blockedStorageDefaultsOn.mobile;
});
check('Personal AI surface resolver follows the shared 768px mobile breakpoint', () => resolvePersonalAgentSurface({
  matchMedia: () => ({ matches: true }),
  innerWidth: 769,
}) === 'mobile' && resolvePersonalAgentSurface({
  matchMedia: () => ({ matches: false }),
  innerWidth: 769,
}) === 'desktop');
check('Personal AI split opt-out is applied eagerly, exposed in settings, and gates programmatic opens', () => chatAppSource.includes('applyPersonalAgentPreferences(loadPersonalAgentPreferences())')
  && chatAppSource.includes('PERSONAL_AGENT_PREFERENCE_STORAGE_KEYS.includes(event.key)')
  && chatAppSource.includes('event.key === null')
  && settingsSource.includes("['desktop', 'personal-ai-desktop-enabled-toggle']")
  && settingsSource.includes("['mobile', 'personal-ai-mobile-enabled-toggle']")
  && chatPageSource.includes('personal-ai-desktop-enabled-toggle')
  && chatPageSource.includes('personal-ai-mobile-enabled-toggle')
  && roomFeatureLoadersSource.includes('if (!personalAgentSurfaceIsEnabled(activeSurface, preferences))')
  && roomFeatureLoadersSource.includes('panel.dataset.personalAgentSurface')
  && roomFeatureLoadersSource.includes("addEventListener?.('change', syncPersonalAgentViewportPreference)")
  && baseCssSource.includes('body.personal-ai-desktop-disabled #open-personal-agent-btn')
  && baseCssSource.includes('body.personal-ai-mobile-disabled #open-personal-agent-btn-mobile')
  && roomFeatureLoadersSource.includes("panelMountCoordinator.clear('personal-agent')")
  && read('src/features/ai/mountPersonalAgent.js').includes('export function unmountPersonalAgent()'));
check('client calendar off-day filter handles variants', () => aiClientSource.includes('label.startsWith(`${phrase} `)'));
check('server calendar off-day filter handles variants', () => functionsSource.includes('label.startsWith(`${phrase} `)'));
check('calendar photo import stays within base banana quota', () => calendarSource.includes('photoMaxBase64Chars = 2_160_000'));
check('calendar photo preparation rejects oversized final payloads', () => calendarSource.includes('still too large after compression') && !calendarSource.includes('image.length <= photoMaxBase64Chars || attempt === 4'));
check('calendar gateway mode uses resolved runtime config', () => calendarSource.includes('getLocalAiConfig') && calendarSource.includes('Boolean(aiConfig.calendarEndpoint)') && !calendarSource.includes('Boolean(localAiConfig?.calendarEndpoint)'));
check('calendar import labels gateway mode accurately', () => calendarSource.includes('Secure AI calendar import') && calendarSource.includes('Local Ollama vision import'));
check('hidden Calendar releases its room event listener after the revisit grace window', () => calendarSource.includes("useRoomTabDataActivity('calendar')")
  && calendarSource.includes('if (!tabDataActive) return undefined;')
  && chatShellSource.includes('calendar: window.loadRoomCalendar'));
check('room feature mounts dedupe identical work and suppress stale completions', () => (
  roomFeatureLoadersSource.includes('createFeatureMountCoordinator')
  && roomFeatureLoadersSource.includes('cacheIsValid')
  && featureMountCoordinatorSource.includes("status: 'cached'")
  && featureMountCoordinatorSource.includes("status: 'pending'")
  && featureMountCoordinatorSource.includes('options.isRelevant?.()')
  && featureMountCoordinatorSource.includes('options.cacheIsValid?.()')
  && featureMountCoordinatorTestSource.includes('suppresses a stale completion')
  && featureMountCoordinatorTestSource.includes('coalesces concurrent work')
));
check('imperative React roots follow replacement chat hosts safely', () => (
  hostAwareRootSource.includes('previousRoot?.unmount()')
  && hostAwareRootSource.includes('host !== nextHost')
  && hostAwareRootSource.includes('onDetach?.(previousHost)')
  && featureMountCoordinatorTestSource.includes('replaces it when the DOM host changes')
  && roomFeatureLoadersSource.includes('searchMountedInCurrentHost')
));
check('room changes lazily rescope only the default feature', () => (
  chatShellSource.includes('const defaultLoader = roomScopedFeatureLoaders[defaultView]')
  && chatShellSource.includes("Other hidden features rescope lazily when selected")
  && !chatShellSource.includes('Object.entries(roomScopedFeatureLoaders).forEach')
  && chatCoreSource.includes('function scheduleRoomChanged()')
  && chatCoreSource.includes('if (pendingRoomChangedTimer !== null) return')
));
check('data-heavy room tabs keep subscriptions warm across quick revisits', () => (
  roomTabActivitySource.includes('useRoomTabDataActivity')
  && roomTabActivitySource.includes('deactivationDelayMs = 12_000')
  && roomHomeSource.includes("useRoomTabDataActivity('home')")
  && tasksSource.includes("useRoomTabDataActivity('tasks')")
  && eventsSource.includes("useRoomTabDataActivity('events')")
  && calendarSource.includes("useRoomTabDataActivity('calendar')")
));
check('Room AI context reads are bounded, cached, and single-flight', () => (
  aiSource.includes('ROOM_CONTEXT_CACHE_TTL_MS = 15_000')
  && aiSource.includes('ROOM_CONTEXT_CACHE_LIMIT = 12')
  && aiSource.includes('if (cached?.promise) return cached.promise')
  && aiSource.includes('limitToLast(120)')
  && aiSource.includes('force: true')
));
check('Google Calendar export builds an encoded all-day template', () => allDayGoogleCalendarUrl.hostname === 'calendar.google.com'
  && allDayGoogleCalendarUrl.searchParams.get('action') === 'TEMPLATE'
  && allDayGoogleCalendarUrl.searchParams.get('dates') === '20260713/20260714'
  && allDayGoogleCalendarUrl.searchParams.get('text') === 'Launch & review'
  && allDayGoogleCalendarUrl.searchParams.get('details').includes('Plan #1'));
check('Google Calendar timed export keeps duration and location', () => {
  const [startText, endText] = String(timedGoogleCalendarUrl.searchParams.get('dates') || '').split('/');
  const start = parseCompactUtc(startText);
  const end = parseCompactUtc(endText);
  return timedGoogleCalendarUrl.searchParams.get('location') === 'Room A'
    && Number.isFinite(start)
    && end - start === 90 * 60_000;
});
check('Google Calendar export is available across room event surfaces', () => calendarSource.includes('<GoogleCalendarLink event={event} />')
  && /<GoogleCalendarLink\s+event=\{event\}/.test(eventsSource)
  && roomHomeSource.includes('<GoogleCalendarLink event={event} />')
  && googleCalendarLinkSource.includes('target="_blank"')
  && googleCalendarLinkSource.includes('rel="noopener noreferrer"')
  && featuresCssSource.includes('.google-calendar-link'));

check('authenticated issue draft queue is wired', () => functionsSource.includes('exports.submitIssueDraft') && configSource.includes('ISSUE_DRAFT_ENDPOINT') && configSource.includes('issueSubmission: true') && chatCoreSource.includes('openFeedbackReport'));
check('issue draft GitHub publisher is token gated server-side', () => functionsSource.includes('function githubIssueConfig') && functionsSource.includes('exports.publishIssueDrafts') && functionsSource.includes('exports.publishIssueDraftToGithub') && functionsSource.includes('GITHUB_ISSUE_TOKEN') && functionsSource.includes('https://api.github.com/repos/${config.owner}/${config.repo}/issues'));
check('issue draft GitHub auto-publish is opt-in only', () => functionsSource.includes('function githubIssueAutoPublishEnabled') && functionsSource.includes("envFlag('GITHUB_ISSUE_AUTO_PUBLISH', false)") && functionsSource.includes('if (!githubIssueAutoPublishEnabled()) return null;'));
check('issue draft metadata serializes structured client context', () => functionsSource.includes('JSON.stringify(value)') && deployedSmokeSource.includes('clientMeta: {'));
check('feedback command no longer opens mailto from chat', () => !chatCoreSource.includes("mailto:support@minimalist.com?subject=Minimalist%20Chat%20Feedback"));
check('trusted notification endpoint is wired', () => functionsSource.includes('exports.createNotification') && configSource.includes('NOTIFICATION_ENDPOINT') && read('src/features/notifications/notificationService.js').includes('notificationEndpoint()'));
check('App Check client support is wired for authenticated Function calls', () => configSource.includes('FIREBASE_APP_CHECK_SITE_KEY') && firebaseSource.includes("import('firebase/app-check')") && firebaseSource.includes('X-Firebase-AppCheck') && authTokenSource.includes('getAuthedJsonHeaders') && chatCoreSource.includes('getAuthedJsonHeaders') && aiClientSource.includes('getAuthedJsonHeaders') && searchSource.includes('getAuthedJsonHeaders') && roomsSource.includes('getAuthedJsonHeaders') && read('src/features/billing/billingActions.js').includes('getAuthedJsonHeaders') && read('src/features/notifications/notificationService.js').includes('getAuthedJsonHeaders') && read('src/features/vault/Vault.jsx').includes('getAuthedJsonHeaders'));
check('App Check server verification can be enforced for authenticated Functions', () => functionsSource.includes('function requireAppCheck') && functionsSource.includes("req.get('X-Firebase-AppCheck')") && functionsSource.includes('admin.appCheck().verifyToken') && functionsSource.includes('REQUIRE_APP_CHECK') && functionsSource.includes('Content-Type, Authorization, X-Firebase-AppCheck'));

const notifications = rules.notifications.$uid.$notificationId;
check('notifications reject unknown fields', () => notifications.$other?.['.validate'] === false);
check('notifications allow PM metadata intentionally', () => notifications.pmTargetUid && notifications.pmTargetName);
check('notifications deny client-created rows', () => notifications?.['.write']?.includes('auth.uid === $uid') && notifications?.['.write']?.includes('!newData.exists()') && !notifications?.['.write']?.includes("senderUid').val() === auth.uid"));
check('push tokens can be individually written and owner-deleted only', () => {
  const pushTokens = rules.push_tokens.$uid;
  const tokenRule = pushTokens.$tokenKey?.['.write'] || '';
  return pushTokens?.['.write']?.includes('auth.uid === $uid && !newData.exists()')
    && tokenRule.includes('auth.uid === $uid')
    && tokenRule.includes("newData.hasChildren(['token', 'updatedAt'])")
    && rulesSmokeSource.includes('own push token whole-subtree overwrite denied')
    && rulesSmokeSource.includes('cross-user push token delete denied');
});
check('push token cleanup runs before logout, account switch, and account deletion', () => pmInboxSource.includes('window.clearFirebasePushToken')
  && pmInboxSource.includes('PUSH_TOKEN_STORAGE_KEY')
  && pmInboxSource.includes('deleteToken(getMessaging(app))')
  && profileActionsSource.includes('clearPushTokenBeforeSessionChange')
  && profileActionsSource.includes('allForAccount: true')
  && profileActionsSource.includes('await clearPushTokenBeforeSessionChange();'));
check('settings account chooser keeps a metadata-only saved profile registry', () => accountProfilesSource.includes('minimalist.saved-accounts.v1')
  && accountProfilesSource.includes('MAX_SAVED_ACCOUNTS = 8')
  && accountProfilesSource.includes('displayName:')
  && accountProfilesSource.includes('email:')
  && accountProfilesSource.includes('photoUrl:')
  && !accountProfilesSource.includes('refreshToken')
  && !accountProfilesSource.includes('password:'));
check('adding an account uses temporary in-memory Firebase auth', () => profileActionsSource.includes('function withTemporaryAuth')
  && profileActionsSource.includes('inMemoryPersistence')
  && profileActionsSource.includes('addGoogleAccountWithoutSwitching')
  && profileActionsSource.includes('withTemporaryAuth((temporaryAuth) => signInWithEmailAndPassword'));
check('saved account switching reauthenticates and preserves account rows', () => profileActionsSource.includes('login_hint')
  && profileActionsSource.includes('renderSavedAccounts')
  && profileActionsSource.includes('forgetSavedAccount')
  && profileActionsSource.includes('clearPushTokenBeforeSessionChange({}, previousUid)'));
check('account switcher actions stay compact without button text overflow', () => featuresCssSource.includes('.switch-account-card button')
  && featuresCssSource.includes('overflow-wrap: anywhere')
  && featuresCssSource.includes('grid-template-columns: repeat(2, minmax(0, 1fr))')
  && featuresCssSource.includes('.switch-account-actions button span')
  && profileActionsSource.includes('<span>Google</span>')
  && profileActionsSource.includes('<span>Email</span>'));

const roomData = rules.rooms_data.$roomId;
const globalMessages = rules.messages.$messageId;
check('global messages are owner-bound after create', () => {
  const rule = globalMessages?.['.write'] || '';
  return rule.includes("newData.child('uid').val() === auth.uid")
    && rule.includes("data.child('uid').val() === auth.uid")
    && !rules.messages['.write'];
});
check('global reactions have narrow per-user writes', () => globalMessages?.reactions?.$uid?.['.write']?.includes('auth.uid === $uid'));
check('rooms_data whole-node write requires delete and owner/admin', () => roomData['.write']?.includes('!newData.exists()') && roomData['.write']?.includes('creatorId'));
check('room messages use per-message write rules', () => roomData.messages?.$messageId?.['.write']?.includes('members'));
check('channel messages use per-message write rules', () => roomData.channels?.$channelId?.messages?.$messageId?.['.write']?.includes('members'));
check('room messages enforce backend chat permission and mute gates', () => {
  const rule = roomData.messages?.$messageId?.['.write'] || '';
  return rule.includes('isBanned') && rule.includes('isMuted') && rule.includes('memberPermissions') && rule.includes("child('chat')") && rule.includes('muted') && rule.includes("data.child('uid').val() === auth.uid");
});
check('room reactions have narrow per-user writes', () => roomData.messages?.$messageId?.reactions?.$uid?.['.write']?.includes('auth.uid === $uid') && roomData.channels?.$channelId?.messages?.$messageId?.reactions?.$uid?.['.write']?.includes('auth.uid === $uid'));
check('PM inbox recipient writes are server-owned', () => {
  const inboxRule = rules.inbox.$uid.$senderUid?.['.write'] || '';
  return inboxRule.includes('auth.uid === $uid') && !inboxRule.includes('auth.uid === $senderUid') && functionsSource.includes('exports.pmInboxFanout');
});
check('PM messages are create-only except read receipts', () => {
  const pmRule = rules.private_messages.$threadId.$messageId;
  return pmRule?.['.write']?.includes('!data.exists() && newData.exists()')
    && pmRule?.readBy?.$uid?.['.write']?.includes('auth.uid === $uid')
    && pmRule?.$other?.['.validate'] === false;
});
check('PM call events are structured and verified before phone-like notification', () => (
  privateMessagesSource.includes("PM_CALL_EVENT_TYPE = 'direct_call'")
  && functionsSource.includes('exports.pmDirectCallNotification')
  && functionsSource.includes("liveCall?.status === 'ringing'")
  && pmInboxSource.includes("data.eventType === 'call'")
  && !pmInboxSource.includes("startsWith('📞 Voice call')")
));
check('PM call reservation and expiry changes are transactional', () => (
  privateMessagesSource.includes('runTransaction(ref(db, callPath)')
  && privateMessagesSource.includes("status === 'ringing' ? 'missed' : undefined")
  && rules.pm_calls.$threadId['.write'].includes("data.child('expiresAt').val() <= now")
  && rules.pm_calls.$threadId.status['.write'].includes("data.parent().child('expiresAt').val() > now")
));
check('PM account and rapid-thread state are isolated', () => (
  privateMessagesSource.includes('scopePmStateToUser')
  && privateMessagesSource.includes('pmDecryptCache.clear()')
  && privateMessagesSource.includes("setMessageState('loading')")
  && privateMessagesSource.includes('setMessages([])')
));
check('PM session and retained inbox state stay bounded without evicting live work', () => (
  privateMessagesSource.includes('const PM_SESSION_LIMIT = 64')
  && privateMessagesSource.includes('isProtectedPmSession')
  && privateMessagesSource.includes('session.open')
  && privateMessagesSource.includes('session.unread')
  && privateMessagesSource.includes('session.targetUid === livePmCallTargetUid')
  && pmInboxSource.includes('const PM_INBOX_RETAIN_LIMIT = 80')
  && pmInboxSource.includes('window.getProtectedPmSessionUids?.()')
  && pmInboxSource.includes('data?.read === false || protectedUids.has(targetUid)')
));
check('reopening the same PM target is idempotent and follows the current DOM host', () => (
  privateMessagesSource.includes('pmRootHost !== host')
  && privateMessagesSource.includes('const sameVisibleTarget = pmDockVisible')
  && privateMessagesSource.includes('if (sameVisibleTarget) return;')
  && !privateMessagesSource.slice(
    privateMessagesSource.indexOf('function showPmDock'),
    privateMessagesSource.indexOf('function finishPmDockClose'),
  ).includes("notifications/${userUid}/message_${targetUid}")
));
check('PM calls retain reachable controls when the dock is minimized', () => (
  privateMessagesSource.includes('pm-persistent-call-bar')
  && privateMessagesSource.includes("popup?.classList.add('pm-call-dock-minimized')")
  && featuresCssSource.includes('#pm-popup.pm-call-dock-minimized')
));
check('PM call setup cannot outlive a closed dock', () => privateMessagesSource.includes('callStartAttemptRef')
  && privateMessagesSource.includes('callStartingRef')
  && privateMessagesSource.includes("error?.code !== 'pm-call/cancelled'")
  && privateMessagesSource.includes('!dockOpen && !callLive && !callStarting'));
check('PM call connected state requires live media and peer state', () => (
  directAudioCallSource.includes("setConnectionState('connected')")
  && directAudioCallSource.includes('setEngineReady(localMediaUsable)')
  && directAudioCallSource.includes("setConnectionState('failed')")
));
check('room invites can refresh same inviter code only', () => rules.room_invites.$inviteCode?.['.write']?.includes("data.child('roomId').val() === newData.child('roomId').val()") && rules.room_invites.$inviteCode?.['.write']?.includes("data.child('inviterUid').val() === auth.uid"));
check('room membership supports self-leave delete only', () => rules.rooms_meta.$roomId.members.$memberUid?.['.write']?.includes('data.exists() && !newData.exists()') && rules.rooms_meta.$roomId.members.$memberUid?.['.write']?.includes('!data.exists() && newData.exists()'));
check('discoverable room root metadata is not fully readable to outsiders', () => {
  const roomMeta = rules.rooms_meta.$roomId;
  return !roomMeta['.read']?.includes("child('public').val() === true")
    && !roomMeta['.read']?.includes("child('discovery').child('enabled').val() === true")
    && roomMeta.name?.['.read']?.includes("child('discovery').child('enabled').val() === true")
    && !roomMeta.webhook?.['.read'];
});
check('delegated room channel and webhook rules exist', () => Boolean(rules.rooms_meta.$roomId.channels && rules.rooms_meta.$roomId.webhook && rules.rooms_meta.$roomId.bots));
check('room settings honors independent per-member channel, app, and connection overrides', () => roomsSource.includes("userPermissionEnabled(data, 'createChannels')")
  && roomsSource.includes("userPermissionEnabled(data, 'manageChannels')")
  && roomsSource.includes("userPermissionEnabled(data, 'manageBots')")
  && roomsSource.includes("userPermissionEnabled(data, 'manageConnections')"));
check('room settings uses an isolated responsive style authority', () => chatPageSource.includes("import '../features/rooms/roomSettings.css'")
  && chatPageSource.includes('room-settings-v2')
  && roomSettingsCssSource.includes('@media (max-width: 900px)')
  && roomSettingsCssSource.includes('@media (max-width: 600px)')
  && roomSettingsCssSource.includes('width: 100vw !important')
  && roomSettingsCssSource.includes('height: 100dvh !important'));
check('room settings exposes accessible tabs and panels', () => chatPageSource.includes('role: "tablist"')
  && (chatPageSource.match(/id: "rs-tab-/g) || []).length === 7
  && (chatPageSource.match(/"aria-controls": "rs-pane-/g) || []).length === 7
  && (chatPageSource.match(/"aria-labelledby": "rs-tab-/g) || []).length === 7
  && roomsSource.includes('activateRoomSettingsTab')
  && roomsSource.includes("event.key === 'Home'")
  && roomsSource.includes("event.key === 'End'"));
check('apps manager separates installed, marketplace, and connection views', () => chatPageSource.includes('RoomAppsPanel')
  && roomAppsPanelSource.includes('rs-platform-view-installed')
  && roomAppsPanelSource.includes('rs-platform-view-marketplace')
  && roomAppsPanelSource.includes('rs-platform-view-connections')
  && roomAppsPanelSource.includes('role="tabpanel"'));
check('apps marketplace advertises only implemented room automations', () => roomAppsPanelSource.includes('ROOM_BOT_CATALOG.map')
  && ROOM_BOT_CATALOG.map((bot) => bot.name).join(',') === 'Ticker Mention Watcher,Basic Message Filter'
  && !roomAppsPanelSource.includes('Basic Auto Moderation')
  && !roomAppsPanelSource.includes('Notion')
  && !roomAppsPanelSource.includes('Jira')
  && !roomAppsPanelSource.includes('Trello')
  && !roomAppsPanelSource.includes('Google Drive'));
check('room app saves are independent and expose every basic filter control', () => roomsSource.includes('bots/stockTracker')
  && roomsSource.includes('bots/autoModeration')
  && !roomsSource.includes("set(ref(db, `rooms_meta/${roomId}/bots`)")
  && roomAppsPanelSource.includes('rs-automod-caps')
  && roomAppsPanelSource.includes('rs-automod-flood'));
check('room app install, pause, and remove states remain distinct', () => roomsSource.includes("hasOwnProperty.call(bots, 'stockTracker')")
  && roomsSource.includes("hasOwnProperty.call(bots, 'autoModeration')")
  && roomsSource.includes("remove(ref(db, `rooms_meta/${roomId}/bots/${botId}`))")
  && roomsSource.includes("const stateLabel = enabled ? 'Active' : 'Paused'")
  && roomAppsPanelSource.includes('Installation stores room configuration'));
check('apps tabs reset global button sizing for compact viewports', () => roomSettingsCssSource.includes('#room-settings-card.room-settings-v2 .apps-local-tab')
  && roomSettingsCssSource.includes('width: auto !important;')
  && !roomSettingsCssSource.includes('flex: 1 0 auto;'));
check('apps details restore focus to their invoking control', () => roomsSource.includes('platformDetailReturnFocus = source?.isConnected ? source : null')
  && roomsSource.includes('returnTarget.focus({ preventScroll: true })')
  && roomsSource.includes("button.addEventListener('click', closePlatformDetail)"));
check('platform refreshes reject stale room settings responses', () => roomsSource.includes('settingsVersion: roomSettingsLoadVersion')
  && roomsSource.includes('isPlatformActionContextCurrent(context)')
  && roomsSource.includes('if (!isPlatformActionContextCurrent(context)) return false'));
check('room webhook secrets use authenticated server management and masked client state', () => roomPlatformServiceSource.includes("requestRoomWebhook('save'")
  && roomPlatformServiceSource.includes("requestRoomWebhook('test'")
  && roomPlatformServiceSource.includes("requestRoomWebhook('disconnect'")
  && roomsSource.includes("webhookInput.value = ''")
  && roomAppsPanelSource.includes('saved URL is never returned'));
check('apps manager has dedicated compact mobile layouts', () => roomSettingsCssSource.includes('.apps-market-grid')
  && roomSettingsCssSource.includes('.apps-detail-actions-three')
  && roomSettingsCssSource.includes('env(safe-area-inset-bottom')
  && roomSettingsCssSource.includes('.apps-list-row > .apps-row-actions'));
check('room settings guards stale asynchronous loads', () => roomsSource.includes('let roomSettingsLoadVersion = 0')
  && roomsSource.includes('loadVersion !== roomSettingsLoadVersion')
  && roomsSource.includes('window.activeRoomId !== roomId')
  && roomsSource.includes("content?.setAttribute('aria-busy'"));

const roomCalls = rules.room_calls.$roomId;
check('room calls enforce video and screen-share permission gates', () => {
  const rootTypeRule = roomCalls.type?.['.write'] || '';
  const rootParticipantRule = roomCalls.participants?.$uid?.['.write'] || '';
  const channelTypeRule = roomCalls.channels?.$channelId?.type?.['.write'] || '';
  const channelParticipantRule = roomCalls.channels?.$channelId?.participants?.$uid?.['.write'] || '';
  return rootTypeRule.includes("child('video')") && channelTypeRule.includes("child('video')")
    && rootParticipantRule.includes("child('screenShare')") && channelParticipantRule.includes("child('screenShare')")
    && rootParticipantRule.includes("child('camOn')") && channelParticipantRule.includes("child('camOn')");
});

const roomTasks = rules.room_tasks.$roomId;
check('room_tasks whole-board delete is owner/admin only', () => roomTasks['.write']?.includes('!newData.exists()') && roomTasks['.write']?.includes('creatorId'));
check('room_tasks per-task member write exists', () => roomTasks.$taskId?.['.write']?.includes('members'));
check('room_tasks schema rejects malformed shared task data', () => roomTasks.$taskId?.['.validate']?.includes("newData.hasChildren(['text', 'status', 'done', 'priority', 'by', 'createdAt'])") && roomTasks.$taskId?.$other?.['.validate'] === false && roomTasks.$taskId?.text?.['.validate']?.includes('length <= 500'));
check('room_docs schema rejects malformed shared document data', () => {
  const roomDocs = rules.room_docs.$roomId;
  return roomDocs.$docId?.['.validate']?.includes("newData.hasChildren(['title', 'content', 'by', 'createdAt', 'updatedAt'])")
    && roomDocs.$docId?.content?.['.validate']?.includes('length <= 60000')
    && roomDocs.$docId?.editing?.$uid?.['.validate']?.includes("newData.child('uid').val() === $uid")
    && roomDocs.$docId?.$other?.['.validate'] === false;
});
check('unused room_pages path is locked', () => rules.room_pages['.read'] === false && rules.room_pages['.write'] === false);
check('kudos has validation guard', () => rules.users.$uid.kudos?.['.validate']?.includes('newData.val() === data.val()'));
check('privileged badges cannot be self-awarded', () => {
  const badgeRule = rules.users.$uid.badges.$badgeId?.['.write'] || '';
  const userRule = rules.users.$uid?.['.write'] || '';
  return badgeRule.includes("$badgeId === 'welcome' && auth.uid === $uid")
    && userRule.includes('!newData.exists()')
    && userRule.includes("!newData.child('badges').exists()")
    && userRule.includes("newData.child('badges').val() === data.child('badges').val()")
    && !badgeRule.includes('|| auth.uid === $uid ||')
    && rulesSmokeSource.includes('user cannot self-award founder badge')
    && rulesSmokeSource.includes('new user cannot create profile with bundled welcome badge')
    && rulesSmokeSource.includes('new user can delete own profile with badge present')
    && functionsSource.includes('exports.awardFounderBadgeOnRoomCreate')
    && !roomsSource.includes("window.awardBadge(window.currentUser.uid, 'founder')");
});
check('onboarding writes welcome badge separately from profile creation', () => authProfileSource.includes('ensureWelcomeBadge(user.uid, profile)')
  && profileActionsSource.includes("users/${window.currentUser.uid}/badges/welcome")
  && profileActionsSource.includes('function setSessionValue')
  && loginPageSource.includes('ensureWelcomeBadge: profileModule.ensureWelcomeBadge')
  && loginPageSource.includes('kit.ensureWelcomeBadge(credential.user.uid, profile)')
  && !authProfileSource.includes('badges: {\n      welcome')
  && !profileActionsSource.includes('badges: {\n        welcome')
  && !loginPageSource.includes('badges: {\n          welcome'));
check('app boot does not block on deferred CSS', () => !mainSource.includes('isAppLaunchRoute ? window.__minimalistDeferredCssReady'));
check('chat boot uses short bounded first and repeat floors', () => chatBootSource.includes('WARM_BOOT_MIN_MS = 120') && chatBootSource.includes('FIRST_BOOT_MIN_MS = 450') && chatBootSource.includes('BOOT_FADE_MS = 220'));
check('chat auth readiness is bounded and exposes recovery actions', () => authStateReadySource.includes('AUTH_STATE_READY_TIMEOUT_MS = 12_000')
  && chatPageSource.includes('waitForInitialAuthState(auth, onAuthStateChanged)')
  && chatPageSource.includes("className: 'boot-recovery-actions'")
  && chatPageSource.indexOf('waitForInitialAuthState(auth, onAuthStateChanged)') < chatPageSource.indexOf("import('../features/shell/chatApp.js')"));
check('chat profile hydration has a deadline and falls through to the shell', () => promiseTimeoutSource.includes('export function withTimeout(')
  && authGateSource.includes('PROFILE_READ_TIMEOUT_MS = 8_000')
  && authGateSource.includes('get(ref(db, path))')
  && authGateSource.includes("code: 'database/timeout'")
  && authGateSource.includes("if (error?.code === 'database/timeout') throw error")
  && authGateSource.includes('launchChatOnce();'));
check('mobile Google sign-in uses a same-tab redirect instead of a callback popup', () => (
  googleIdentityAuthSource.includes('export function shouldUseGoogleRedirectAuth()')
  && googleIdentityAuthSource.includes('browser.userAgentData?.mobile === true')
  && googleIdentityAuthSource.includes("'(pointer: coarse)'")
  && loginPageSource.includes('if (shouldUseGoogleRedirectAuth())')
  && loginPageSource.includes('await signInWithFirebaseGoogleRedirect(kit)')
  && loginPageSource.includes('shouldUseGoogleIdentityAuth() && !shouldUseGoogleRedirectAuth()')
  && loginPageSource.includes('GOOGLE_REDIRECT_RESULT_TIMEOUT_MS = 12_000')
  && loginPageSource.includes('ensureAuthProfileWithDeadline(kit, user, { welcome })')
));
check('service worker uses network-first navigations', () => swSource.includes("event.respondWith(networkFirst(request, '/index.html', {")
  && swSource.includes('preloadResponse: event.preloadResponse')
  && swSource.includes('timeoutMs: 3000'));
check('service worker caches hashed assets first and refreshes named static assets', () => swSource.includes('function cacheFirst(request, event)')
  && swSource.includes("if (url.pathname.startsWith('/assets/'))")
  && swSource.includes('event.respondWith(cacheFirst(request, event));')
  && swSource.includes('event.respondWith(staleWhileRevalidate(request, event));')
  && swSource.includes("CACHE_NAME = 'minimalist-offline-v27'"));
check('service worker cache writes cannot discard valid network responses', () => swSource.includes('const cacheUpdate = Promise.all([cache, network])')
  && swSource.includes('event.waitUntil(cacheUpdate)')
  && swSource.includes(".catch(() => undefined));\n  return work.then(({ response }) => response);"));
check('background services avoid duplicate service worker registration', () => !backgroundServicesSource.includes("navigator.serviceWorker.register('/sw.js')"));
check('PM notifications do not re-register or await the production service worker in development', () => pmInboxSource.includes('if (import.meta.env?.DEV) return null;')
  && pmInboxSource.includes('if (import.meta.env?.DEV || !vapidKey')
  && !pmInboxSource.includes('await navigator.serviceWorker.ready'));
check('RTDB rules smoke test script is wired', () => packageJson.scripts?.['audit:rules']?.includes('run-rtdb-rules-smoke.cmd') && rulesSmokeSource.includes('initializeTestEnvironment'));
check('RTDB rules smoke covers delegated permissions', () => rulesSmokeSource.includes('member can create channel with override') && rulesSmokeSource.includes('legacy raw webhook writes stay locked after permission override') && rulesSmokeSource.includes('member can manage known bot with manageBots override'));
check('RTDB rules smoke covers discovery privacy and call permissions', () => rulesSmokeSource.includes('discoverable room full metadata denied to outsider') && rulesSmokeSource.includes('member cannot screen share without screenShare permission'));
check('RTDB rules smoke covers message and PM immutability', () => rulesSmokeSource.includes('global message cannot be rewritten by another user') && rulesSmokeSource.includes('PM message cannot be rewritten by sender after delivery') && rulesSmokeSource.includes('recipient inbox write denied to sender client'));
check('RTDB rules smoke covers notification injection denial', () => rulesSmokeSource.includes('cross-user notification write denied to sender client') && rulesSmokeSource.includes('own notification client create denied'));
check('RTDB rules smoke covers docs and tasks schema hardening', () => rulesSmokeSource.includes('room task unknown field denied') && rulesSmokeSource.includes('room doc oversized content denied'));
check('deployed authenticated smoke test is wired', () => packageJson.scripts?.['audit:deployed'] === 'node tools/deployed-smoke-test.mjs');
check('deployed smoke covers chat, rooms, typing, both AI profiles, notifications, and issue queue', () => deployedSmokeSource.includes('write global chat message') && deployedSmokeSource.includes('write global channel typing') && deployedSmokeSource.includes('write private room channel typing') && deployedSmokeSource.includes('create private room') && deployedSmokeSource.includes("for (const modelProfile of ['fast', 'smart'])") && deployedSmokeSource.includes('trusted notification endpoint') && deployedSmokeSource.includes('submit issue draft'));
check('deployed smoke cleans exact test data', () => deployedSmokeSource.includes('delete global smoke message') && deployedSmokeSource.includes('delete room smoke metadata') && deployedSmokeSource.includes('support_issue_queue') && deployedSmokeSource.includes('/notifications/${state.friendUid}/friend_${state.uid}') && deployedSmokeSource.includes('accounts:delete'));
check('deployed smoke can send App Check tokens when enforcement is enabled', () => deployedSmokeSource.includes('FIREBASE_APP_CHECK_TOKEN') && deployedSmokeSource.includes('X-Firebase-AppCheck'));
check('default deploy command uses guarded deploy path', () => packageJson.scripts?.deploy?.includes('deploy-firebase-hourly.ps1') && !packageJson.scripts.deploy.includes('-Force') && packageJson.scripts?.['deploy:force']?.includes('-Force'));
check('landing v3 demo mirrors the authenticated chat workspace', () => marketingPagesSource.includes('function LandingDesktopDemo()')
  && marketingPagesSource.includes('id="home-live-demo"')
  && marketingPagesSource.includes('<DemoGlobalRail />')
  && marketingPagesSource.includes('<DemoRoomRail roomKey={roomKey}')
  && marketingPagesSource.includes('<DemoRoomTabs activeTab={activeTab}')
  && marketingPagesSource.includes('className="desktop-demo-channels"')
  && marketingPagesSource.includes('desktop-demo-catchup')
  && marketingPagesSource.includes('className="desktop-demo-quick-replies"')
  && marketingPagesSource.includes('className="desktop-demo-composer"'));
check('landing demo interactions stay local and resettable', () => marketingPagesSource.includes('const changeRoom = (nextRoom) =>')
  && marketingPagesSource.includes('const addLocalMessage = (text) =>')
  && marketingPagesSource.includes('setMessagesByRoom((current) =>')
  && marketingPagesSource.includes("['tasks', 'Tasks'")
  && marketingPagesSource.includes('const resetDemo = () =>')
  && marketingPagesSource.includes('aria-label="Reset demo"'));
check('landing v3 uses low-cost motion and phone-specific layout rules', () => baseCssSource.includes('Minimalist landing v3')
  && baseCssSource.includes('content-visibility: auto')
  && /\.desktop-demo-catchup\s*\{[^}]*transition:\s*transform[^;]*,\s*opacity/s.test(baseCssSource)
  && baseCssSource.includes('@media (max-width: 390px)')
  && baseCssSource.includes('@media (prefers-reduced-motion: reduce)'));
check('landing startup hands off once without replaying the first viewport', () => !entryLoaderSource.includes("document.addEventListener('DOMContentLoaded'")
  && mainSource.includes("document.querySelector('#root .landing-v3')")
  && mainSource.includes('window.__minimalistCssReady')
  && !mainSource.includes("staticShell.classList.add('static-home-hide')")
  && marketingPagesSource.includes('const animatedMarketingPaths = new Set()')
  && marketingPagesSource.includes("return marketingMotionPathKeys.has(pathname) ? pathname : '/404'")
  && marketingPagesSource.includes("'.landing-workflow'")
  && !marketingPagesSource.includes("'.landing-v3-section'")
  && !marketingPagesSource.includes("'.desktop-demo'")
  && baseCssSource.includes('body.marketing nav.marketing-nav-enter'));
check('landing navigation uses the compact floating desktop and mobile contract', () => marketingPagesSource.includes('className="marketing-nav-shell"')
  && marketingPagesSource.includes('className="marketing-nav-links"')
  && marketingPagesSource.includes("location.pathname.replace(/\\/+$/, '')")
  && marketingPagesSource.includes("menuOpen ? 'is-open' : ''")
  && marketingPagesSource.includes("aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}")
  && baseCssSource.includes('Landing navigation v4')
  && baseCssSource.includes('body.marketing nav[aria-label="Primary"]:has(.marketing-nav-shell)')
  && baseCssSource.includes('grid-template-columns: minmax(0, 1fr) auto')
  && baseCssSource.includes('width: min(20rem, calc(100vw - 1.3rem))')
  && baseCssSource.includes('calc(0.5rem + var(--app-safe-top')
  && baseCssSource.includes('backdrop-filter: none !important')
  && indexSource.includes('class="static-home-nav-shell"')
  && indexSource.includes('class="static-home-menu"'));
check('marketing header remains free of Firebase Auth imports', () => !marketingPagesSource.includes('firebase/auth') && !marketingNavSource.includes('firebase/auth'));
check('marketing navigation trusts the cross-route auth hint without loading Firebase', () => !marketingPagesSource.includes("import('../lib/marketingAuthState.js')")
  && marketingPagesSource.includes('AUTH_PRESENCE_HINT_EVENT')
  && marketingPagesSource.includes("window.addEventListener('storage'"));
check('signed-out chat routes redirect before importing the chat page', () => appSource.includes('function AuthenticatedChatRoute')
  && appSource.includes('if (readAuthPresenceHint() === false)')
  && appSource.includes('<Navigate to="/login" replace />'));
check('unavailable auth hint storage falls through to authoritative Firebase auth', () => authPresenceHintSource.includes('return null;')
  && appSource.includes('readAuthPresenceHint() === false'));
check('inactive themes load only when selected', () => loadCssSource.includes("getLazyType(link) !== 'theme'")
  && themeRuntimeSource.includes('function ensureThemeStylesheet')
  && themeRuntimeSource.includes('themeStylesheetPromises'));
check('runtime performance sampling is bounded and pauses while hidden', () => performanceSettingsSource.includes('FPS_SAMPLE_WINDOW')
  && performanceSettingsSource.includes('fpsWindowSamples >= FPS_SAMPLE_WINDOW')
  && performanceSettingsSource.includes("document.visibilityState === 'hidden'"));
check('modern motion observes additions without full-tree class rescans', () => modernThemeMotionSource.includes('record.addedNodes.forEach')
  && modernThemeMotionSource.includes("mutationObserver.observe(document.getElementById('root') || body, {\n      childList: true,\n      subtree: true,\n    });"));
check('prerendered non-home routes omit the landing demo shell', () => prerenderSource.includes('function removeHomeOnlyShell')
  && prerenderSource.includes('html = removeHomeOnlyShell(html)'));
check('homepage publishes a stable canonical URL and matching Open Graph URL', () => (
  indexSource.includes('<link rel="canonical" href="https://minimalist.chat/" />')
  && indexSource.includes('<meta property="og:url" content="https://minimalist.chat/" />')
  && marketingPagesSource.includes('upsertCanonical(canonicalUrl)')
));
check('shared route loading shells do not compete with the page H1 or main landmark', () => (
  indexSource.includes('<div id="app-boot-shell" class="instant-shell"')
  && !indexSource.includes('<h1 class="route-shell-title">')
  && !prerenderSource.includes('<h1 class="route-shell-title">')
));
check('robots advertises the canonical XML sitemap', () => (
  robotsSource.includes('Sitemap: https://minimalist.chat/sitemap.xml')
));
check('sitemap lists only canonical public marketing routes', () => (
  sitemapSource.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
  && ['/', '/features', '/pricing', '/download', '/story', '/faq', '/privacy', '/terms']
    .every((route) => sitemapSource.includes(`<loc>https://minimalist.chat${route}</loc>`))
  && !sitemapSource.includes('<loc>https://minimalist.chat/chat</loc>')
  && !sitemapSource.includes('<loc>https://minimalist.chat/login</loc>')
));
check('pricing and FAQ use one verified shared marketing data source', () => (
  appSource.includes("['/pricing', PricingPage]")
  && marketingPagesSource.includes("from '../content/marketingContent.js'")
  && prerenderSource.includes("from '../src/content/marketingContent.js'")
  && marketingContentSource.includes("displayPrice: '$1.99/month'")
  && marketingContentSource.includes("displayPrice: '$7.99/month'")
  && marketingContentSource.includes("displayPrice: '$11.99/month'")
  && marketingContentSource.includes("displayPrice: '$19.99/month'")
  && !marketingContentSource.includes('Scheduled messages')
));
check('structured data stays conservative and matches visible FAQ content', () => (
  indexSource.includes('"@type": "Organization"')
  && indexSource.includes('"@type": "WebSite"')
  && prerenderSource.includes("'@type': 'FAQPage'")
  && prerenderSource.includes('mainEntity: faqItems.map')
  && !indexSource.includes('aggregateRating')
  && !indexSource.includes('"review"')
));
check('unknown routes are hard 404s while approved dynamic entries remain rewrites', () => {
  const rewrites = firebaseJson.hosting.rewrites || [];
  return rewrites.length === 2
    && rewrites.some((entry) => entry.source === '/join/*' && entry.destination === '/index.html')
    && rewrites.some((entry) => entry.source === '/vault/share/*' && entry.destination === '/index.html')
    && !rewrites.some((entry) => entry.source === '**')
    && serverSource.includes("response.status(404).sendFile(notFoundFile")
    && prerenderSource.includes("path.join(distDir, '404.html')")
    && prerenderSource.includes('noindex: true');
});
check('SEO build and Hosting contracts are wired into the test suite', () => (
  packageJson.scripts?.['audit:seo:build'] === 'node --test tools/seo-build-smoke.test.mjs'
  && packageJson.scripts?.['audit:seo:hosting']?.includes('node tools/seo-hosting-smoke.mjs')
  && packageJson.scripts?.test?.includes('npm run audit:seo:build')
  && packageJson.scripts?.test?.includes('npm run audit:seo:hosting')
  && seoBuildSmokeSource.includes("'/pricing'")
  && seoHostingSmokeSource.includes('DYNAMIC_HTML_ROUTES')
  && seoHostingSmokeSource.includes('MISSING_ROUTES')
));
check('UI smoke test covers desktop/mobile public routes and landing demo interactions', () => packageJson.scripts?.['audit:ui'] === 'node tools/ui-smoke-test.mjs'
  && uiSmokeSource.includes('Chrome DevTools Protocol')
  && uiSmokeSource.includes("const routes = ['/', '/features', '/pricing', '/download', '/story', '/faq', '/privacy', '/terms', '/login', '/chat', '/seo-smoke-missing'];")
  && uiSmokeSource.includes('horizontal overflow')
  && uiSmokeSource.includes('landing demo exists on desktop without overflow')
  && uiSmokeSource.includes('landing demo room switch changes active room')
  && uiSmokeSource.includes('landing demo Chat and Tasks tabs change state')
  && uiSmokeSource.includes('landing demo local send clears input and adds message')
  && uiSmokeSource.includes('landing demo reset restores initial state')
  && uiSmokeSource.includes('homepage Compare plans reaches truthful pricing')
  && uiSmokeSource.includes('FAQ exposes six interactive visible answers')
  && uiSmokeSource.includes('branded not-found page returns home')
  && uiSmokeSource.includes('landing demo fits mobile without overflow')
  && uiSmokeSource.includes('desktop nav Features click')
  && uiSmokeSource.includes('modern navigation persists across marketing pages')
  && uiSmokeSource.includes('mobile navigation opens as a compact popover')
  && uiSmokeSource.includes('mobile navigation stays modern on Features')
  && uiSmokeSource.includes('mobile Open app click reaches login'));
check('chat composer auto-resizes draft textarea', () => chatCoreSource.includes('resizeComposerTextarea') && chatCoreSource.includes('textarea.scrollHeight'));
check('chat composer ignores Enter submit during IME composition', () => chatCoreSource.includes('event.nativeEvent?.isComposing') && chatCoreSource.includes('event.keyCode === 229') && chatCoreSource.includes('!isComposing'));
check('chat composer preserves draft until authoritative send succeeds', () => chatCoreSource.indexOf("await setWithAuthRetry(newMessageRef, payload);") < chatCoreSource.indexOf('clearComposerDraftStorage(activeId, submitChannelId);'));
check('chat drafts and typing indicators are scoped per channel', () => {
  const typingRule = rules.typing.$roomId.$channelId.$uid?.['.write'] || '';
  return chatCoreSource.includes('function composerDraftKey(roomId, channelId')
    && chatCoreSource.includes("return `draft:${roomId}:${normalizedChannelId(channelId)}`")
    && chatCoreSource.includes('function roomTypingRef(roomId, channelId')
    && chatCoreSource.includes('typing/${roomId}/${normalizedChannelId(channelId)}')
    && typingRule.includes('auth.uid === $uid')
    && typingRule.includes('newData.val().length <= 120')
    && rulesSmokeSource.includes('private room channel typing allowed for member');
});
check('performance settings profile persistence is covered by rules smoke', () => rulesSmokeSource.includes('user can persist own performance settings'));
check('chat latest-window removals are verified before local deletion', () => chatCoreSource.includes('could not verify removed message') && chatCoreSource.includes('currentSnapshot.exists()'));
check('chat history requests are scoped against room switches', () => chatCoreSource.includes('historyRequestIdRef.current === requestId') && chatCoreSource.includes('activeMessageScopeRef.current === scopeKey'));
check('chat history exhaustion is cached explicitly', () => chatCoreSource.includes('historyExhausted: historyExhaustedRef.current') && chatCoreSource.includes('oldestMessageKey: oldestMessageKeyRef.current') && !chatCoreSource.includes('oldestMessageKeyRef.current || existing.oldestMessageKey'));
check('chat history prepend restores the committed message anchor', () => chatCoreSource.includes('pendingHistoryScrollRestoreRef')
  && chatCoreSource.includes('captureMessageViewportAnchor(list)')
  && chatCoreSource.includes('historyRestore.messageId')
  && chatCoreSource.includes('nextOffset - historyRestore.offsetTop')
  && chatCoreSource.includes('historyRestore.scrollTop + (list.scrollHeight - historyRestore.scrollHeight)'));
check('chat latest-window backfills preserve Firebase ordering', () => chatCoreSource.includes('(snapshot, previousChildKey)') && chatCoreSource.includes('previousChildKey === null'));
check('active chat applies a bounded live message window', () => chatCoreSource.includes('MESSAGE_ACTIVE_HARD_LIMIT = 600')
  && chatCoreSource.includes('merged.length > MESSAGE_ACTIVE_HARD_LIMIT')
  && chatCoreSource.includes('MESSAGE_ACTIVE_HARD_LIMIT - messagesRef.current.length')
  && chatCoreSource.includes('limitToLast(historyPageSize)')
  && chatCoreSource.includes('captureMessageViewportAnchor(list)'));
check('chat history avoids estimated rows and replayed entry motion', () => chatCorePerformanceCssSource.includes('content-visibility: visible')
  && chatCorePerformanceCssSource.includes('contain-intrinsic-size: none')
  && featuresCssSource.includes('li.chat-message:not(:last-child)')
  && featuresCssSource.includes('animation: none !important'));
check('message avatars load eagerly while attachments remain lazy', () => /className="msg-avatar"[\s\S]{0,180}loading="eager"/.test(chatCoreSource)
  && /className="msg-attached-img"[\s\S]{0,180}loading="lazy"/.test(chatCoreSource));
check('chat shows loading and failure states for the initial message sync', () => chatCoreSource.includes('initialMessagesLoading') && chatCoreSource.includes('messagesLoadFailed') && chatCoreSource.includes("initialLoading ? 'loading' : loadFailed ? 'error' : 'empty'"));
check('room index recovery is deferred, throttled, and retry-bounded', () => chatCoreSource.includes('ROOM_INDEX_REPAIR_TTL_MS')
  && chatCoreSource.includes('scheduleRoomIndexRepair')
  && chatCoreSource.includes('refreshRetryCount >= 2')
  && chatCoreSource.includes('indexedRooms.length'));
check('saved room waits for an authoritative room index before falling back', () => chatCoreSource.includes('!currentRoom && roomIndexResolved') && chatCoreSource.indexOf('roomIndexResolved = true') < chatCoreSource.indexOf('applyRoomIndexRows(gatewayRooms)'));
check('late room gateway responses cannot overwrite fresher realtime indexes', () => chatCoreSource.includes('realtimeIndexVersion !== realtimeVersionAtRequest') && chatCoreSource.includes('realtimeIndexVersion += 1'));
check('room sidebar streams only live summary fields instead of full room metadata', () => chatCoreSource.includes('rooms_meta/${roomId}/lastMessage')
  && chatCoreSource.includes("['photoUrl', 'photoUrl']")
  && !chatCoreSource.includes('MAX_LIVE_ROOM_METADATA_LISTENERS'));
check('message history pagination distinguishes real user scroll intent', () => chatCoreSource.includes('messageScrollGestureActiveRef') && chatCoreSource.includes("event.type === 'pointerdown'") && chatCoreSource.includes("list.scrollTop <= 2") && chatCoreSource.includes("window.addEventListener('pointerup', endScrollGesture"));
check('room list keeps selection separate from nested action buttons', () => chatCoreSource.includes('className="room-select-button"') && !chatCoreSource.includes('role="button"\n      tabIndex={0}'));
check('client bot notices are owned by the requester', () => chatCoreSource.includes('requestedBy: profile.uid') && !chatCoreSource.includes("uid: `bot-${String(botName"));
check('room bot catalog lists only implemented and truthfully scoped automations', () => (
  ROOM_BOT_CATALOG.map((bot) => bot.id).join(',') === 'stockTracker,autoModeration'
  && ROOM_BOT_CATALOG.every((bot) => bot.executionMode.startsWith('client-'))
  && botCatalogSource.includes('This is not server-enforced moderation')
  && botCatalogSource.includes('The built-in /stock command works without installing this watcher')
));
check('platform bot slash commands are unique and describe the built-in stock command', () => {
  const commands = PLATFORM_BOT_SLASH_COMMANDS.map((entry) => entry.command);
  return new Set(commands).size === commands.length
    && commands.filter((command) => command === '/automod on').length === 1
    && PLATFORM_BOT_SLASH_COMMANDS.find((entry) => entry.command === '/stock')?.description.includes('not required');
});
check('room bot runtime normalizes watcher and all basic filter controls', () => {
  const config = normalizeRoomBotConfig({
    stockTracker: { enabled: true, symbols: '$aapl, TSLA, AAPL' },
    autoModeration: {
      enabled: true,
      blockedWords: 'Spam, raid, spam',
      blockLinks: true,
      blockCaps: false,
      blockFlood: false,
    },
  });
  return config.stockTracker.enabled
    && config.stockTracker.symbols.join(',') === 'AAPL,TSLA'
    && config.autoModeration.blockedWords.join(',') === 'spam,raid'
    && config.autoModeration.blockLinks
    && config.autoModeration.blockCaps === false
    && config.autoModeration.blockFlood === false
    && botRuntimeSource.includes('blockCaps: config.blockCaps !== false')
    && botRuntimeSource.includes('blockFlood: config.blockFlood !== false');
});
check('room bot runtime detects filter violations and ticker watcher triggers', () => (
  detectAutoModeration('This contains SPAM.', { enabled: true, blockedWords: ['spam'] })?.includes('blocked keyword')
  && detectAutoModeration('https://example.test', { enabled: true, blockLinks: true }) === 'links are restricted in this room'
  && extractStockSymbols('AAPL alongside $TSLA', { symbols: ['AAPL'] }).join(',') === 'TSLA,AAPL'
  && extractStockSymbols('/stock MSFT', {}, { commandOnly: true }).join(',') === 'MSFT'
));
check('chat subscribes to the small room bot path instead of fetching full metadata per send', () => (
  chatCoreSource.includes('const botConfigRef = useRef(normalizeRoomBotConfig())')
  && chatCoreSource.includes('rooms_meta/${roomId}/bots')
  && chatCoreSource.includes('waitForRoomBotConfig(activeId, requesterUid)')
  && chatCoreSource.includes('botConfigByRoomRef.current.clear()')
  && !chatCoreSource.includes('getRoomBotConfig(')
));
check('first private-room send waits for bounded bot configuration readiness', () => (
  chatCoreSource.includes('BOT_CONFIG_READY_TIMEOUT_MS')
  && chatCoreSource.includes('const botConfigLoadRef = useRef')
  && chatCoreSource.includes('waitForRoomBotConfig(activeId, requesterUid)')
  && chatCoreSource.includes('Room app settings are still loading. Your draft was kept')
));
check('stock automations stay bound to their originating channel and account', () => (
  chatCoreSource.includes('const requestContext = {')
  && chatCoreSource.includes('submitChannelId')
  && chatCoreSource.includes('BOT_REQUESTER_CHANGED_CODE')
  && chatCoreSource.includes('{ requesterUid: requestContext.requesterUid }')
));
check('client-authored bot output is labeled as requester-owned automation', () => (
  chatCoreSource.includes('automation: true')
  && chatCoreSource.includes('AUTOMATION')
  && chatCoreSource.includes('Client automation requested by')
  && chatCoreSource.includes('requestedBy: profile.uid')
  && !chatCoreSource.includes('message.requestedByName')
));
check('automation attribution rules bind requester identity to message ownership', () => {
  const globalValidation = rules.messages.$messageId['.validate'] || '';
  const roomValidation = rules.rooms_data.$roomId.messages.$messageId['.validate'] || '';
  const channelValidation = rules.rooms_data.$roomId.channels.$channelId.messages.$messageId['.validate'] || '';
  return [globalValidation, roomValidation, channelValidation].every((rule) => (
    rule.includes("child('requestedBy').val() === newData.child('uid').val()")
  ));
});
check('catch-up task creation reports write failures', () => chatCoreSource.includes('Task creation failed') && chatCoreSource.includes('Task failed:'));
check('catch-up remains available in read-only composer states', () => chatCoreSource.includes('const roomCatchUp = useMemo(() => (draft.trim() ? null : buildRoomCatchUp(messages))') && !chatCoreSource.includes('draft.trim() || composerDisabled ? null : buildRoomCatchUp(messages)'));
check('message reactions serialize and report write failures', () => chatCoreSource.includes('pendingReactionOpsRef') && chatCoreSource.includes('Reaction failed:'));
check('message action menu is viewport-clamped', () => messageToolsSource.includes('getBoundingClientRect') && messageToolsSource.includes('window.innerWidth - menuWidth') && featuresCssSource.includes('.msg-menu { position: fixed;'));
check('message menus clamp against app safe areas', () => messageToolsSource.includes('--app-safe-bottom') && chatCoreSource.includes('--app-safe-bottom') && chatCoreSource.includes('maxBottom'));
check('message action toolbar uses a seamless no-reflow PC gutter and compact touch fallback', () => featuresCssSource.includes('Modern message action toolbar') && featuresCssSource.includes('left: calc(100% - 6px)') && featuresCssSource.includes('width: 30px !important') && featuresCssSource.includes('width: 40px !important') && featuresCssSource.includes('border: 0 !important') && featuresCssSource.includes('position: static !important') && !featuresCssSource.includes('bottom: calc(100% + 8px)'));
check('mobile catch-up and composer use the dense footer contract', () => featuresCssSource.includes('Dense phone footer') && featuresCssSource.includes('--composer-min-height: 32px') && chatCoreSource.includes("getPropertyValue('--composer-min-height')") && chatCoreSource.includes('textarea.style.height = `${minHeight}px`') && chatCoreSource.includes('const scrollHeight = textarea.scrollHeight'));
check('message action toolbar supports grouped roving keyboard focus', () => chatCoreSource.includes('role="toolbar"') && chatCoreSource.includes('handleMessageToolbarKeyDown') && chatCoreSource.includes('msg-actions-divider'));
check('edit and delete actions use the permission-guarded overflow menu', () => messageToolsUiSource.includes("onAction('edit')") && messageToolsUiSource.includes("onAction('delete')") && messageToolsSource.includes("action === 'edit' || action === 'delete'") && messageToolsSource.includes('menu.roomId !== window.activeRoomId'));
check('emoji reaction dialog uses lazy keyboard-focusable buttons', () => emojiPickerSource.includes('ensureEmojiPickerOptions') && emojiPickerSource.includes("document.createElement('button')") && emojiPickerSource.includes("event.key === 'Escape'") && chatCoreSource.includes("aria-haspopup=\"dialog\""));
check('existing reaction pills expose toggle state to assistive technology', () => chatCoreSource.includes('aria-pressed={info.mine}') && chatCoreSource.includes('remove your reaction'));
check('mobile catch-up keeps clamped action context', () => mobileCssSource.includes('-webkit-line-clamp: 1') && featuresCssSource.includes('-webkit-line-clamp: 1'));
check('mobile chat action targets are thumb sized', () => mobileCssSource.includes('min-height: 40px !important') && baseCssSource.includes('max-height: 128px'));
check('mobile utility panels avoid double safe-area top padding', () => featuresCssSource.includes('padding-top: 0 !important') && featuresCssSource.includes('padding: 0.78rem 0.88rem 0.72rem !important'));
check('contacts action buttons are thumb sized', () => featuresCssSource.includes('min-width: 44px !important') && featuresCssSource.includes('min-height: 44px !important'));
check('contacts lifecycle suppresses hidden and overlapping renders', () => contactsSource.includes('if (!isContactsPanelOpen()) return;')
  && contactsSource.includes('let contactsRenderPromise = null')
  && contactsSource.includes('contactsRenderQueued = true')
  && contactsSource.includes('cancelMutualRoomRefreshes()'));
check('utility close paths synchronize Search state and stop hidden Quest listeners', () => (
  chatShellSource.includes("window.dispatchEvent(new CustomEvent('minimalist:close-search'))")
  && chatShellSource.includes('window.stopQuestLiveSync?.()')
  && gamifySource.includes('window.stopQuestLiveSync = stopQuestLiveSync')
  && gamifySource.includes('createHostAwareRoot')
  && gamifySource.includes('renderGeneration !== questRenderGeneration')
  && chatShellSource.includes("if (id === 'updates-panel')")
));
check('Quest board reuses one live context and refreshes safely at period boundaries', () => (
  gamifySource.includes('questLiveContextKey === contextKey')
  && gamifySource.includes('questLiveHost === el')
  && gamifySource.includes('scheduleQuestBoundaryRefresh(renderGeneration)')
  && gamifySource.includes("daily: { status: 'loading'")
  && gamifySource.includes("onRetry: () => window.renderQuests?.({ force: true, restoreFocus: true })")
));
check('Quest board exposes grouped progress semantics and auto-banked reward copy', () => (
  questListSource.includes('<progress')
  && questListSource.includes('aria-label={`${title} quests`}')
  && questListSource.includes('label="earned"')
  && !questListSource.includes('Claim')
));
check('Quest board keeps tablet and narrow-phone density bounded', () => (
  questListCssSource.includes('max-width: 640px')
  && questListCssSource.includes('@media (max-width: 360px)')
  && questListCssSource.includes('grid-template-columns: repeat(2, minmax(0, 1fr))')
  && questListCssSource.includes('@media (prefers-reduced-motion: reduce)')
));
check('Quest board color maps stay tied to skill and progress semantics', () => (
  questListSource.includes("'--quest-color': safeSkill.color")
  && questListCssSource.includes('background: var(--quest-color)')
  && questListCssSource.includes('--quest-metric-color: #0ea5e9')
  && questListCssSource.includes('--quest-metric-color: #22c55e')
));
check('Quest lazy load paints immediately and offers an in-panel retry', () => (
  updatesCenterShellSource.includes('Preparing quests')
  && chatAppSource.includes('renderQuestImportError')
  && chatAppSource.includes("lazyWindowFunction('community-services', communityServicesImporter, 'renderQuests'")
));
check('Contacts warms early and paints before listener/profile work', () => {
  const openStart = contactsSource.indexOf('function openContactsPanel()');
  const openEnd = contactsSource.indexOf('function closeContactsPanel()', openStart);
  const openContactsSource = openStart >= 0 && openEnd > openStart
    ? contactsSource.slice(openStart, openEnd)
    : '';
  return chatAppSource.includes('prefetchContactsAfterFirstPaint')
    && chatAppSource.includes("document.addEventListener('pointerdown', warmContactsOnIntent")
    && chatShellSource.includes("contactsPanel?.classList.add('open')")
    && chatShellSource.includes('if (window.openContactsPanel) window.openContactsPanel()')
    && openContactsSource.includes('window.requestAnimationFrame(() => window.requestAnimationFrame(startContactsWork))')
    && openContactsSource.indexOf("panel.classList.add('open')") < openContactsSource.indexOf('startContactSubscriptions(uid)')
    && openContactsSource.indexOf('startContactSubscriptions(uid)') < openContactsSource.indexOf('scheduleContactsProfilePrewarm()');
});
check('contacts profile prewarm is single-shot and safely cancellable', () => (
  contactsSource.includes('let contactsProfilePrewarmHandle = null')
  && contactsSource.includes('if (contactsProfilePrewarmed || contactsProfilePrewarmHandle !== null) return')
  && contactsSource.includes('cancelContactsProfilePrewarm();')
));
check('contacts profile reads are bounded, cached, and single-flight', () => contactsSource.includes('const contactUserLoads = new Map()')
  && contactsSource.includes('const CONTACT_USER_CACHE_LIMIT = 400')
  && contactsSource.includes('if (contactUserLoads.has(uid)) return contactUserLoads.get(uid)')
  && contactsListSource.includes('loading="lazy"'));
check('contacts reuses the boot inbox stream instead of adding a duplicate Firebase listener', () => contactsSource.includes("window.addEventListener('minimalist:pm-inbox'")
  && !contactsSource.includes('onValue(ref(db, `inbox/${uid}`)'));
check('contacts closes through lifecycle cleanup before other utility surfaces', () => roomFeatureLoadersSource.includes('closeContactsPanelIfOpen();')
  && profilePopupSource.includes("typeof window.closeContactsPanel === 'function'")
  && messageToolsSource.includes("typeof window.closeContactsPanel === 'function'"));
check('contacts React root follows the current chat DOM host', () => contactsSource.includes('contactsRootHost !== list')
  && contactsSource.includes('window.disposeContactsPanel = disposeContactsPanel'));
check('mobile public profile has an explicit accessible close path', () => chatPageSource.includes('id: "close-user-profile-btn"')
  && chatPageSource.includes('"aria-modal": "true"')
  && chatPageSource.includes('"aria-hidden": "true"')
  && featuresCssSource.includes('#user-profile-popup .profile-popup-close')
  && mobileCssSource.includes('-webkit-overflow-scrolling: touch'));
check('public profile renders cached identity before its network refresh settles', () => profilePopupSource.indexOf('window.getCachedContactPublicProfile?.(targetUid)') < profilePopupSource.indexOf('await Promise.all([publicProfilePromise')
  && profilePopupSource.indexOf("popup.classList.remove('hidden')") < profilePopupSource.indexOf('await Promise.all([publicProfilePromise')
  && profilePopupSource.includes('const publicProfileLoads = new Map()'));
check('public profile enhancements are parallel and stale-response guarded', () => profilePopupSource.includes('let profileRequestVersion = 0')
  && profilePopupSource.includes('isCurrentProfileRequest(requestId, targetUid)')
  && profilePopupSource.includes('void Promise.allSettled(enhancements)'));
check('public profile social enrichment is bounded, single-flight, and mutation-safe', () => (
  socialSource.includes('const FOLLOW_SOCIAL_CACHE_TTL = 30 * 1000')
  && socialSource.includes('followStatusCache.load(')
  && socialSource.includes('followCountsCache.load(uid')
  && socialSource.includes('invalidateFollowSocialCache(viewerUid, targetUid);')
  && timedSingleFlightCacheSource.includes('while (cache.size > safeMaxEntries)')
  && timedSingleFlightCacheSource.includes('if (inFlight.get(key) === request)')
));
check('Contacts PM handoff restores Contacts only on user close', () => contactsSource.includes("returnTo: 'contacts'")
  && privateMessagesSource.includes('let pmReturnSurface = null')
  && privateMessagesSource.includes("returnSurface === 'contacts'")
  && privateMessagesSource.includes('restoreOrigin: false')
  && chatShellSource.includes('closePrivateChatDock({ restoreOrigin: false })'));
check('coarse pointer chat controls are thumb sized', () => featuresCssSource.includes('width: 44px !important') && featuresCssSource.includes('min-height: 44px !important') && mobileCssSource.includes('min-width: 44px'));
check('Android bottom safe-area fallback is wired', () => baseCssSource.includes('--android-safe-bottom') && baseCssSource.includes('max(env(safe-area-inset-bottom') && read('src/features/shell/nativePlatform.js').includes('--android-safe-bottom'));
check('welcome tour modal is viewport bounded on mobile', () => featuresCssSource.includes('max-height: calc(100dvh - 3rem)') && featuresCssSource.includes('.wt-modal-actions { position: sticky') && featuresCssSource.includes('align-items: flex-start'));
check('marketing skips app-only responsive route styles', () => (
  loadCssSource.includes('function isResponsiveStylesheet')
  && loadCssSource.includes('if (!isAppRoute) return false;')
  && loadCssSource.includes("var routineDeferredLinks = isAppRoute")
));
check('app CSS loader matches and live-switches the mobile stylesheet breakpoint', () => loadCssSource.includes("window.matchMedia('(max-width: 768px)')") && loadCssSource.includes('return mobileStylesViewport') && loadCssSource.includes('!isResponsiveStylesheet(link)') && loadCssSource.includes("mobileStylesQuery.addEventListener('change'") && loadCssSource.includes("return '(min-width: 769px)'"));
check('modal overlays stay above the desktop rail and parent settings dialogs', () => baseCssSource.includes('z-index: 10990 !important') && baseCssSource.includes('#delete-account-modal') && baseCssSource.includes('z-index: 11050 !important') && baseCssSource.includes('z-index: 11060'));
check('chat message scrolling avoids forced smooth behavior', () => featuresCssSource.includes('#messages {') && featuresCssSource.includes('scroll-behavior: auto'));
check('RTDB smoke covers full directory and per-user room index contracts', () => rulesSmokeSource.includes('pronouns:') && rulesSmokeSource.includes('bio:') && rulesSmokeSource.includes('status:') && rulesSmokeSource.includes('flair:') && rulesSmokeSource.includes('user can write own room index row') && rulesSmokeSource.includes('user cannot write another user room index row'));
check('phone app panels reserve bottom nav clearance', () => featuresCssSource.includes('bottom: var(--mobile-nav-clearance') && featuresCssSource.includes('height: auto !important'));
check('mobile toast and auth inputs respect safe mobile sizing', () => baseCssSource.includes('bottom: calc(var(--mobile-nav-clearance') && /body\.auth-screen \.auth-form input\s*\{[^}]*font-size:\s*1rem;/s.test(baseCssSource));
check('PM mobile header and composer respect app safe areas', () => mobileCssSource.includes('calc(0.7rem + var(--app-safe-top') && mobileCssSource.includes('var(--app-safe-bottom, env(safe-area-inset-bottom'));
check('mobile marketing and auth tap targets are thumb sized', () => baseCssSource.includes('#marketing-mobile-nav-links .mobile-link') && baseCssSource.includes('min-height: 44px !important') && baseCssSource.includes('.feat-nav-chip { width: auto; min-height: 44px') && baseCssSource.includes('.auth-home-link') && baseCssSource.includes('body.auth-screen .pw-toggle') && baseCssSource.includes('min-width: 54px'));
check('room webhooks pin public targets, reject redirects, and bound requests', () => functionsSource.includes('function isPrivateWebhookAddress') && functionsSource.includes('async function resolveRoomWebhookTarget') && functionsSource.includes('dns.lookup(hostname') && functionsSource.includes('fetchWebhookWithTimeout') && functionsSource.includes('lookup: (_hostname, lookupOptions, callback)') && functionsSource.includes("Connection: 'close'") && functionsSource.includes('Room webhook redirect blocked') && functionsSource.includes('ROOM_WEBHOOK_TIMEOUT_MS = 5000'));
check('room webhook secrets and health are instance and revision bound', () => functionsSource.includes('initializeRoomIntegrationInstanceOnCreate') && functionsSource.includes('roomInstanceId: integration.instanceId') && functionsSource.includes('current.revision !== config.revision') && functionsSource.includes('roomWebhookConfigIsCurrent'));

const cspHeader = firebaseJson.hosting.headers
  .flatMap((entry) => entry.headers || [])
  .find((header) => header.key === 'Content-Security-Policy')?.value || '';
const cspDirectiveSources = (directive) => {
  const match = new RegExp(`(?:^|;)\\s*${directive}\\s+([^;]+)`).exec(cspHeader);
  return new Set(match?.[1].trim().split(/\s+/) || []);
};
const cspScriptSources = cspDirectiveSources('script-src');
const cspConnectSources = cspDirectiveSources('connect-src');
const cspFrameSources = cspDirectiveSources('frame-src');
check('hosting CSP allows Google sign-in assets', () => cspHeader.includes('https://accounts.google.com') && cspHeader.includes('https://apis.google.com') && cspHeader.includes('style-src') && cspHeader.includes('https://accounts.google.com'));
check('hosting CSP allows App Check reCAPTCHA assets', () => cspHeader.includes('https://www.google.com/recaptcha/') && cspHeader.includes('https://www.gstatic.com/recaptcha/') && cspHeader.includes('https://recaptcha.google.com/recaptcha/'));
check('hosting CSP limits RTDB long-poll scripts and frames to Firebase .lp endpoints', () => (
  cspScriptSources.has('https://*.firebaseio.com/.lp')
  && cspFrameSources.has('https://*.firebaseio.com/.lp')
  && !cspScriptSources.has('https://*.firebaseio.com')
  && !cspFrameSources.has('https://*.firebaseio.com')
  && cspConnectSources.has('https://*.firebaseio.com')
  && cspConnectSources.has('wss://*.firebaseio.com')
));

{
  const googleCalendarConnectionStateSource = read('src/features/calendar/googleCalendarConnectionState.js');
  check('Google Calendar connection persistence is versioned and Firebase-UID scoped', () => (
    googleCalendarConnectionStateSource.includes("const CONNECTION_KEY_PREFIX = 'minimalist:gcal-connection:v1:'")
    && googleCalendarConnectionStateSource.includes('encodeURIComponent(value)')
    && googleCalendarConnectionStateSource.includes('getGoogleCalendarConnectionState(uid)')
    && googleCalendarConnectionStateSource.includes('setGoogleCalendarConnectionState(uid, connected)')
    && !calendarSource.includes("localStorage.getItem('gcalConnected')")
    && !calendarSource.includes("localStorage.setItem('gcalConnected'")
  ));
  check('Google Calendar OAuth session fails closed across Minimalist account changes', () => (
    googleCalendarConnectionStateSource.includes("let activeSessionUid = ''")
    && googleCalendarConnectionStateSource.includes('activateGoogleCalendarSession(uid)')
    && googleCalendarConnectionStateSource.includes('activeSessionToken = null')
    && calendarSource.includes('gcalSilentTried = false')
    && calendarSource.includes('isGoogleCalendarSessionActive(authorizationUid)')
  ));
  check('Google Calendar exposes observable connection state and a revoking Disconnect action', () => (
    googleCalendarConnectionStateSource.includes('GOOGLE_CALENDAR_CONNECTION_EVENT')
    && googleCalendarConnectionStateSource.includes('window.dispatchEvent(new CustomEvent')
    && googleCalendarConnectionStateSource.includes('disconnectGoogleCalendarConnection(uid)')
    && googleCalendarConnectionStateSource.includes('window.google?.accounts?.oauth2?.revoke')
    && calendarSource.includes('id="cal-gcal-disconnect-btn"')
    && calendarSource.includes('disconnectGoogleCalendarConnection(connectionUid)')
    && roomAppsPanelSource.includes('id="rs-disconnect-google-calendar"')
    && roomsSource.includes("getElementById('rs-disconnect-google-calendar')?.addEventListener")
  ));
}

const failed = checks.filter((item) => !item.ok);
for (const item of checks) {
  console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}`);
}

if (failed.length) {
  console.error(`\n${failed.length} audit regression check(s) failed.`);
  process.exit(1);
}

console.log(`\n${checks.length} audit regression checks passed.`);
