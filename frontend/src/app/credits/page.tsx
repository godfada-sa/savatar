"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { CREDIT_PACKS } from "@/lib/credit-packs";
import DashboardLayout from "@/components/DashboardLayout";

interface PromoResult {
  success: boolean;
  discountPercent: number;
  bonusSeconds: number;
  message: string;
}

function PromoCodeField({
  promoCode,
  onPromoCodeChange,
  promoResult,
  promoError,
  promoLoading,
  onApply,
  onRemove,
}: {
  promoCode: string;
  onPromoCodeChange: (value: string) => void;
  promoResult: PromoResult | null;
  promoError: string;
  promoLoading: boolean;
  onApply: () => void;
  onRemove: () => void;
}) {
  return (
    <div>
      <label className="block text-xs text-stone-500 mb-1.5">Promo Code (optional)</label>
      <div className="flex gap-2">
        <input
          type="text"
          value={promoCode}
          onChange={(e) => onPromoCodeChange(e.target.value.toUpperCase())}
          placeholder="Enter promo code"
          disabled={!!promoResult}
          className="flex-1 px-3 py-2 bg-white border border-stone-300 rounded-lg text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:border-[#ff4a1d] transition font-mono uppercase disabled:opacity-50"
        />
        {promoResult ? (
          <button
            onClick={onRemove}
            className="px-3 py-2 bg-white border border-red-300 text-red-600 text-xs font-medium rounded-lg transition hover:bg-red-50"
          >
            Remove
          </button>
        ) : (
          <button
            onClick={onApply}
            disabled={!promoCode.trim() || promoLoading}
            className="px-3 py-2 bg-white border border-stone-300 text-stone-600 text-xs font-medium rounded-lg transition hover:bg-stone-50 disabled:opacity-50"
          >
            {promoLoading ? "..." : "Apply"}
          </button>
        )}
      </div>

      {promoResult && (
        <div className="mt-2 p-2 rounded-lg bg-emerald-50 border border-emerald-200">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-xs text-emerald-700 font-medium">{promoResult.message}</span>
          </div>
        </div>
      )}

      {promoError && (
        <div className="mt-2 p-2 rounded-lg bg-red-50 border border-red-200">
          <span className="text-xs text-red-600">{promoError}</span>
        </div>
      )}
    </div>
  );
}

