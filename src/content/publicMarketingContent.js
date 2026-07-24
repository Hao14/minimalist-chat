function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

export const featureStatusLabels = deepFreeze({
  available: 'Available now',
  beta: 'Beta or availability varies',
  planned: 'Not in the current release',
});

export const featureCatalog = deepFreeze([
  {
    id: 'room-chat',
    group: 'communicate',
    title: 'Room chat',
    status: 'available',
    summary: 'Keep the main conversation readable with channels, reactions, replies, files, links, and room-level controls nearby.',
  },
  {
    id: 'private-messaging',
    group: 'communicate',
    title: 'Private messaging',
    status: 'available',
    summary: 'Continue one-to-one conversations from Contacts and return to recent threads from the private-message inbox.',
  },
  {
    id: 'calls-screen-sharing',
    group: 'communicate',
    title: 'Calls and screen sharing',
    status: 'available',
    summary: 'Start supported voice or video calls and share a screen when the room, account plan, permissions, and device allow it.',
  },
  {
    id: 'catch-up',
    group: 'catch-up',
    title: 'Catch-Up',
    status: 'available',
    summary: 'Return to a busy room with a shorter view of recent updates and AI-assisted actions such as summarizing or extracting tasks.',
  },
  {
    id: 'search',
    group: 'catch-up',
    title: 'Search',
    status: 'available',
    summary: 'Find rooms, people, and recent conversation without manually reopening every space.',
  },
  {
    id: 'focus-views',
    group: 'catch-up',
    title: 'Focus-friendly views',
    status: 'available',
    summary: 'Use quieter presentation and density options when the full room workspace would be distracting.',
  },
  {
    id: 'docs-whiteboards',
    group: 'collaborate',
    title: 'Docs and whiteboards',
    status: 'available',
    summary: 'Keep shared notes and visual planning inside the room where the related conversation already lives.',
  },
  {
    id: 'tasks',
    group: 'collaborate',
    title: 'Tasks',
    status: 'available',
    summary: 'Turn useful conversation into visible next steps and keep those tasks connected to the room.',
  },
  {
    id: 'polls-decisions',
    group: 'collaborate',
    title: 'Polls and decision context',
    status: 'available',
    summary: 'Use polls, pinned context, and catch-up summaries to make an agreement easier to find after the conversation moves on.',
  },
  {
    id: 'events-calendar',
    group: 'plan',
    title: 'Events and calendar',
    status: 'available',
    summary: 'Plan room events and keep dates, reminders, and the surrounding discussion in one workspace.',
  },
  {
    id: 'google-calendar',
    group: 'plan',
    title: 'Google Calendar connection',
    status: 'beta',
    summary: 'Connect Google Calendar to import or create supported events; availability depends on configuration, permissions, and the active session.',
  },
  {
    id: 'room-setup',
    group: 'plan',
    title: 'Room setup presets',
    status: 'beta',
    summary: 'Reuse selected room settings and structure where supported; this is not yet a complete public template library.',
  },
  {
    id: 'roles-permissions',
    group: 'moderate',
    title: 'Roles and permissions',
    status: 'available',
    summary: 'Let room creators and authorized managers control membership, roles, and access to room tools.',
  },
  {
    id: 'moderation',
    group: 'moderate',
    title: 'Moderation tools',
    status: 'available',
    summary: 'Use reports, member controls, permissions, and configured safety tools to manage a shared space.',
  },
  {
    id: 'communities',
    group: 'moderate',
    title: 'Communities and discovery',
    status: 'available',
    summary: 'Create a discoverable community or keep a friends group private, with visibility controlled by the room type and settings.',
  },
  {
    id: 'room-ai',
    group: 'ai',
    title: 'Room AI',
    status: 'beta',
    summary: 'Ask for summaries, tasks, patterns, or event help through an authenticated gateway with limited relevant room context.',
  },
  {
    id: 'winston',
    group: 'ai',
    title: 'Winston personal agent',
    status: 'beta',
    summary: 'Pro accounts can use a personal agent with saved preferences and instructions, subject to provider capacity and displayed usage limits.',
  },
  {
    id: 'scheduled-messages',
    group: 'plan',
    title: 'Scheduled messages',
    status: 'planned',
    summary: 'Scheduled sending is not part of the current public release, so important reminders should use available event or messaging tools.',
  },
  {
    id: 'role-onboarding',
    group: 'moderate',
    title: 'Role onboarding checklists',
    status: 'planned',
    summary: 'Guided role-specific onboarding is not part of the current public release.',
  },
  {
    id: 'broader-offline',
    group: 'catch-up',
    title: 'Broader offline access',
    status: 'planned',
    summary: 'The installed web experience can cache app resources, but durable offline access to every room surface is not in the current release.',
  },
]);

