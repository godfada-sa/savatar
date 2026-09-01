export const CREDIT_PACKS = [
  { id: "starter", name: "Starter", seconds: 150, credits: 300, priceGHS: 139, priceLabel: "GH 139", timeLabel: "~2.5 min" },
  { id: "basic", name: "Basic", seconds: 500, credits: 1000, priceGHS: 439, priceLabel: "GH 439", timeLabel: "~8 min" },
  { id: "pro", name: "Pro", seconds: 1000, credits: 2000, priceGHS: 839, priceLabel: "GH 839", timeLabel: "~17 min" },
  { id: "ultimate", name: "Ultimate", seconds: 2500, credits: 5000, priceGHS: 2189, priceLabel: "GH 2,189", timeLabel: "~42 min" },
  { id: "creator", name: "Creator", seconds: 6000, credits: 12000, priceGHS: 5039, priceLabel: "GH 5,039", timeLabel: "~100 min" },
] as const;

export function getCreditPack(id: string) {
  return CREDIT_PACKS.find((pack) => pack.id === id);
}
