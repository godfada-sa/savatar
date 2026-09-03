export const DECART_CREDITS_PER_SECOND = 2;
export const DECART_COST_PER_SEC = 0.02; // USD — Decart API cost per second of AI streaming
export const GHS_PER_USD = 15;
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

/** Admin view of packs at Decart's raw API cost (no markup). */
export const DECART_COST_PACKS = CREDIT_PACKS.map((p) => ({
  id: p.id,
  name: p.name,
  seconds: p.seconds,
  costGHS: +(p.seconds * DECART_COST_PER_SEC * GHS_PER_USD).toFixed(0),
  timeLabel: p.timeLabel,
}));

export function getCreditPack(id: string) {
  return CREDIT_PACKS.find((pack) => pack.id === id);
}
