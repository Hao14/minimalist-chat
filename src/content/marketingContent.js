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

export const faqItems = Object.freeze([
  Object.freeze({
    topic: 'Basics',
    question: 'What is Minimalist Chat?',
    answer: 'Minimalist Chat is a real-time messaging app built around rooms. Every room combines conversation, collaborative documents, a shared whiteboard, tasks, events, and AI tools.',
  }),
  Object.freeze({
    topic: 'Basics',
    question: 'How do I create or join a room?',
    answer: 'Open the room sidebar and use Create to start a room, or Join to enter with an invite link or code.',
  }),
  Object.freeze({
    topic: 'Features',
    question: 'What are Docs and the Whiteboard?',
    answer: 'Collaborative Docs update live for everyone, while the Shared Whiteboard provides draggable sticky notes for brainstorming.',
  }),
  Object.freeze({
    topic: 'Plans',
    question: 'What do the Advanced and Pro tiers include?',
    answer: 'Base includes 10 MB files, 500 MB of uploads per day, up to 3 created rooms, and 720p/30fps screen sharing. Advanced raises those limits to 700 MB files, 1.5 GB per day, 5 created rooms, and 1080p/60fps screen sharing, and adds an Advanced badge. Pro raises them to 3 GB files and 9 GB per day, removes the room-creation limit, and adds room analytics, video calls, system-limit screen sharing, Winston as your Personal AI Agent, and a Pro badge. Optional room subscriptions are separate from these account plans.',
  }),
  Object.freeze({
    topic: 'People',
    question: 'How do I add friends and send private messages?',
    answer: 'Open Contacts to search people, send requests, and start private conversations.',
  }),
  Object.freeze({
    topic: 'Privacy',
    question: 'Is my data private?',
    answer: 'Account and message data are handled according to the Privacy Policy. You can delete your account from Settings.',
  }),
]);