export const featureGroups = deepFreeze([
  {
    id: 'communicate',
    title: 'Communicate',
    summary: 'Start with conversation and move naturally between a room, a private thread, and a supported call.',
    featureIds: ['room-chat', 'private-messaging', 'calls-screen-sharing'],
  },
  {
    id: 'catch-up',
    title: 'Catch up',
    summary: 'Return to the signal without treating every unread message as equally important.',
    featureIds: ['catch-up', 'search', 'focus-views', 'broader-offline'],
  },
  {
    id: 'collaborate',
    title: 'Collaborate',
    summary: 'Keep notes, visual thinking, tasks, polls, and decision context next to the discussion that created them.',
    featureIds: ['docs-whiteboards', 'tasks', 'polls-decisions'],
  },
  {
    id: 'plan',
    title: 'Plan',
    summary: 'Turn room context into events and practical follow-through while being clear about what is still being developed.',
    featureIds: ['events-calendar', 'google-calendar', 'room-setup', 'scheduled-messages'],
  },
  {
    id: 'moderate',
    title: 'Moderate',
    summary: 'Give room managers the controls needed to shape access, visibility, roles, and safety.',
    featureIds: ['roles-permissions', 'moderation', 'communities', 'role-onboarding'],
  },
  {
    id: 'ai',
    title: 'Use AI when it helps',
    summary: 'AI stays an assisted workflow with visible limits, provider dependencies, and output that people should review.',
    featureIds: ['room-ai', 'winston'],
  },
]);

export const featureOverview = deepFreeze([
  {
    id: 'communicate',
    title: 'Communicate',
    benefit: 'Keep conversation clear',
    summary: 'Room chat and private threads keep the discussion readable and close to the people in it.',
    plan: 'Free',
    featureIds: ['room-chat', 'private-messaging'],
    media: '/assets/marketing/feature-catchup.png',
    mediaAlt: 'Minimalist room chat with messages, room tools, Catch-Up, quick replies, and the composer.',
    mediaPosition: 'center top',
  },
  {
    id: 'catch-up',
    title: 'Catch Up',
    benefit: 'Understand what you missed',
    summary: 'Review recent activity, contributors, questions, files, and useful follow-up actions without rereading the whole scroll.',
    plan: 'Availability varies',
    featureIds: ['catch-up'],
    media: '/assets/marketing/feature-catchup.png',
    mediaAlt: 'Minimalist Catch-Up showing recent room activity and actions to summarize, save a task, search, or return to the latest message.',
    mediaPosition: 'center bottom',
  },
  {
    id: 'create',
    title: 'Create',
    benefit: 'Keep shared knowledge nearby',
    summary: 'Write shared docs and keep visual thinking beside the conversation that created it.',
    plan: 'Free',
    featureIds: ['docs-whiteboards'],
    media: '/assets/marketing/feature-docs.png',
    mediaAlt: 'Minimalist Docs showing search, tags, and shared room documents with owners and recent update dates.',
    mediaPosition: 'center center',
  },
  {
    id: 'plan',
    title: 'Plan',
    benefit: 'Turn messages into action',
    summary: 'Move useful room context into owned tasks, priorities, due dates, and a visible path to done.',
    plan: 'Free',
    featureIds: ['tasks', 'polls-decisions'],
    media: '/assets/marketing/feature-tasks.png',
    mediaAlt: 'Minimalist Tasks showing a room workflow board with backlog, to-do, in-progress, and done columns.',
    mediaPosition: 'center center',
  },
  {
    id: 'meet',
    title: 'Meet',
    benefit: 'Coordinate without another tool',
    summary: 'Plan room events, keep the surrounding context nearby, and move into a supported call when text is not enough.',
    plan: 'Availability varies',
    featureIds: ['events-calendar', 'calls-screen-sharing'],
    media: '/assets/marketing/feature-events.png',
    mediaAlt: 'Minimalist Events showing upcoming dates, an agenda, event details, and an Add to Google action.',
    mediaPosition: 'center center',
  },
  {
    id: 'search',
    title: 'Search',
    benefit: 'Find context fast',
    summary: 'Find rooms, people, and recent conversation without reopening every space.',
    plan: 'Free',
    featureIds: ['search', 'focus-views'],
    media: '/assets/marketing/feature-catchup.png',
    mediaAlt: 'Minimalist room workspace with the global search control and recent conversation visible.',
    mediaPosition: 'center top',
  },
  {
    id: 'moderate',
    title: 'Moderate',
    benefit: 'Keep the room healthy',
    summary: 'Shape access, roles, visibility, membership, and safety with room-level controls.',
    plan: 'Room plan',
    featureIds: ['roles-permissions', 'moderation', 'communities'],
    media: '/assets/marketing/feature-catchup.png',
    mediaAlt: 'Minimalist private room workspace where room-level tools and permissions stay attached to the room.',
    mediaPosition: 'left top',
  },
  {
    id: 'ai',
    title: 'AI',
    benefit: 'Get help when it earns its place',
    summary: 'Ask for summaries, tasks, patterns, or event help through assisted workflows with visible limits.',
    plan: 'Availability varies',
    featureIds: ['room-ai', 'winston'],
    media: '/assets/marketing/feature-ai.png',
    mediaAlt: 'Minimalist AI controls showing room AI settings and availability choices inside the product.',
    mediaPosition: 'center center',
  },
]);

