"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { CREDIT_PACKS } from "@/lib/credit-packs";
import DashboardLayout from "@/components/DashboardLayout";

export default function CreditsPage() {
  const { user, userData } = useAuth();
  const [selectedPack, setSelectedPack] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"mtn" | "telecel" | "airteltigo">("mtn");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [processing, setProcessing] = useState(false);

  const balanceMinutes = ((userData?.wallet?.balanceSeconds || 0) / 60).toFixed(1);

  const handlePurchase = async () => {
    if (!selectedPack || !phoneNumber || !user) return;
    setProcessing(true);
    try {
      const pack = CREDIT_PACKS.find((p) => p.id === selectedPack);
      if (!pack) return;
      const idToken = await user.getIdToken();
      const response = await fetch("/api/payment/initiate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          packId: selectedPack,
          phone: phoneNumber,
          method: paymentMethod,
        }),
      });
      const data = await response.json();
      if (data.success) {
        alert(`Payment initiated! GH ${Number(data.amount).toFixed(0)} via ${paymentMethod.toUpperCase()}. Check your phone for the payment prompt.`);
        setSelectedPack(null);
        setPhoneNumber("");
      } else {
        alert(data.error || "Payment failed. Please try again.");
      }
    } catch {
      alert("Payment failed. Please try again.");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="p-6">
        {/* Error banner */}
        <div className="mb-4 p-4 rounded-xl bg-red-950/30 border border-red-500/20">
          <div className="text-sm font-semibold text-red-400">Session error</div>
          <div className="text-xs text-red-300/70 mt-0.5">No camera was found. Connect a camera, then reload this page.</div>
        </div>

        {/* Credits & Billing Header */}
        <div className="p-6 rounded-xl bg-gradient-to-r from-indigo-500/10 to-transparent border border-white/5 mb-6 flex items-center justify-between">
          <div>
            <div className="text-[10px] text-indigo-400 font-semibold uppercase tracking-wider mb-1">Credits & Billing</div>
            <h1 className="text-xl font-bold">Buy Credits, Unlock Possibilities</h1>
            <p className="text-xs text-neutral-500 mt-1 max-w-lg">
              Choose a pack, pay via MoMo or Telecel Cash. Credits are added instantly after payment confirmation.
            </p>
          </div>
          <div className="text-center px-6 py-3 rounded-xl bg-[#111] border border-white/5">
            <div className="text-[10px] text-neutral-500 uppercase tracking-wider">Available Balance</div>
            <div className="text-2xl font-bold text-indigo-400 font-[Space_Grotesk]">{balanceMinutes}</div>
            <div className="text-[10px] text-neutral-500">minutes</div>
          </div>
        </div>

        {/* Error banner bottom */}
        {!userData && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-400">
            No camera was found. Connect a camera, then reload this page.
          </div>
        )}

        {/* Credit Packs */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          {CREDIT_PACKS.map((pack) => (
            <button
              key={pack.id}
              onClick={() => setSelectedPack(pack.id)}
              className={`p-4 rounded-xl border text-left transition ${
                selectedPack === pack.id
                  ? "bg-indigo-500/10 border-indigo-500/40"
                  : "bg-[#111] border-white/5 hover:border-white/10"
              }`}
            >
              <div className="text-xs text-neutral-400 mb-1">{pack.name}</div>
              <div className="text-xl font-bold font-[Space_Grotesk] text-white">
                {pack.seconds >= 60 ? Math.floor(pack.seconds / 60) : pack.seconds}
                <span className="text-xs text-neutral-500 font-normal ml-1">
                  {pack.seconds >= 60 ? "min" : "sec"}
                </span>
              </div>
              <div className="text-lg font-bold text-white mt-1 font-[Space_Grotesk]">
                GH {pack.priceGHS.toLocaleString()}
              </div>
              <ul className="mt-2 space-y-0.5">
                <li className="text-[10px] text-neutral-500">~{pack.timeLabel} of AI streaming</li>
                <li className="text-[10px] text-neutral-500">Instant wallet top-up</li>
                <li className="text-[10px] text-neutral-500">Use on Studio & OBS</li>
              </ul>
              <div className="mt-3 w-full py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-center text-neutral-300 font-medium">
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

            {/* Payment Method */}
            <div>
              <label className="block text-xs text-neutral-400 mb-2">Payment Method</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "mtn" as const, label: "MTN MoMo", color: "bg-yellow-500/10 border-yellow-500/30 text-yellow-400" },
                  { id: "telecel" as const, label: "Telecel", color: "bg-red-500/10 border-red-500/30 text-red-400" },
                  { id: "airteltigo" as const, label: "AirtelTigo", color: "bg-red-600/10 border-red-600/30 text-red-400" },
                ].map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setPaymentMethod(m.id)}
                    className={`p-3 rounded-lg border text-xs font-medium text-center transition ${
                      paymentMethod === m.id ? m.color : "bg-white/5 border-white/10 text-neutral-400"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Phone Number */}
            <div>
              <label className="block text-xs text-neutral-400 mb-1.5">Phone Number</label>
              <input
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="024 123 4567"
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-indigo-500 transition"
              />
              <p className="text-[11px] text-neutral-600 mt-1">You will receive a payment prompt on this number</p>
            </div>

            <button
              onClick={handlePurchase}
              disabled={!selectedPack || !phoneNumber || processing}
              className="w-full py-3 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition"
            >
              {processing ? "Processing..." : selectedPack ? `Pay GH ${(CREDIT_PACKS.find((p) => p.id === selectedPack)?.priceGHS || 0).toFixed(0)} via ${paymentMethod.toUpperCase()}` : "Select a pack"}
            </button>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
