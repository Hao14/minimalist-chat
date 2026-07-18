export const ROOM_BILLING_PLANS = Object.freeze({
  base: Object.freeze({
    id: 'base',
    label: 'Base room',
    priceLabel: '$0',
    recurringPriceLabel: '$0',
    monthlyPrice: 0,
    maxUsers: 0,
    comparison: Object.freeze({
      perFile: 'Uses account limit',
      daily: 'Uses account limit',
      video: 'Uses account plan',
      screenShare: 'Uses account plan',
      analytics: 'Uses account plan',
      selectedUsers: '—',
    }),
  }),
  advanced: Object.freeze({
    id: 'advanced',
    label: 'Advanced Room',
    priceLabel: '$11.99/mo',
    recurringPriceLabel: '$11.99 every month',
    monthlyPrice: 11.99,
    maxUsers: 20,
    comparison: Object.freeze({
      perFile: '2 GB',
      daily: '4 GB/day',
      video: 'Included',
      screenShare: '1080p · 60 fps',
      analytics: 'Included',
      selectedUsers: 'Up to 20',
    }),
  }),
  pro: Object.freeze({
    id: 'pro',
    label: 'Pro Room',
    priceLabel: '$19.99/mo',
    recurringPriceLabel: '$19.99 every month',
    monthlyPrice: 19.99,
    maxUsers: 50,
    comparison: Object.freeze({
      perFile: '3 GB',
      daily: '9 GB/day',
      video: 'Included',
      screenShare: 'System limit',
      analytics: 'Included',
      selectedUsers: 'Up to 50',
    }),
  }),
});

export const ROOM_BILLING_PLAN_IDS = Object.freeze(Object.keys(ROOM_BILLING_PLANS));

export function roomBillingPlan(value) {
  return ROOM_BILLING_PLANS[value] || ROOM_BILLING_PLANS.base;
}
