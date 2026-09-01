"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { CREDIT_PACKS } from "@/lib/credit-packs";
import DashboardLayout from "@/components/DashboardLayout";

function CreditsContent() {
  const { user, userData } = useAuth();
  const [selectedPack, setSelectedPack] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

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
        <div className="p-5 sm:p-6 rounded-xl bg-indigo-500/[0.06] border border-indigo-500/15 mb-5 flex flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-[10px] text-indigo-400 font-semibold uppercase tracking-wider mb-1">Credits & Billing</div>
            <h1 className="text-xl font-bold">Buy Credits, Unlock Possibilities</h1>
            <p className="text-xs text-neutral-500 mt-1 max-w-lg">
              Choose a pack and pay securely by mobile money or card through Paystack. Credits are added after verification.
            </p>
          </div>
          <div className="w-full text-left px-4 py-3 rounded-xl bg-[#111] border border-white/5 sm:w-auto sm:px-6 sm:text-center">
            <div className="text-[10px] text-neutral-500 uppercase tracking-wider">Available Balance</div>
            <div className="text-2xl font-bold text-indigo-400">{balanceMinutes}</div>
            <div className="text-[10px] text-neutral-500">minutes</div>
          </div>
        </div>

        {/* Credit Packs */}
        <div className="grid grid-cols-1 gap-3 mb-6 md:grid-cols-2 xl:grid-cols-5">
          {CREDIT_PACKS.map((pack) => (
            <button
              key={pack.id}
              onClick={() => selectPack(pack.id)}
              className={`block w-full p-5 rounded-xl border text-left transition ${
                selectedPack === pack.id
                  ? "bg-indigo-500/10 border-indigo-500/40"
                  : "bg-[#111] border-white/5 hover:border-white/10"
              }`}
            >
              <div className="text-sm text-neutral-300 mb-2">{pack.name} Plan</div>
              <div className="text-3xl font-bold text-white">
                {pack.seconds >= 60 ? Math.floor(pack.seconds / 60) : pack.seconds}
                <span className="text-xs text-neutral-500 font-normal ml-1">
                  {pack.seconds >= 60 ? "min" : "sec"}
                </span>
              </div>
              <div className="mt-4 border-t border-white/10 pt-4 text-2xl font-bold text-white">
                GH₵ {pack.priceGHS.toLocaleString()}
              </div>
              <ul className="mt-4 space-y-2">
                <li className="text-xs text-neutral-500">• ~{pack.timeLabel} of AI streaming</li>
                <li className="text-xs text-neutral-500">• Instant wallet top-up</li>
                <li className="text-xs text-neutral-500">• Use on Studio & OBS</li>
              </ul>
              <div className="mt-5 w-full px-3 py-3 rounded-lg bg-white/5 border border-white/10 text-sm text-center text-neutral-200 font-medium">
                Get {pack.name}
              </div>
            </button>
          ))}
        </div>

        <p className="text-[11px] text-neutral-500 text-center mb-6">
          Credits are consumed while AI streaming is active. Durations above are estimates only.
        </p>

        {/* Payment Section */}
        {selectedPack && (
          <div className="max-w-md mx-auto p-5 rounded-xl bg-[#111] border border-white/5 space-y-4">
            <h3 className="text-sm font-semibold">Payment</h3>

            <div className="rounded-lg border border-blue-500/20 bg-blue-500/[0.06] p-3">
              <div className="text-xs font-medium text-blue-300">Secure Paystack checkout</div>
              <p className="mt-1 text-[11px] text-neutral-500">Choose MTN MoMo, Telecel Cash, AT Money, or card on Paystack&apos;s payment page.</p>
            </div>

            {/* Promo Code */}
            <div>
              <label className="block text-xs text-neutral-400 mb-1.5">Promo Code (optional)</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                  placeholder="Enter promo code"
                  disabled={!!promoResult}
                  className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-indigo-500 transition font-mono uppercase disabled:opacity-50"
                />
                {promoResult ? (
                  <button
                    onClick={() => { setPromoResult(null); setPromoCode(""); setPromoError(""); }}
                    className="px-3 py-2 bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-medium rounded-lg transition hover:bg-red-500/20"
                  >
                    Remove
                  </button>
                ) : (
                  <button
                    onClick={validatePromo}
                    disabled={!promoCode.trim() || promoLoading}
                    className="px-3 py-2 bg-white/5 border border-white/10 text-neutral-300 text-xs font-medium rounded-lg transition hover:bg-white/10 disabled:opacity-50"
                  >
                    {promoLoading ? "..." : "Apply"}
                  </button>
                )}
              </div>

              {/* Promo result */}
              {promoResult && (
                <div className="mt-2 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-xs text-emerald-400 font-medium">{promoResult.message}</span>
                  </div>
                </div>
              )}

              {/* Promo error */}
              {promoError && (
                <div className="mt-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20">
                  <span className="text-xs text-red-400">{promoError}</span>
                </div>
              )}
            </div>

            {/* Price Summary */}
            <div className="p-3 rounded-lg bg-white/5 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-neutral-400">{selectedPackData?.name} Pack ({selectedPackData?.timeLabel})</span>
                <span className="text-white">GH {selectedPackData?.priceGHS.toLocaleString()}</span>
              </div>

              {promoResult?.discountPercent ? (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-emerald-400">{promoResult.discountPercent}% Promo Discount</span>
                  <span className="text-emerald-400">-GH {(selectedPackData!.priceGHS - finalPrice).toFixed(0)}</span>
                </div>
              ) : null}

              {promoResult?.bonusSeconds ? (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-emerald-400">Bonus Time</span>
                  <span className="text-emerald-400">+{promoResult.bonusSeconds >= 60 ? `${Math.floor(promoResult.bonusSeconds / 60)}m` : `${promoResult.bonusSeconds}s`}</span>
                </div>
              ) : null}

              {(promoResult?.discountPercent || promoResult?.bonusSeconds) && (
                <div className="border-t border-white/10 pt-2" />
              )}

              <div className="flex items-center justify-between text-sm font-semibold">
                <span className="text-white">You Pay</span>
                <div className="text-right">
                  {promoResult?.discountPercent ? (
                    <div className="flex items-center gap-2">
                      <span className="text-neutral-500 line-through text-xs">GH {selectedPackData?.priceGHS.toLocaleString()}</span>
                      <span className="text-indigo-400">GH {finalPrice.toFixed(0)}</span>
                    </div>
                  ) : (
                    <span className="text-indigo-400">GH {finalPrice.toFixed(0)}</span>
                  )}
                </div>
              </div>

              {totalSeconds > (selectedPackData?.seconds || 0) && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-neutral-400">Total Time</span>
                  <span className="text-emerald-400">{Math.floor(totalSeconds / 60)}m {totalSeconds % 60}s</span>
                </div>
              )}
            </div>

            <button
              onClick={handlePurchase}
              disabled={!selectedPack || processing}
              className="w-full py-3 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition"
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
    <Suspense fallback={<div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center"><div className="text-neutral-500 text-sm">Loading...</div></div>}>
      <CreditsContent />
    </Suspense>
  );
}