export const homePageContent = deepFreeze({
  slug: '',
  meta: {
    title: 'Minimalist.chat | Calm, organized rooms',
    description: 'Minimalist.chat is a calm, organized rooms platform for conversation, Catch-Me-Up digests, tasks, docs, events, calls, search, moderation, and AI-assisted workflows.',
  },
  shell: {
    kicker: 'Minimalist',
    title: 'Catch up without catching the chaos.',
    copy: 'One calm room for conversation, decisions, tasks, files, events, and the context you missed.',
  },
  hero: {
    label: 'Minimalist',
    title: 'Catch up without catching the chaos.',
    copy: 'One calm room for conversation, decisions, tasks, files, events, and the context you missed.',
    actions: [
      { label: 'Open the app', href: '/chat' },
      { label: 'See how rooms work', href: '#landing-workflow' },
    ],
  },
  workflow: {
    title: 'From conversation to clarity.',
    copy: 'Keep talking naturally. Minimalist helps the useful parts become context, decisions, and next steps without breaking the room apart.',
    steps: [
      { id: 'chat', title: 'The conversation stays readable.', copy: 'Messages remain the center of the room, with quieter chrome and the important tools close by.' },
      { id: 'catch-up', title: 'The room does the scanning.', copy: 'Catch-Me-Up separates key updates, decisions, and loose ends from the raw scroll.' },
      { id: 'tasks', title: 'Next steps stay attached to context.', copy: 'Turn the useful part of a conversation into a clear task without rebuilding it somewhere else.' },
    ],
  },
  signal: {
    title: 'A room that grows with you.',
    copy: 'Start with a clear conversation. Bring in structure only when it makes the room more useful.',
    featureIds: ['catch-up', 'focus-views', 'tasks', 'search'],
  },
  plans: {
    title: 'Start free. Upgrade only when you need more room.',
    copy: 'Account plans follow one signed-in person. Optional room subscriptions are separate and are managed for one private room.',
    action: { label: 'Compare plans', href: '/pricing' },
  },
  close: {
    title: 'Your calm workspace for what matters.',
    copy: 'Less noise. More signal. Open Minimalist and get back to focus.',
    primaryAction: { label: 'Open the app', href: '/chat' },
    secondaryAction: { label: 'See every feature', href: '/features' },
  },
});

