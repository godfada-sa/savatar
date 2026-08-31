"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { collection, query, where, orderBy, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import DashboardLayout from "@/components/DashboardLayout";

interface Transaction {
  id: string;
  type: "purchase" | "usage" | "promo" | "admin";
  seconds: number;
  amount?: number;
  paymentRef?: string;
  createdAt: string;
}

export default function TransactionsPage() {
  const { user, userData } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) loadTransactions();
  }, [user]);

  const loadTransactions = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const q = query(
        collection(db, "transactions"),
        where("userId", "==", user.uid),
        orderBy("createdAt", "desc")
      );
      const snap = await getDocs(q);
      setTransactions(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Transaction)));
    } catch (err) {
      console.error("Failed to load transactions:", err);
    }
    setLoading(false);
  };

  const balanceMinutes = ((userData?.wallet?.balanceSeconds || 0) / 60).toFixed(1);
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "purchase": return "text-emerald-400 bg-emerald-500/10";
      case "usage": return "text-red-400 bg-red-500/10";
      case "promo": return "text-indigo-400 bg-indigo-500/10";
      case "admin": return "text-amber-400 bg-amber-500/10";
      default: return "text-neutral-400 bg-white/5";
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

        {/* Header */}
        <div className="p-6 rounded-xl bg-gradient-to-r from-indigo-500/10 to-transparent border border-white/5 mb-6 flex items-center justify-between">
          <div>
            <div className="text-[10px] text-indigo-400 font-semibold uppercase tracking-wider mb-1">Wallet & Activity</div>
            <h1 className="text-xl font-bold">Transactions</h1>
            <p className="text-xs text-neutral-500 mt-1">
              Payments, credit movements, and streaming sessions — everything that affects your wallet in one place.
            </p>
          </div>
          <div className="flex gap-2">
            {[
              { label: "Payments", value: "0" },
              { label: "Credit Events", value: "0" },
              { label: "Sessions", value: "0" },
              { label: "Balance", value: balanceMinutes + "m", color: "text-indigo-400" },
            ].map((s) => (
              <div key={s.label} className="text-center px-3 py-2 rounded-lg bg-[#111] border border-white/5">
                <div className="text-[9px] text-neutral-500 uppercase tracking-wider">{s.label}</div>
                <div className={`text-sm font-bold font-[Space_Grotesk] ${s.color || "text-white"}`}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Payment Transactions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div className="p-5 rounded-xl bg-[#111] border border-white/5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold">Payment transactions</h3>
                <p className="text-[11px] text-neutral-500">Checkout history and payment status</p>
              </div>
              <span className="text-xs text-neutral-500">0</span>
            </div>
            <div className="text-center py-8">
              <div className="text-neutral-600 text-sm">No payments yet</div>
              <Link href="/credits" className="inline-block mt-3 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-medium rounded-lg transition">
                Buy credits
              </Link>
            </div>
          </div>

          <div className="p-5 rounded-xl bg-[#111] border border-white/5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold">Credit activity</h3>
                <p className="text-[11px] text-neutral-500">Every credit added or consumed</p>
              </div>
              <span className="text-xs text-neutral-500">0</span>
            </div>
            <div className="text-center py-8">
              <div className="text-neutral-600 text-sm">No credit activity yet</div>
            </div>
          </div>
        </div>

        {/* Session History */}
        <div className="p-5 rounded-xl bg-[#111] border border-white/5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold">Session history</h3>
              <p className="text-[11px] text-neutral-500">Streaming sessions and credit usage</p>
            </div>
            <span className="text-xs text-neutral-500">0</span>
          </div>
          <div className="text-center py-8">
            <div className="text-neutral-600 text-sm">No sessions yet</div>
          </div>
        </div>

        {/* Transaction List */}
        {!loading && transactions.length > 0 && (
          <div className="mt-4 space-y-2">
            {transactions.map((t) => (
              <div key={t.id} className="p-4 rounded-xl bg-[#111] border border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-semibold ${getTypeColor(t.type)}`}>
                    {t.type === "purchase" ? "+" : t.type === "usage" ? "-" : t.type === "promo" ? "P" : "A"}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-white">
                      {t.type === "purchase" && `Purchased ${formatTime(t.seconds)}`}
                      {t.type === "usage" && `Used ${formatTime(t.seconds)}`}
                      {t.type === "promo" && `Promo bonus: ${formatTime(t.seconds)}`}
                      {t.type === "admin" && `Admin credit: ${formatTime(t.seconds)}`}
                    </div>
                    <div className="text-[11px] text-neutral-500">
                      {t.amount ? `GH ${t.amount}` : ""}
                      {t.paymentRef ? ` - ${t.paymentRef}` : ""}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className={`text-sm font-medium font-[Space_Grotesk] ${t.type === "purchase" || t.type === "promo" || t.type === "admin" ? "text-emerald-400" : "text-red-400"}`}>
                    {t.type === "purchase" || t.type === "promo" || t.type === "admin" ? "+" : "-"}{formatTime(t.seconds)}
                  </div>
                  <div className="text-[11px] text-neutral-600">
                    {t.createdAt ? new Date(t.createdAt).toLocaleDateString() : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
