export const CREDIT_PACKS = [
  { id: "starter", name: "Starter", seconds: 300, priceGHS: 250, priceLabel: "GH 250", timeLabel: "5 min" },
  { id: "basic", name: "Basic", seconds: 900, priceGHS: 650, priceLabel: "GH 650", timeLabel: "15 min" },
  { id: "pro", name: "Pro", seconds: 1800, priceGHS: 1100, priceLabel: "GH 1,100", timeLabel: "30 min" },
  { id: "creator", name: "Creator", seconds: 3600, priceGHS: 1800, priceLabel: "GH 1,800", timeLabel: "1 hour" },
  { id: "unlimited", name: "Unlimited", seconds: 18000, priceGHS: 7500, priceLabel: "GH 7,500", timeLabel: "5 hours" },
] as const;

export function getCreditPack(id: string) {
  return CREDIT_PACKS.find((pack) => pack.id === id);
}
