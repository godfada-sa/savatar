export const DECART_CREDITS_PER_SECOND = 2;
export const decartCreditsToSeconds = (credits: number) => Math.floor(credits / DECART_CREDITS_PER_SECOND);

const pack = (id: string, name: string, credits: number, priceGHS: number, priceLabel: string, timeLabel: string) => ({
  id, name, credits, seconds: decartCreditsToSeconds(credits), priceGHS, priceLabel, timeLabel,
});

export const CREDIT_PACKS = [
  pack("starter", "Starter", 300, 139, "GH 139", "~2.5 min"),
  pack("basic", "Basic", 1000, 439, "GH 439", "~8 min"),
  pack("pro", "Pro", 2000, 839, "GH 839", "~17 min"),
  pack("ultimate", "Ultimate", 5000, 2189, "GH 2,189", "~42 min"),
  pack("creator", "Creator", 12000, 5039, "GH 5,039", "~100 min"),
] as const;

export function getCreditPack(id: string) {
  return CREDIT_PACKS.find((pack) => pack.id === id);
}