function CreditsContent() {
  const { user, userData } = useAuth();
  // Basic is pre-selected (like the landing page pre-features it) so the
  // "Most popular" treatment is visible before the user clicks anything.
  const [selectedPack, setSelectedPack] = useState<string>("basic");
  const [processing, setProcessing] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  // Promo code state
  const [promoCode, setPromoCode] = useState("");
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoResult, setPromoResult] = useState<PromoResult | null>(null);
  const [promoError, setPromoError] = useState("");

  const balanceMinutes = ((userData?.wallet?.balanceSeconds || 0) / 60).toFixed(1);
  const searchParams = useSearchParams();
  const paymentStatus = searchParams.get("payment");
  const paymentRef = searchParams.get("ref");

  useEffect(() => {
    if (paymentStatus === "success" && paymentRef) {
      alert(`Payment verified. Your credits have been added. Reference: ${paymentRef}`);
    } else if (paymentStatus === "pending" && paymentRef) {
      alert(`Payment is still being confirmed. Reference: ${paymentRef}`);
    } else if (paymentStatus === "failed") {
      alert("The payment could not be verified. You have not been credited.");
    }
  }, [paymentStatus, paymentRef]);

  const selectPack = (packId: string) => {
    setSelectedPack(packId);
    setPromoResult(null);
    setPromoError("");
    setPromoCode("");
  };

  // "Get {pack}" on a card: select the pack and open the quick checkout
  // dialog (promo code + Paystack), no scrolling needed.
  const handleGet = (packId: string) => {
    selectPack(packId);
    setCheckoutOpen(true);
  };

  const closeCheckout = () => {
    if (processing) return; // don't close mid-redirect
    setCheckoutOpen(false);
  };

  const validatePromo = async () => {
    if (!promoCode.trim() || !selectedPack || !user) return;
    setPromoLoading(true);
    setPromoError("");
    setPromoResult(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/promo/validate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ promoCode: promoCode.trim(), packId: selectedPack }),
      });
      const data = await res.json();
      if (data.success) {
        setPromoResult(data);
      } else {
        setPromoError(data.error || "Invalid promo code");
      }
    } catch {
      setPromoError("Failed to validate promo code");
    }
    setPromoLoading(false);
  };

  const getFinalPrice = () => {
    const pack = CREDIT_PACKS.find((p) => p.id === selectedPack);
    if (!pack) return 0;
    if (promoResult?.discountPercent) {
      const discounted = pack.priceGHS * (1 - promoResult.discountPercent / 100);
      return Math.max(discounted, 1);
    }
    return pack.priceGHS;
  };

  const getTotalSeconds = () => {
    const pack = CREDIT_PACKS.find((p) => p.id === selectedPack);
    if (!pack) return 0;
    return pack.seconds + (promoResult?.bonusSeconds || 0);
  };

  const handlePurchase = async () => {
    if (!selectedPack || !user) return;
    setProcessing(true);
    try {
      const idToken = await user.getIdToken();
      const response = await fetch("/api/payment/initiate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          packId: selectedPack,
          promoCode: promoResult ? promoCode.toUpperCase().trim() : "",
        }),
      });
      const data = await response.json();
      if (data.success && data.authorizationUrl) {
        window.location.href = data.authorizationUrl;
      } else {
        alert(data.error || "Payment failed. Please try again.");
      }
    } catch {
      alert("Payment failed. Please try again.");
    } finally {
      setProcessing(false);
    }
  };

  const selectedPackData = CREDIT_PACKS.find((p) => p.id === selectedPack);
  const finalPrice = getFinalPrice();
  const totalSeconds = getTotalSeconds();

  return (
    <DashboardLayout>
      <div className="p-3 sm:p-6">
        {/* Credits & Billing Header */}
        <div className="p-5 sm:p-6 rounded-xl bg-[#ff4a1d]/6 border border-[#ff4a1d]/15 mb-5 flex flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-[10px] text-[#e84314] font-semibold uppercase tracking-wider mb-1">Credits & Billing</div>
            <h1 className="text-xl font-bold text-stone-900">Buy Credits, Unlock Possibilities</h1>
            <p className="text-xs text-stone-500 mt-1 max-w-lg">
              Choose a pack and pay securely by mobile money or card through Paystack. Credits are added after verification.
            </p>
          </div>
          <div className="w-full text-left px-4 py-3 rounded-xl bg-white border border-stone-200 sm:w-auto sm:px-6 sm:text-center">
            <div className="text-[10px] text-stone-500 uppercase tracking-wider">Available Balance</div>
            <div className="text-2xl font-bold text-[#e84314]">{balanceMinutes}</div>
            <div className="text-[10px] text-stone-500">minutes</div>
          </div>
        </div>

        {/* Credit Packs — same editorial cards as the landing pricing section.
            The selected pack takes the landing's "featured" treatment (dark
            stone card, coral accents, solid coral action). */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 mb-6 2xl:grid-cols-5">
          {CREDIT_PACKS.map((pack) => {
            // Basic is permanently the featured (dark) card — like the landing
            // page. Selection is shown with a coral ring instead of moving the
            // dark color around.
            const featured = pack.id === "basic";
            const selected = selectedPack === pack.id;
            return (
              <button
                key={pack.id}
                onClick={() => selectPack(pack.id)}
                aria-pressed={selected}
                className={`flex min-h-[320px] flex-col rounded-lg border p-6 text-left transition ${
                  featured ? "bg-stone-900 text-white shadow-[0_24px_50px_-24px_rgba(28,25,23,0.5)]" : "bg-white"
                } ${
                  selected
                    ? "border-[#ff4a1d] ring-1 ring-[#ff4a1d]"
                    : featured
                      ? "border-stone-900"
                      : "border-stone-300 hover:border-stone-400"
                }`}
              >
                <div className="flex min-h-7 items-start justify-between gap-3">
                  <h3 className={`font-display text-base font-bold ${featured ? "text-white" : "text-stone-900"}`}>
                    {pack.name}
                  </h3>
                  {featured && (
                    <span className="rounded-full bg-[#ff4a1d] px-2 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-white">
                      Most popular
                    </span>
                  )}
                </div>
                <div className="mt-6">
                  <p className={`font-display text-3xl font-extrabold tracking-[-0.035em] ${featured ? "text-white" : "text-stone-900"}`}>
                    GH {pack.priceGHS.toLocaleString()}
                  </p>
                  <p className={`mt-1 text-xs font-semibold ${featured ? "text-[#ff8a68]" : "text-[#e84314]"}`}>
                    {pack.credits.toLocaleString()} credits
                  </p>
                  <p className={`mt-0.5 text-[11px] ${featured ? "text-stone-400" : "text-stone-500"}`}>
                    {pack.timeLabel} AI streaming
                  </p>
                </div>
                <ul className={`mt-6 flex-1 space-y-3 text-xs ${featured ? "text-stone-300" : "text-stone-600"}`}>
                  {["Instant wallet top-up", "Use on Studio & OBS", "Pay by mobile money or card"].map((feature) => (
                    <li key={feature} className="flex items-center gap-2.5">
                      <svg
                        className={`h-3.5 w-3.5 shrink-0 ${featured ? "text-[#ff8a68]" : "text-[#ff4a1d]"}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                      {feature}
                    </li>
                  ))}
                </ul>
                <span
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleGet(pack.id);
                  }}
                  className={`mt-6 flex cursor-pointer items-center justify-center rounded-md px-4 py-3 text-sm font-semibold transition ${
                    featured || selected
                      ? "bg-[#ff4a1d] text-white"
                      : "border border-stone-300 bg-white text-stone-800 hover:border-stone-900"
                  }`}
                >
                  Get {pack.name}
                </span>
              </button>
            );
          })}
        </div>

        <p className="text-[11px] text-stone-500 text-center mb-6">
          Credits are consumed while AI streaming is active. Durations above are estimates only.
        </p>

        {/* Quick checkout dialog — opened by "Get {pack}" */}
        {checkoutOpen && selectedPackData && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={closeCheckout}
            role="presentation"
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`Checkout ${selectedPackData.name} pack`}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl"
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-base font-bold text-stone-900">Checkout · {selectedPackData.name}</h3>
                <button
                  type="button"
                  onClick={closeCheckout}
                  className="rounded-md border border-stone-300 p-1.5 text-stone-500 transition hover:text-stone-900"
                  aria-label="Close checkout"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="mt-3 flex items-center justify-between rounded-lg bg-stone-50 px-3 py-2.5 text-sm">
                <span className="text-stone-500">{selectedPackData.timeLabel} AI streaming</span>
                <span className="font-semibold text-stone-900">GH {selectedPackData.priceGHS.toLocaleString()}</span>
              </div>

              <div className="mt-4 space-y-4">
                <PromoCodeField
                  promoCode={promoCode}
                  onPromoCodeChange={setPromoCode}
                  promoResult={promoResult}
                  promoError={promoError}
                  promoLoading={promoLoading}
                  onApply={validatePromo}
                  onRemove={() => {
                    setPromoResult(null);
                    setPromoCode("");
                    setPromoError("");
                  }}
                />

                <div className="flex items-center justify-between border-t border-stone-200 pt-3 text-sm font-semibold">
                  <span className="text-stone-900">You Pay</span>
                  <div className="text-right">
                    {promoResult?.discountPercent ? (
                      <div className="flex items-center gap-2">
                        <span className="text-stone-400 line-through text-xs">GH {selectedPackData.priceGHS.toLocaleString()}</span>
                        <span className="text-[#e84314]">GH {finalPrice.toFixed(0)}</span>
                      </div>
                    ) : (
                      <span className="text-[#e84314]">GH {finalPrice.toFixed(0)}</span>
                    )}
                  </div>
                </div>
                {totalSeconds > selectedPackData.seconds && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-stone-500">Total Time</span>
                    <span className="text-emerald-600">{Math.floor(totalSeconds / 60)}m {totalSeconds % 60}s</span>
                  </div>
                )}

                <button
                  onClick={handlePurchase}
                  disabled={processing}
                  className="w-full py-3 bg-[#ff4a1d] hover:bg-[#e84314] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition"
                >
                  {processing ? "Opening Paystack..." : `Continue to Paystack · GH ${finalPrice.toFixed(0)}`}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}

export default function CreditsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#faf9f7] flex items-center justify-center"><div className="text-stone-500 text-sm">Loading...</div></div>}>
      <CreditsContent />
    </Suspense>
  );
}
