function freezePlan(plan) {
  return Object.freeze({
    ...plan,
    features: Object.freeze([...plan.features]),
  });
}

export const accountPlans = Object.freeze([
  freezePlan({
    id: 'base',
    name: 'Base',
    price: '0',
    displayPrice: '$0',
    billingPeriod: null,
    intent: 'A free account for getting started',
    scope: 'One signed-in account across rooms',
    features: [
      'Create up to 3 rooms',
      '10 MB per file',
      '500 MB of uploads per day',
      'Screen sharing up to 720p/30fps',
    ],
  }),
  freezePlan({
    id: 'advanced',
    name: 'Advanced',
    price: '1.99',
    displayPrice: '$1.99/month',
    billingPeriod: 'P1M',
    intent: 'Higher limits for one active account',
    scope: 'One signed-in account across rooms',
    features: [
      'Create up to 5 rooms',
      '700 MB per file',
      '1.5 GB of uploads per day',
      'Screen sharing up to 1080p/60fps',
      'Advanced account badge',
    ],
  }),
  freezePlan({
    id: 'pro',
    name: 'Pro',
    price: '7.99',
    displayPrice: '$7.99/month',
    billingPeriod: 'P1M',
    intent: 'Full account benefits for a power user',
    scope: 'One signed-in account across rooms',
    features: [
      'Unlimited room creation',
      '3 GB per file',
      '9 GB of uploads per day',
      'Screen sharing at the system limit',
      'Video calls and room analytics',
      'Winston Personal AI Agent',
      'Pro account badge',
    ],
  }),
]);

export const roomSubscriptionPlans = Object.freeze([
  freezePlan({
    id: 'base-room',
    name: 'Base Room',
    price: '0',
    displayPrice: '$0',
    billingPeriod: null,
    selectedMemberLimit: 0,
    intent: 'No recurring room charge',
    scope: 'One private room using each member\'s account benefits',
    features: [
      'Uses each member\'s account upload limits',
      'Uses each member\'s account call and screen-sharing benefits',
      'No paid room-benefit assignments',
    ],
  }),
  freezePlan({
    id: 'advanced-room',
    name: 'Advanced Room',
    price: '11.99',
    displayPrice: '$11.99/month',
    billingPeriod: 'P1M',
    selectedMemberLimit: 20,
    intent: 'One private room · up to 20 selected members',
    scope: 'A separate subscription managed by the room creator',
    features: [
      'Benefits for up to 20 selected room members',
      'At least 2 GB per file in this room',
      'At least 4 GB of uploads per day in this room',
      'Video calls in this room',
      'Screen sharing up to 1080p/60fps',
      'Room analytics',
    ],
  }),
  freezePlan({
    id: 'pro-room',
    name: 'Pro Room',
    price: '19.99',
    displayPrice: '$19.99/month',
    billingPeriod: 'P1M',
    selectedMemberLimit: 50,
    intent: 'One private room · up to 50 selected members',
    scope: 'A separate subscription managed by the room creator',
    features: [
      'Benefits for up to 50 selected room members',
      'At least 3 GB per file in this room',
      'At least 9 GB of uploads per day in this room',
      'Video calls in this room',
      'Screen sharing at the system limit',
      'Room analytics',
    ],
  }),
]);

export const pricingPageMeta = Object.freeze({
  title: 'Pricing — Account plans and room subscriptions | Minimalist.chat',
  description: 'Compare Minimalist account plans and optional room subscriptions, with separate prices, limits, and benefits for each billing scope.',
});

function planWithId(plans, id) {
  return plans.find((plan) => plan.id === id);
}

const advancedAccountPlan = planWithId(accountPlans, 'advanced');
const proAccountPlan = planWithId(accountPlans, 'pro');
const advancedRoomPlan = planWithId(roomSubscriptionPlans, 'advanced-room');
const proRoomPlan = planWithId(roomSubscriptionPlans, 'pro-room');