export const featuresPageContent = deepFreeze({
  slug: 'features',
  meta: {
    title: 'Minimalist | Features',
    description: 'Explore Minimalist chat, Catch-Me-Up, tasks, docs, whiteboards, events, calls, search, permissions, moderation, analytics, and AI-assisted room workflows.',
  },
  shell: {
    kicker: 'Features',
    title: 'A calmer room, with real depth.',
    copy: 'Start with conversation. Bring in catch-ups, tasks, docs, events, calls, search, moderation, and AI only when the room needs them.',
  },
  hero: {
    label: 'Features',
    title: 'A calmer room, with real depth.',
    copy: 'Start with conversation. Bring in catch-ups, tasks, docs, events, calls, search, moderation, and AI only when the room needs them.',
    primaryAction: { label: 'Explore the system', href: '#feature-groups' },
    secondaryAction: { label: 'Open the app', href: '/chat' },
  },
  statusIntro: 'Plan badges are a quick guide. Availability can still depend on the account plan, room permissions, provider capacity, configuration, browser, and device.',
  overview: featureOverview,
  groups: featureGroups,
  catalog: featureCatalog,
  workflow: {
    title: 'Calm first. Depth on demand.',
    steps: [
      { title: 'Begin with a room', copy: 'Conversation, people, and current context stay obvious from the first message.' },
      { title: 'Bring back the signal', copy: 'Use Catch-Up, search, and focus-friendly views when the scroll grows.' },
      { title: 'Add the right structure', copy: 'Open tasks, docs, events, moderation, or AI only for the work at hand.' },
    ],
  },
  close: {
    title: 'Start calm. Add power when it earns its place.',
    copy: 'Create a room, invite your people, and let the workspace grow with the conversation.',
    primaryAction: { label: 'Open the app', href: '/chat' },
    secondaryAction: { label: 'Download', href: '/download' },
  },
});

export const downloadPageContent = deepFreeze({
  slug: 'download',
  meta: {
    title: 'Minimalist | Download',
    description: 'Open the Minimalist web app today, install or pin it from a supported browser, and see honest availability for desktop and mobile platforms.',
  },
  shell: {
    kicker: 'Download',
    title: 'Minimalist is ready in your browser.',
    copy: 'Open the room workspace now. Install or pin it from a supported browser for a faster, app-like return.',
  },
  hero: {
    label: 'Download',
    title: 'Minimalist is ready in your browser.',
    copy: 'Open the room workspace now. Install or pin it from a supported browser for a faster, app-like return.',
    primaryAction: { label: 'Open the web app', href: '/chat' },
    secondaryAction: { label: 'Explore features', href: '/features' },
  },
  platforms: [
    {
      id: 'web',
      title: 'Web App',
      status: 'Available now',
      availability: 'available',
      summary: 'Use Minimalist in a supported desktop or mobile browser. Installation is offered only when the browser and device support it.',
      action: { label: 'Open the web app', href: '/chat' },
    },
    {
      id: 'windows',
      title: 'Windows',
      status: 'Not announced',
      availability: 'not-announced',
      summary: 'Use the web app on Windows today; no public Windows installer or minimum-version promise is currently published.',
      action: { label: 'Use the web app', href: '/chat' },
    },
    {
      id: 'macos',
      title: 'macOS',
      status: 'Not announced',
      availability: 'not-announced',
      summary: 'Use the web app on macOS today; no public macOS installer or hardware-support promise is currently published.',
      action: { label: 'Use the web app', href: '/chat' },
    },
    {
      id: 'android',
      title: 'Android',
      status: 'Not announced',
      availability: 'not-announced',
      summary: 'Use the mobile web app on Android today. Internal wrapper work does not represent a public Android release.',
      action: { label: 'Use the web app', href: '/chat' },
    },
    {
      id: 'ios',
      title: 'iPhone and iPad',
      status: 'Not announced',
      availability: 'not-announced',
      summary: 'Use the mobile web app and the browser-provided Add to Home Screen flow where available; no public App Store release is currently published.',
      action: { label: 'Use the web app', href: '/chat' },
    },
  ],
  installSteps: [
    { title: 'Open', copy: 'Open the web app in a current supported browser.' },
    { title: 'Install when offered', copy: 'Use the browser install control or Add to Home Screen option when your browser and device provide one.' },
    { title: 'Sign in', copy: 'Cloud-backed account and room data follows your sign-in; some device preferences and cached data remain local.' },
  ],
  syncFacts: [
    'Cloud-backed rooms, messages, files, profile information, and subscription status are associated with the signed-in account.',
    'Theme choices, saved account hints, notification state, calendar connection state, and offline caches can be specific to the current device or browser.',
    'Install prompts, notifications, camera access, sharing, and background behavior vary by browser, operating system, and permission settings.',
  ],
  faqs: [
    { question: 'Is there a native installer?', answer: 'The web app is the public path today. Minimalist does not currently publish a Windows, macOS, Android, iPhone, or iPad native release.' },
    { question: 'Can I use Minimalist on my phone?', answer: 'Yes. Open the web app in a supported mobile browser and use Add to Home Screen when the browser offers it.' },
    { question: 'Does everything follow my sign-in?', answer: 'Cloud-backed room and account information follows the signed-in account. Some preferences, permissions, connection markers, and cached data remain on the current device.' },
    { question: 'Is the web app free?', answer: 'Base account access is free. Paid account plans and separate optional room subscriptions are described on the Pricing page.' },
  ],
  close: {
    title: 'Your room is already within reach.',
    copy: 'Open Minimalist in the browser now, then pin it wherever you work.',
    primaryAction: { label: 'Open the web app', href: '/chat' },
    secondaryAction: { label: 'View pricing', href: '/pricing' },
  },
});

