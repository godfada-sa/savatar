export const DECART_CREDITS_PER_SECOND = 2;
/** Legacy Decart direct API cost — reference only, no longer the active provider. */
export const DECART_COST_PER_SEC = 0.02; // USD
/** fal.ai is the active realtime provider (lucy-2.5 realtime). */
export const FAL_COST_PER_SEC = 0.04; // USD
/** COGS basis for pricing and the admin economics views. */
export const PROVIDER_COST_PER_SEC = FAL_COST_PER_SEC;
export const GHS_PER_USD = 15;
export const decartCreditsToSeconds = (credits: number) => Math.floor(credits / DECART_CREDITS_PER_SECOND);

const pack = (id: string, name: string, credits: number, priceGHS: number, priceLabel: string, timeLabel: string) => ({
  id, name, credits, seconds: decartCreditsToSeconds(credits), priceGHS, priceLabel, timeLabel,
});

/**
 * 2/5/10/15/20-minute packs priced on fal's COGS (GH 0.60/sec at GH15/$) with
 * a gentle per-second volume discount (~GH 1.33/s down to ~GH 1.12/s). Every
 * pack stays profitable even at the 25% promo discount (SAF7UL26): worst case
 * 2-min at GH 119.25 vs GH 72 COGS.
 */
export const CREDIT_PACKS = [
  pack("starter", "Starter", 240, 159, "GH 159", "~2 min"),
  pack("basic", "Basic", 600, 359, "GH 359", "~5 min"),
  pack("pro", "Pro", 1200, 689, "GH 689", "~10 min"),
  pack("ultimate", "Ultimate", 1800, 1019, "GH 1,019", "~15 min"),
  pack("creator", "Creator", 2400, 1339, "GH 1,339", "~20 min"),
] as const;

/** Admin view of packs at the active provider's raw API cost (no markup). */
export const PROVIDER_COST_PACKS = CREDIT_PACKS.map((p) => ({
  id: p.id,
  name: p.name,
  seconds: p.seconds,
  costGHS: +(p.seconds * PROVIDER_COST_PER_SEC * GHS_PER_USD).toFixed(0),
  timeLabel: p.timeLabel,
}));

export function getCreditPack(id: string) {
  return CREDIT_PACKS.find((pack) => pack.id === id);
}