export const faqItems = Object.freeze([
  Object.freeze({
    id: 'what-is-minimalist',
    topic: 'Basics',
    question: 'What is Minimalist?',
    answer: 'Minimalist is a room-centered communication app for calmer, more organized group chat. A room can bring conversation, catch-up digests, decisions, tasks, documents, whiteboards, events, calls, search, and AI-assisted workflows into one place.',
  }),
  Object.freeze({
    id: 'create-or-join-room',
    topic: 'Basics',
    question: 'How do I create or join a room?',
    answer: 'Open the room sidebar and choose New room to create a friends group or discoverable community. Choose Join to enter another room with its invite link or code.',
  }),
  Object.freeze({
    id: 'room-tools',
    topic: 'Rooms',
    question: 'What can my group do inside a room?',
    answer: 'Start with chat, then use the tools your group needs: files, polls, reminders, Docs, Whiteboard, tasks, events, calls, screen sharing, search, moderation, and AI. Access can depend on the room, your permissions, your plan, and your device.',
  }),
  Object.freeze({
    id: 'room-access',
    topic: 'Rooms',
    question: 'Who controls room access and permissions?',
    answer: 'Room creators and authorized managers control membership, roles, feature permissions, and whether a community is discoverable. Private rooms are limited to their members; public or discoverable spaces can be visible more broadly. Platform safety rules still apply in every room.',
  }),
  Object.freeze({
    id: 'account-vs-room-plans',
    topic: 'Plans',
    question: 'How are account plans different from room subscriptions?',
    answer: 'An account plan follows one signed-in person across rooms. An optional room subscription is a separate recurring purchase for one private room, is managed by that room\'s creator, and assigns room benefits to selected members. A room benefit never reduces a stronger benefit from someone\'s account plan.',
  }),
  Object.freeze({
    id: 'paid-plan-costs',
    topic: 'Plans',
    question: 'What do the paid plans cost?',
    answer: `Base is free. ${advancedAccountPlan.name} accounts are ${advancedAccountPlan.displayPrice}, and ${proAccountPlan.name} accounts are ${proAccountPlan.displayPrice}. The separate ${advancedRoomPlan.name} subscription is ${advancedRoomPlan.displayPrice} for up to ${advancedRoomPlan.selectedMemberLimit} selected members, while ${proRoomPlan.name} is ${proRoomPlan.displayPrice} for up to ${proRoomPlan.selectedMemberLimit}. Stripe Checkout shows the current price and renewal terms before purchase.`,
  }),
  Object.freeze({
    id: 'manage-subscription',
    topic: 'Plans',
    question: 'How do I manage or cancel a subscription?',
    answer: 'Open Settings, choose Billing, and use Manage subscription for an account plan. A room creator manages a room subscription from that room\'s Billing panel. Stripe provides invoices, payment-method updates, plan changes, and online cancellation. Cancellation is scheduled for the end of the current billing period; deleting an account, leaving a room, or uninstalling the app is not a substitute for cancelling.',
  }),
  Object.freeze({
    id: 'ai-and-winston',
    topic: 'AI',
    question: 'What can the AI tools and Winston do?',
    answer: 'Room AI can help summarize conversation, extract tasks, analyze patterns, and prepare event details. Pro accounts also include Winston, a personal AI agent. AI uses Bananas or other displayed usage limits, may be unavailable while capacity recovers, and can produce incorrect output, so review important results before using them.',
  }),
  Object.freeze({
    id: 'ai-room-information',
    topic: 'AI',
    question: 'How does AI use room information?',
    answer: 'When you make an AI request, Minimalist\'s authenticated gateway can process your prompt with a limited set of relevant messages, tasks, documents, and events from a room you can access. Configured AI providers may process that request. Do not submit secrets or content you are not allowed to share, and do not rely on AI as professional advice.',
  }),
  Object.freeze({
    id: 'friends-and-private-messages',
    topic: 'People',
    question: 'How do I add friends and send private messages?',
    answer: 'Open Contacts to search for people, send or accept requests, and start a private conversation. Recent private-message history remains available in the PM inbox, and supported conversations can also start a direct voice call.',
  }),
  Object.freeze({
    id: 'content-visibility',
    topic: 'Privacy',
    question: 'Who can see my room and private-message content?',
    answer: 'Private-room content is restricted by membership and permission rules, and private messages are limited to their participants. Minimalist still uses cloud services to store and process content, and does not represent every room or private message as end-to-end encrypted. Optional PM encryption protects only messages sent after both participants enable it with the same passphrase.',
  }),
  Object.freeze({
    id: 'delete-account',
    topic: 'Privacy',
    question: 'What happens when I delete my account?',
    answer: 'Settings lets you permanently remove your profile and authentication account after a typed confirmation, and a recent sign-in may be required. Deletion does not automatically cancel paid subscriptions or guarantee removal of content already shared in rooms, retained by other participants, or kept for billing, security, or legal reasons. Cancel subscriptions first and contact support for a data request.',
  }),
]);

function freezeContentSection(section) {
  return Object.freeze({
    ...section,
    items: section.items ? Object.freeze([...section.items]) : undefined,
  });
}

export const termsPageMeta = Object.freeze({
  title: 'Minimalist | Terms of Service',
  description: 'Read the current Minimalist terms for accounts, rooms, content, AI, subscriptions, cancellation, safety, and service use.',
  lastUpdated: 'July 18, 2026',
  updatedAt: '2026-07-18',
});