export const storyPageContent = deepFreeze({
  slug: 'story',
  meta: {
    title: 'Minimalist | Story',
    description: 'Why Minimalist is building calmer rooms where conversation, files, tasks, events, calls, and useful context can live together without turning into noise.',
  },
  shell: {
    kicker: 'Story',
    title: 'Good rooms remember.',
    copy: 'Conversation should leave people clearer, not more overwhelmed.',
  },
  hero: {
    label: 'Story',
    title: 'Good rooms remember.',
    copy: 'Minimalist began with a simple belief: conversation should leave people clearer, not more overwhelmed.',
    primaryAction: { label: 'See the principles', href: '#story-principles' },
    secondaryAction: { label: 'Explore features', href: '/features' },
  },
  manifesto: {
    title: 'A short note.',
    copy: 'We did not set out to build another feed. Minimalist is organized around rooms and the people inside them—not an engagement-ranked social stream. Tools should get out of the way, and useful context should lighten the load rather than track people.',
  },
  timeline: [
    { id: 'noise', title: 'Everything competes', copy: 'Messages, tabs, pings, and tools arrive faster than people can turn them into shared understanding.' },
    { id: 'room', title: 'A room creates space', copy: 'One place gathers the right people, conversation, files, and tools. The chatter quiets and the group can focus.' },
    { id: 'context', title: 'Context becomes useful', copy: 'Search, catch-ups, tasks, docs, and events help the room carry important context into the next moment.' },
  ],
  principles: [
    {
      id: 'conversation-first',
      title: 'Calm by default',
      copy: 'The app should feel like opening a quiet room, not walking into a stadium.',
      featureIds: ['room-chat', 'private-messaging', 'calls-screen-sharing'],
    },
    {
      id: 'structure-when-needed',
      title: 'Structure when useful',
      copy: 'Tasks, docs, events, calls, and moderation should appear because a room needs them—not because a dashboard has space.',
      featureIds: ['catch-up', 'tasks', 'docs-whiteboards', 'events-calendar', 'roles-permissions'],
    },
    {
      id: 'context-that-lasts',
      title: 'Context that serves people',
      copy: 'Catch-ups, search, files, and shared work should help people move forward without pretending to remember everything for them.',
      featureIds: ['search', 'docs-whiteboards', 'room-ai'],
    },
  ],
  position: {
    title: 'Rooms, not an endless feed.',
    copy: 'Minimalist is not organized around an engagement-ranked social feed. It is organized around the people, conversation, and shared context inside each room.',
  },
  quote: 'The goal is not to do more in less time. It is to do what matters with a clearer mind.',
  close: {
    title: 'A calmer way to work starts here.',
    copy: 'Open one room for your people and let useful structure earn its place.',
    primaryAction: { label: 'Open the app', href: '/chat' },
    secondaryAction: { label: 'Use the web app', href: '/download' },
  },
});

