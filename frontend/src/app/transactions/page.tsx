"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { collection, query, where, orderBy, getDocs } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
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
    if (!user) return;
    const userId = user.uid;
    async function loadTransactions() {
      setLoading(true);
      try {
        const q = query(
          collection(getDb(), "transactions"),
          where("userId", "==", userId),
          orderBy("createdAt", "desc")
        );
        const snap = await getDocs(q);
        setTransactions(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Transaction)));
      } catch (err) {
        console.error("Failed to load transactions:", err);
      }
      setLoading(false);
    }
    void loadTransactions();
  }, [user]);

  const balanceMinutes = ((userData?.wallet?.balanceSeconds || 0) / 60).toFixed(1);
  const paymentCount = transactions.filter((transaction) => transaction.type === "purchase").length;
  const sessionCount = transactions.filter((transaction) => transaction.type === "usage").length;
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
      <div className="p-3 sm:p-6">
        {/* Header */}
        <div className="p-5 sm:p-6 rounded-xl bg-indigo-500/[0.06] border border-indigo-500/15 mb-5 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="text-[10px] text-indigo-400 font-semibold uppercase tracking-wider mb-1">Wallet & Activity</div>
            <h1 className="text-xl font-bold">Transactions</h1>
            <p className="text-xs text-neutral-500 mt-1">
              Payments, credit movements, and streaming sessions — everything that affects your wallet in one place.
            </p>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4 lg:w-auto">
            {[
              { label: "Payments", value: String(paymentCount) },
              { label: "Credit Events", value: String(transactions.length) },
              { label: "Sessions", value: String(sessionCount) },
              { label: "Balance", value: balanceMinutes + "m", color: "text-indigo-400" },
            ].map((s) => (
              <div key={s.label} className="min-w-0 text-center px-2 py-3 rounded-lg bg-[#111] border border-white/5">
                <div className="truncate text-[9px] text-neutral-500 uppercase tracking-wider">{s.label}</div>
                <div className={`font-display text-sm font-bold ${s.color || "text-white"}`}>{s.value}</div>
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
              <span className="text-xs text-neutral-500">{paymentCount}</span>
            </div>
            <div className="text-center py-8">
              <div className="text-neutral-600 text-sm">{paymentCount ? `${paymentCount} payment${paymentCount === 1 ? "" : "s"} recorded` : "No payments yet"}</div>
              {!paymentCount && <Link href="/credits" className="inline-block mt-3 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-medium rounded-lg transition">Buy credits</Link>}
            </div>
          </div>

          <div className="p-5 rounded-xl bg-[#111] border border-white/5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold">Credit activity</h3>
                <p className="text-[11px] text-neutral-500">Every credit added or consumed</p>
              </div>
              <span className="text-xs text-neutral-500">{transactions.length}</span>
            </div>
            <div className="text-center py-8">
              <div className="text-neutral-600 text-sm">{transactions.length ? `${transactions.length} wallet event${transactions.length === 1 ? "" : "s"} recorded` : "No credit activity yet"}</div>
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
            <span className="text-xs text-neutral-500">{sessionCount}</span>
          </div>
          <div className="text-center py-8">
            <div className="text-neutral-600 text-sm">{sessionCount ? `${sessionCount} streaming session${sessionCount === 1 ? "" : "s"} recorded` : "No sessions yet"}</div>
          </div>
        </div>

        {/* Transaction List */}
        {!loading && transactions.length > 0 && (
          <div className="mt-4 space-y-2">
            {transactions.map((t) => (
              <div key={t.id} className="flex flex-col gap-3 rounded-xl border border-white/5 bg-[#111] p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-semibold ${getTypeColor(t.type)}`}>
                    {t.type === "purchase" ? "+" : t.type === "usage" ? "-" : t.type === "promo" ? "P" : "A"}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white">
                      {t.type === "purchase" && `Purchased ${formatTime(t.seconds)}`}
                      {t.type === "usage" && `Used ${formatTime(t.seconds)}`}
                      {t.type === "promo" && `Promo bonus: ${formatTime(t.seconds)}`}
                      {t.type === "admin" && `Admin credit: ${formatTime(t.seconds)}`}
                    </div>
                    <div className="break-all text-[11px] text-neutral-500">
                      {t.amount ? `GH ${t.amount}` : ""}
                      {t.paymentRef ? ` - ${t.paymentRef}` : ""}
                    </div>
                  </div>
                </div>
                <div className="pl-11 text-left sm:pl-0 sm:text-right">
                  <div className={`font-display text-sm font-medium ${t.type === "purchase" || t.type === "promo" || t.type === "admin" ? "text-emerald-400" : "text-red-400"}`}>
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