export const termsSections = Object.freeze([
  freezeContentSection({
    id: 'agreement-eligibility',
    title: 'Agreement and eligibility',
    copy: 'These Terms govern your access to Minimalist.chat, including its website, installed experiences, apps, rooms, messaging, collaboration tools, billing features, and AI features. By creating an account or using the service, you agree to these Terms and should also review the Privacy Policy.',
    items: [
      'You may use Minimalist only if you can legally enter this agreement where you live. If local law requires a parent, guardian, school, or organization to approve your use, that approval and supervision are required.',
      'If you use Minimalist for an organization or manage a room for other people, you confirm that you are authorized to act for that organization or room.',
      'If you do not agree to these Terms, do not create an account or continue using the service.',
    ],
  }),
  freezeContentSection({
    id: 'accounts-security',
    title: 'Accounts and security',
    copy: 'Your account represents you across rooms. Keep its sign-in methods secure and provide information that is accurate enough for authentication, account recovery, safety, and billing.',
    items: [
      'Do not share credentials, authentication links, verification codes, or access tokens, and do not use another person\'s account without permission.',
      'You are responsible for activity performed through your account unless it resulted from unauthorized access that you could not reasonably prevent.',
      'Tell support promptly if you believe your account or a room you manage has been compromised.',
    ],
  }),
  freezeContentSection({
    id: 'rooms-messaging',
    title: 'Rooms, messaging, and permissions',
    copy: 'Minimalist includes public or discoverable spaces, private rooms, contacts, private messages, files, calls, and collaborative tools. Visibility depends on the surface, membership, room settings, and permissions.',
    items: [
      'Room creators and authorized managers can invite or remove members, assign roles, change feature permissions, and moderate their spaces, but they cannot override these Terms.',
      'You choose the people and rooms you share content with. People who can access content may copy, download, forward, or otherwise retain it, so use care with sensitive information.',
      'Calls and messaging are communication features, not emergency services, and must not be used as the only way to reach emergency assistance.',
    ],
  }),
  freezeContentSection({
    id: 'your-content',
    title: 'Your content and responsibilities',
    copy: 'You keep ownership of content you submit. You give Minimalist a non-exclusive, worldwide, royalty-free license to host, store, reproduce, transmit, display, format, and otherwise process that content only as needed to operate, secure, improve, and provide the service to you and the people you choose.',
    items: [
      'You must have the rights and permissions needed to upload or share your content, including files, images, recordings, links, profile details, and messages.',
      'You are responsible for the accuracy, legality, and consequences of your content and for keeping your own copies of anything you cannot afford to lose.',
      'Removing content or deleting an account may not immediately remove copies already shared, downloaded, cached, backed up, or retained where law, safety, fraud prevention, or billing requires it.',
    ],
  }),
  freezeContentSection({
    id: 'acceptable-use',
    title: 'Acceptable use and safety',
    copy: 'Use Minimalist in a lawful, respectful way. You may not use the service to:',
    items: [
      'Harass, threaten, exploit, deceive, impersonate, stalk, or expose another person\'s private information without permission.',
      'Create, upload, request, or distribute illegal content; malware; spam; sexual exploitation material; or content that violates another person\'s intellectual-property, privacy, or publicity rights.',
      'Bypass billing, authentication, membership, moderation, usage limits, or security controls; probe systems without authorization; scrape at abusive scale; or interfere with service reliability.',
      'Use automation or AI to cause harm, make prohibited high-impact decisions, mislead people about synthetic content, or violate applicable law.',
    ],
  }),
  freezeContentSection({
    id: 'moderation-enforcement',
    title: 'Moderation and enforcement',
    copy: 'Room managers can moderate their rooms, and Minimalist can investigate reports or protect the wider service. We do not promise to review every message before it appears.',
    items: [
      'We may limit reach, remove content, mute or remove a member, suspend features, restrict an account, or terminate access when reasonably necessary for safety, security, legal compliance, nonpayment, or a material violation of these Terms.',
      'We may preserve and disclose information when reasonably necessary to comply with law, respond to valid legal process, investigate abuse or fraud, or protect users and the service.',
      'Where appropriate and legally required, we will provide notice or a way to ask about an enforcement action.',
    ],
  }),
  freezeContentSection({
    id: 'ai-features',
    title: 'AI features and Bananas',
    copy: 'Minimalist offers optional AI-assisted features, including room workflows and Winston. AI requests can process your prompt together with a limited amount of relevant content that your account is allowed to access and can be routed to configured AI infrastructure or providers.',
    items: [
      'AI output can be incomplete, inaccurate, outdated, offensive, or similar to output provided to someone else. Review it before acting, publishing, or sharing it.',
      'Do not use AI output as a substitute for medical, legal, financial, safety, employment, education-admission, housing, credit, or other qualified professional judgment.',
      'AI access may depend on your plan, Bananas, rate limits, provider capacity, safety controls, and feature availability. Usage credits have no cash value and may expire or refill on the schedule shown in the app.',
      'You remain responsible for your prompts, your right to use included room content, and how you use AI output.',
    ],
  }),
  freezeContentSection({
    id: 'subscriptions-billing',
    title: 'Plans, subscriptions, and billing',
    copy: 'Minimalist offers free and paid account plans, plus optional paid subscriptions for individual private rooms. Account subscriptions and room subscriptions are separate purchases with separate management and cancellation flows.',
    items: [
      'Stripe hosts checkout and billing management. The current price, billing frequency, plan scope, renewal terms, discounts, and any taxes or prorations are shown during the relevant Stripe transaction.',
      'Paid subscriptions renew automatically each month until cancelled. By subscribing, you authorize recurring charges to your selected payment method for the amount shown at checkout.',
      'A room subscription is purchased and managed by that room\'s creator and applies only to eligible selected members of that room. Leaving or deleting a room does not by itself cancel its subscription.',
      'Plan changes can create prorated charges or credits. Failed or reversed payments can delay, limit, or end paid benefits.',
      'If a price or other material renewal term changes, we will provide the notice and cancellation information required by applicable law before the change takes effect.',
    ],
  }),
  freezeContentSection({
    id: 'cancellation-refunds',
    title: 'Cancellation, refunds, and account deletion',
    copy: 'You can manage an account subscription from Settings → Billing and a room subscription from that room\'s Billing panel. The Stripe portal is configured for online cancellation at the end of the current billing period.',
    items: [
      'Cancel each subscription separately. Deleting your account, deleting or leaving a room, signing out, or uninstalling the app does not cancel a Stripe subscription.',
      'A cancellation normally keeps paid benefits active until the current billing period ends, as confirmed in Stripe. You will not be charged for a later period after cancellation takes effect.',
      'Cancellation does not reverse charges already completed. Refunds, billing corrections, credits, and prorations are evaluated under applicable law and the purchase terms shown at checkout; these Terms do not promise a specific refund window.',
      'Before deleting an account, cancel active account and room subscriptions and retain any invoices or content you need. Account deletion may require a recent sign-in and does not guarantee removal of content already shared or records lawfully retained.',
    ],
  }),
  freezeContentSection({
    id: 'third-party-services',
    title: 'Third-party services and links',
    copy: 'Minimalist relies on service providers for authentication, cloud data, file storage, billing, notifications, AI processing, links, and integrations. Those services can have their own terms and privacy practices.',
    items: [
      'Stripe processes payment details; Minimalist stores billing identifiers and subscription status, not raw payment-card numbers.',
      'External links, calendar exports, integrations, and third-party content are provided for convenience. Minimalist is not responsible for a third party\'s content, availability, or independent actions.',
      'A third-party outage or policy change can temporarily limit a related Minimalist feature.',
    ],
  }),
  freezeContentSection({
    id: 'service-availability',
    title: 'Service changes and availability',
    copy: 'We work to keep Minimalist reliable, but no online service is uninterrupted. Features can change as the product, security requirements, provider capacity, and laws evolve.',
    items: [
      'We may add, change, limit, pause, or retire a feature or plan benefit. We will give reasonable notice when a change materially affects a paid subscription and applicable law requires notice.',
      'You should maintain exports or backups of important content. We do not guarantee that every device, integration, model, file type, or third-party service will remain supported.',
      'Beta, experimental, preview, and AI features may be changed or withdrawn with less notice and should not be used as the sole system for critical work.',
    ],
  }),
  freezeContentSection({
    id: 'disclaimers-liability',
    title: 'Disclaimers and limits of liability',
    copy: 'To the fullest extent allowed by applicable law, Minimalist is provided “as is” and “as available,” without warranties that the service will always be secure, error-free, uninterrupted, or suitable for a particular purpose.',
    items: [
      'To the fullest extent allowed by law, Minimalist is not responsible for indirect, incidental, special, consequential, or punitive losses, lost profits, lost opportunities, or lost data resulting from use of or inability to use the service.',
      'Nothing in these Terms excludes warranties, remedies, liabilities, or consumer rights that applicable law does not allow us to exclude or limit.',
      'You may have additional rights based on where you live. These Terms do not replace those non-waivable rights.',
    ],
  }),
  freezeContentSection({
    id: 'changes-contact',
    title: 'Changes to these Terms and contact',
    copy: 'We may update these Terms to reflect product, legal, safety, or business changes. The date at the top shows the latest version. When required, we will provide advance notice of a material change.',
    items: [
      'If you continue using Minimalist after updated Terms take effect, you agree to the updated Terms. If you do not agree, stop using the service and cancel active subscriptions before they renew.',
      'Questions about these Terms, billing, account deletion, or safety can be sent to support@minimalist.com. Technical bugs can also be reported through the public issue tracker.',
    ],
  }),
]);