export const privacyProviders = deepFreeze([
  {
    name: 'Firebase and Google infrastructure',
    purpose: 'Authentication, Realtime Database, file storage, hosting, push notifications, and App Check when configured.',
    data: 'Account identifiers, profile and room records, content, files, tokens, device metadata, and security signals needed for those services.',
  },
  {
    name: 'Stripe',
    purpose: 'Checkout, recurring subscriptions, invoices, payment-method management, and the customer billing portal.',
    data: 'Stripe receives payment and transaction information. Minimalist stores customer and subscription identifiers, plan, status, and renewal or cancellation timestamps rather than raw card numbers.',
  },
  {
    name: 'Google Calendar',
    purpose: 'Optional event import, creation, update, or deletion after the user connects Calendar access.',
    data: 'The active access token and relevant calendar event details. The token is held in application memory for the active connection; a connection marker can remain on the device.',
  },
  {
    name: 'Configured AI infrastructure',
    purpose: 'Optional room AI, Winston, profile assistance, and supported event extraction.',
    data: 'Prompts, limited relevant context, supported images, model preferences, request metadata, results, and usage information can be routed through the protected Ollama bridge, Cloudflare Workers AI, or Groq depending on configuration and capacity.',
  },
  {
    name: 'GitHub',
    purpose: 'Public issue reporting and supported bug-report workflows.',
    data: 'Issue content and technical details a user chooses to submit through a retained reporting flow.',
  },
]);

