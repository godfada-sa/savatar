"use client";

import { Suspense, useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { CREDIT_PACKS } from "@/lib/credit-packs";
import DashboardLayout from "@/components/DashboardLayout";

function CreditsContent() {
  const { user, userData } = useAuth();
  // Basic is pre-selected (like the landing page pre-features it) so the
  // "Most popular" treatment is visible before the user clicks anything.
  const [selectedPack, setSelectedPack] = useState<string>("basic");
  const [processing, setProcessing] = useState(false);
  const paymentSectionRef = useRef<HTMLDivElement | null>(null);

  // Promo code state
  const [promoCode, setPromoCode] = useState("");
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoResult, setPromoResult] = useState<{
    success: boolean;
    discountPercent: number;
    bonusSeconds: number;
    message: string;
  } | null>(null);
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

  // "Get {pack}" on a card: select the pack and scroll the Paystack payment
  // panel into view (the panel lives below the grid, so on mobile this
  // replaces a manual scroll with one tap).
  const handleGet = (packId: string) => {
    selectPack(packId);
    requestAnimationFrame(() => {
      paymentSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
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
            const selected = selectedPack === pack.id;
            return (
              <button
                key={pack.id}
                onClick={() => selectPack(pack.id)}
                aria-pressed={selected}
                className={`flex min-h-[320px] flex-col rounded-lg border p-6 text-left transition ${
                  selected
                    ? "border-stone-900 bg-stone-900 text-white shadow-[0_24px_50px_-24px_rgba(28,25,23,0.5)]"
                    : "border-stone-300 bg-white hover:border-stone-400"
                }`}
              >
                <div className="flex min-h-7 items-start justify-between gap-3">
                  <h3 className={`font-display text-base font-bold ${selected ? "text-white" : "text-stone-900"}`}>
                    {pack.name}
                  </h3>
                  {selected && (
                    <span className="rounded-full bg-[#ff4a1d] px-2 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-white">
                      Most popular
                    </span>
                  )}
                </div>
                <div className="mt-6">
                  <p className={`font-display text-3xl font-extrabold tracking-[-0.035em] ${selected ? "text-white" : "text-stone-900"}`}>
                    GH {pack.priceGHS.toLocaleString()}
                  </p>
                  <p className={`mt-1 text-xs font-semibold ${selected ? "text-[#ff8a68]" : "text-[#e84314]"}`}>
                    {pack.credits.toLocaleString()} credits
                  </p>
                  <p className={`mt-0.5 text-[11px] ${selected ? "text-stone-400" : "text-stone-500"}`}>
                    {pack.timeLabel} AI streaming
                  </p>
                </div>
                <ul className={`mt-6 flex-1 space-y-3 text-xs ${selected ? "text-stone-300" : "text-stone-600"}`}>
                  {["Instant wallet top-up", "Use on Studio & OBS", "Pay by mobile money or card"].map((feature) => (
                    <li key={feature} className="flex items-center gap-2.5">
                      <svg
                        className={`h-3.5 w-3.5 shrink-0 ${selected ? "text-[#ff8a68]" : "text-[#ff4a1d]"}`}
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
                    selected
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

        {/* Payment Section */}
        {selectedPack && (
          <div ref={paymentSectionRef} className="max-w-md mx-auto p-5 rounded-xl bg-white border border-stone-200 space-y-4 shadow-sm scroll-mt-4">
            <h3 className="text-sm font-semibold text-stone-900">Payment</h3>

            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <div className="text-xs font-medium text-emerald-700">Secure Paystack checkout</div>
              <p className="mt-1 text-[11px] text-stone-500">Choose MTN MoMo, Telecel Cash, AT Money, or card on Paystack&apos;s payment page.</p>
            </div>

            {/* Promo Code */}
            <div>
              <label className="block text-xs text-stone-500 mb-1.5">Promo Code (optional)</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                  placeholder="Enter promo code"
                  disabled={!!promoResult}
                  className="flex-1 px-3 py-2 bg-white border border-stone-300 rounded-lg text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:border-[#ff4a1d] transition font-mono uppercase disabled:opacity-50"
                />
                {promoResult ? (
                  <button
                    onClick={() => { setPromoResult(null); setPromoCode(""); setPromoError(""); }}
                    className="px-3 py-2 bg-white border border-red-300 text-red-600 text-xs font-medium rounded-lg transition hover:bg-red-50"
                  >
                    Remove
                  </button>
                ) : (
                  <button
                    onClick={validatePromo}
                    disabled={!promoCode.trim() || promoLoading}
                    className="px-3 py-2 bg-white border border-stone-300 text-stone-600 text-xs font-medium rounded-lg transition hover:bg-stone-50 disabled:opacity-50"
                  >
                    {promoLoading ? "..." : "Apply"}
                  </button>
                )}
              </div>

              {/* Promo result */}
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

              {/* Promo error */}
              {promoError && (
                <div className="mt-2 p-2 rounded-lg bg-red-50 border border-red-200">
                  <span className="text-xs text-red-600">{promoError}</span>
                </div>
              )}
            </div>

            {/* Price Summary */}
            <div className="p-3 rounded-lg bg-stone-50 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-stone-500">{selectedPackData?.name} Pack ({selectedPackData?.timeLabel})</span>
                <span className="text-stone-900">GH {selectedPackData?.priceGHS.toLocaleString()}</span>
              </div>

              {promoResult?.discountPercent ? (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-emerald-600">{promoResult.discountPercent}% Promo Discount</span>
                  <span className="text-emerald-600">-GH {(selectedPackData!.priceGHS - finalPrice).toFixed(0)}</span>
                </div>
              ) : null}

              {promoResult?.bonusSeconds ? (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-emerald-600">Bonus Time</span>
                  <span className="text-emerald-600">+{promoResult.bonusSeconds >= 60 ? `${Math.floor(promoResult.bonusSeconds / 60)}m` : `${promoResult.bonusSeconds}s`}</span>
                </div>
              ) : null}

              {(promoResult?.discountPercent || promoResult?.bonusSeconds) && (
                <div className="border-t border-stone-200 pt-2" />
              )}

              <div className="flex items-center justify-between text-sm font-semibold">
                <span className="text-stone-900">You Pay</span>
                <div className="text-right">
                  {promoResult?.discountPercent ? (
                    <div className="flex items-center gap-2">
                      <span className="text-stone-400 line-through text-xs">GH {selectedPackData?.priceGHS.toLocaleString()}</span>
                      <span className="text-[#e84314]">GH {finalPrice.toFixed(0)}</span>
                    </div>
                  ) : (
                    <span className="text-[#e84314]">GH {finalPrice.toFixed(0)}</span>
                  )}
                </div>
              </div>

              {totalSeconds > (selectedPackData?.seconds || 0) && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-stone-500">Total Time</span>
                  <span className="text-emerald-600">{Math.floor(totalSeconds / 60)}m {totalSeconds % 60}s</span>
                </div>
              )}
            </div>

            <button
              onClick={handlePurchase}
              disabled={!selectedPack || processing}
              className="w-full py-3 bg-[#ff4a1d] hover:bg-[#e84314] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition"
            >
              {processing ? "Opening Paystack..." : `Pay GH ${finalPrice.toFixed(0)} securely`}
            </button>
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