export const privacyPageContent = deepFreeze({
  slug: 'privacy',
  meta: {
    title: 'Minimalist | Privacy Policy',
    description: 'Read how Minimalist handles account, room, messaging, device, billing, integration, notification, and AI data, including choices and deletion limits.',
    lastUpdated: 'July 19, 2026',
    updatedAt: '2026-07-19',
  },
  shell: {
    kicker: 'Privacy',
    title: 'Privacy, in plain language.',
    copy: 'A current explanation of the data used for rooms, messaging, billing, integrations, notifications, and AI.',
  },
  hero: {
    label: 'Privacy Policy',
    title: 'Clear details about what Minimalist handles and why.',
    copy: 'This policy describes how Minimalist.chat handles personal information across its public website, web app, installed web experience, rooms, messaging, collaboration, billing, notifications, integrations, and AI features.',
  },
  summary: [
    'Minimalist stores account, profile, room, messaging, collaboration, device, notification, and billing records needed to provide the service.',
    'Content visibility depends on the surface, room membership, permissions, and the people you choose to share with.',
    'Configured providers can process authentication, cloud data, payments, calendar activity, notifications, issue reports, and AI requests.',
    'Deleting an account does not automatically cancel subscriptions or remove every copy of content already shared with other people.',
  ],
  providers: privacyProviders,
  sections: [
    {
      id: 'scope',
      title: 'Scope',
      copy: 'This policy applies to the Minimalist.chat public website, web app, installed web experience, account and room services, collaboration surfaces, notifications, billing connections, integrations, and optional AI features. A linked third-party service applies its own privacy terms to its independent processing.',
      items: [],
    },
    {
      id: 'account-profile',
      title: 'Account and profile information',
      copy: 'Minimalist processes information used to create, secure, present, and manage an account.',
      items: [
        'Email address, authentication provider, authentication identifiers, and sign-in or recovery state.',
        'An optional birthday collected during signup, plus display name, photo, username or short identifier, pronouns, biography, status, flair, theme color, and other profile choices.',
        'Skills, kudos, badges, XP, quests, streaks, and related participation or activity records where those features are used.',
      ],
    },
    {
      id: 'content-collaboration',
      title: 'Content and collaboration data',
      copy: 'Minimalist stores and processes the content people create or share so the intended room or conversation can work.',
      items: [
        'Room messages, private messages, inbox previews, reactions, links, images, uploads, and related timestamps or delivery state.',
        'Documents, whiteboards, tasks, polls, events, calendar records, call metadata, room settings, channels, roles, permissions, moderation records, and vault content.',
        'Content can remain visible to room members, message participants, or other authorized viewers according to the room type and permissions.',
      ],
    },
    {
      id: 'directory-visibility',
      title: 'Directory and visibility',
      copy: 'Selected profile information is copied into a user directory that signed-in users can access for people search, contacts, room membership, and profile cards. Public or discoverable community information can be visible more broadly than a private friends group.',
      items: [
        'Room creators and authorized managers can control membership, roles, permissions, and discoverability within the available settings.',
        'People who can view content may copy, download, forward, screenshot, or retain it outside Minimalist. Their independent actions are not controlled by account deletion.',
      ],
    },
    {
      id: 'device-technical',
      title: 'Device, browser, and technical data',
      copy: 'The app and its infrastructure process technical information needed to connect, secure, troubleshoot, and deliver the service.',
      items: [
        'Browser and device type, platform, truncated user-agent information where recorded, network and request metadata, timestamps, error details, and security signals.',
        'Firebase authentication state, local storage, cached app resources, offline data, theme and feature preferences, and saved account hints such as display name, email, photo, provider, and last-used time.',
        'Minimalist does not provide a separate response to the browser Do Not Track signal. Other legally recognized browser privacy signals are handled when and where applicable requirements are implemented.',
      ],
    },
    {
      id: 'notifications',
      title: 'Notifications and push tokens',
      copy: 'If notifications are enabled, Minimalist can store a Firebase Cloud Messaging token with its update time, platform, and limited device or user-agent information so a notification can reach that browser or device.',
      items: [
        'Notification permission can be changed in the browser or operating-system settings.',
        'Signing out or disabling notifications can remove or stop use of a stored token, subject to successful device and server cleanup.',
      ],
    },
    {
      id: 'billing',
      title: 'Billing and subscriptions',
      copy: 'Stripe hosts checkout and subscription management. Minimalist records the identifiers and status needed to grant, update, or remove paid account and room benefits.',
      items: [
        'Records can include the Stripe customer and subscription identifiers, price identifier, plan, status, cancellation-at-period-end flag, current period end, and update timestamps.',
        'Minimalist does not store raw payment-card numbers. Stripe processes payment details under its own privacy terms.',
        'Account subscriptions and room subscriptions are separate purchases and must be managed or cancelled separately.',
      ],
    },
    {
      id: 'calendar-integrations',
      title: 'Calendar and other integrations',
      copy: 'An optional Google Calendar connection requests the calendar.events permission so a user can import, create, update, or delete supported events. Other links or integrations process only the information needed for the action the user starts.',
      items: [
        'The Google Calendar access token is held in application memory for the active connection. A local connection marker can remain on the device until it is disconnected or cleared.',
        'Disconnecting an integration stops future app access but does not automatically remove information already created in the third-party service.',
      ],
    },
    {
      id: 'ai-processing',
      title: 'AI processing',
      copy: 'AI features are optional and can send a request through Minimalist\'s authenticated gateway to configured AI infrastructure. The provider and model can vary by configuration, availability, and capacity.',
      items: [
        'A room request can include the prompt and a bounded set of relevant recent messages, tasks, documents, and events from a room the account is allowed to access.',
        'Winston can process personal instructions, tone, saved memory or preferences, and the user display name. Supported profile assistance can process selected directory profile information.',
        'Supported calendar-photo extraction can send an image and prompt to the protected Ollama bridge or a configured Groq fallback.',
        'AI output can be inaccurate. People should review it and should not submit secrets or content they do not have permission to share.',
      ],
    },
    {
      id: 'ai-queue-audit',
      title: 'AI queue, usage, and audit records',
      copy: 'When AI capacity is busy, a request can be queued with a sanitized request payload and identifiers needed to authorize and process the job.',
      items: [
        'Queue data can include prompt text, room or channel identifiers, model profile, status, result, and error details. A capacity-wait job can remain until it is processed, cancelled, or fails.',
        'Terminal queue results and status are retained for up to 24 hours under the current queue implementation.',
        'Usage and audit records can include request ID, mode, room or channel, provider and model, duration, status, error category, and displayed AI usage cost. The current audit record does not store prompt or response bodies.',
      ],
    },
    {
      id: 'uses',
      title: 'How information is used',
      copy: 'Minimalist uses information to provide and secure accounts, rooms, messaging, collaboration, billing, notifications, integrations, support, and optional AI; enforce permissions and plan limits; prevent abuse; troubleshoot reliability; and comply with applicable obligations.',
      items: [
        'Where applicable, processing can be necessary to provide the service requested, based on consent for an optional connection, required for legal obligations, or used for legitimate security and service-operating interests.',
        'Minimalist can aggregate or de-identify information for reliability and product understanding when the result is not reasonably linked back to a person.',
      ],
    },
    {
      id: 'sharing',
      title: 'When information is disclosed',
      copy: 'Information can be disclosed to the people and rooms a user chooses, to authorized room managers, to configured service providers, to an integration the user starts, or when reasonably required for law, safety, security, fraud prevention, or enforcement.',
      items: [
        'Providers receive only the categories needed for the configured function, although their independent handling is also governed by their terms and privacy notices.',
        'Minimalist can preserve or disclose information in response to valid legal process or to protect users, the public, rights, and service integrity.',
      ],
    },
    {
      id: 'providers',
      title: 'Service providers',
      copy: 'Minimalist currently relies on Firebase and Google infrastructure, Stripe, optional Google Calendar access, configured AI infrastructure, and retained GitHub issue-reporting flows for the functions described below.',
      items: privacyProviders.map((provider) => (
        `${provider.name}: ${provider.purpose} ${provider.data}`
      )),
    },
    {
      id: 'retention',
      title: 'Retention',
      copy: 'Except where a specific period is stated, Minimalist retains information for as long as reasonably needed to provide the account, room, conversation, transaction, integration, security, or support function; comply with law; resolve disputes; and enforce agreements.',
      items: [
        'Retention depends on the record type, whether the account or room remains active, what other participants retain, provider backup and deletion cycles, security needs, and legal or billing obligations.',
        'Queued AI terminal status and results currently have the specific 24-hour period described above; this does not establish a 24-hour period for other AI, account, room, or billing records.',
      ],
    },
    {
      id: 'security-encryption',
      title: 'Security and encryption',
      copy: 'Minimalist uses authentication, authorization rules, provider safeguards, and other reasonable technical and organizational measures designed to protect information. No online service can guarantee absolute security.',
      items: [
        'Minimalist does not represent every room or private message as end-to-end encrypted.',
        'Optional private-message passphrase encryption protects only supported messages sent after both participants enable it with the same passphrase. It does not retroactively encrypt earlier messages or every related record.',
        'Users should protect credentials, device access, recovery methods, and any shared passphrase, and should avoid placing highly sensitive secrets in chat or AI prompts.',
      ],
    },
    {
      id: 'choices-rights',
      title: 'Choices and privacy rights',
      copy: 'People can edit available profile fields, manage room visibility and permissions where authorized, change browser notification permissions, disconnect supported integrations, clear local browser data, cancel subscriptions through the correct billing flow, and delete an account from Settings.',
      items: [
        'Depending on where a person lives, applicable law can provide rights to access, correct, delete, restrict, object to, or receive a copy of personal information, and to complain to a data-protection authority.',
        'Minimalist can require identity verification and can deny or limit a request where an exception applies, such as another person\'s rights, security, fraud prevention, billing, or legal retention.',
      ],
    },
    {
      id: 'account-deletion',
      title: 'Account deletion and subscription cancellation',
      copy: 'The current in-app account deletion flow removes the user profile, attempts to remove the directory entry, removes stored push tokens, and deletes the Firebase Authentication user after required confirmation and recent sign-in checks.',
      items: [
        'Deletion does not automatically remove room messages, private messages, files, room content, records retained by other participants, provider backups awaiting deletion, or records kept for billing, safety, security, or legal reasons.',
        'Deletion does not cancel Stripe subscriptions. Cancel each account or room subscription through its correct billing-management flow before deleting the account or room.',
        'A broader data request can be handled separately from the in-app deletion control and may require identity verification.',
      ],
    },
    {
      id: 'children',
      title: 'Children',
      copy: 'Minimalist is not designed as a child-directed service. Where a child cannot consent under applicable law, a parent, guardian, school, or other authorized organization must provide any permission and supervision required by law and the Terms.',
      items: [
        'The signup flow can ask for an optional birthday. A birthday field by itself is not a parental-consent system.',
        'If personal information appears to have been submitted without required permission, use the support channel currently displayed in the service so the situation can be reviewed.',
      ],
    },
    {
      id: 'international',
      title: 'International processing',
      copy: 'Minimalist and its providers can process information in countries other than the one where a user lives. Privacy laws and government-access rules can differ. Where required, appropriate contractual or other transfer safeguards should apply.',
      items: [],
    },
    {
      id: 'changes-requests',
      title: 'Policy changes and requests',
      copy: 'This policy can be updated as the product, providers, or legal requirements change. The date at the top identifies the current version, and material changes will be communicated where applicable law requires it.',
      items: [
        'Use the support channel currently displayed in the service to ask a privacy question or make a request.',
        'The service can verify identity and request enough information to locate the relevant account, room, transaction, or integration records.',
      ],
    },
  ],
});

export const publicMarketingPages = deepFreeze({
  home: homePageContent,
  features: featuresPageContent,
  download: downloadPageContent,
  story: storyPageContent,
  privacy: privacyPageContent,
});
