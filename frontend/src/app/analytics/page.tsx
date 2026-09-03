"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { useAuth } from "@/lib/auth-context";
import { getDb } from "@/lib/firebase";
import DashboardLayout from "@/components/DashboardLayout";

export default function AnalyticsPage() {
  const { user, userData } = useAuth();
  const [usage, setUsage] = useState<number[]>([]);
  useEffect(() => { if (!user) return; getDocs(query(collection(getDb(), "transactions"), where("userId", "==", user.uid), orderBy("createdAt", "desc"), limit(12))).then((snapshot) => setUsage(snapshot.docs.map((doc) => Number(doc.data().type === "usage" ? doc.data().seconds : 0)).filter(Boolean))).catch(() => setUsage([])); }, [user]);

  const totalPurchased = ((userData?.wallet?.totalPurchased || 0) / 60).toFixed(1);
  const totalUsed = ((userData?.wallet?.totalUsed || 0) / 60).toFixed(1);
  const balanceMinutes = ((userData?.wallet?.balanceSeconds || 0) / 60).toFixed(1);

  const maxUsage = Math.max(...usage, 1);

  return (
    <DashboardLayout>
      <div className="p-3 sm:p-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-2 gap-2 mb-5 sm:gap-3 md:grid-cols-4">
          {[
            { label: "Credits purchased", value: totalPurchased + "m", sub: "All time", color: "text-stone-900" },
            { label: "AI usage", value: totalUsed + "m", sub: "All time", color: "text-stone-900" },
            { label: "Sessions", value: String(usage.length), sub: "Recorded", color: "text-emerald-600" },
            { label: "Credits Left", value: balanceMinutes + "m", sub: "Available", color: "text-stone-900" },
          ].map((stat) => (
            <div key={stat.label} className="min-w-0 p-3 sm:p-4 rounded-xl bg-white border border-stone-200">
              <div className="text-[10px] text-stone-500 uppercase tracking-wider leading-none mb-2">{stat.label}</div>
              <div className={`font-display text-xl font-bold ${stat.color}`}>{stat.value}</div>
              <div className="text-[11px] text-stone-500 mt-0.5">{stat.sub}</div>
            </div>
          ))}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Viewers over time */}
          <div className="p-5 rounded-xl bg-white border border-stone-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-stone-900">Recent AI usage</h3>
            </div>
            <div className="flex items-end gap-1.5 h-40">
              {(usage.length ? usage : [0]).map((v, i) => (
                <div
                  key={i}
                  className="flex-1 bg-[#ff4a1d]/50 rounded-t"
                  style={{ height: `${(v / maxUsage) * 100}%`, minHeight: "4px" }}
                />
              ))}
            </div>
          </div>

          {/* AI usage (last 12 streams) */}
          <div className="p-5 rounded-xl bg-white border border-stone-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-stone-900">Wallet summary</h3>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm text-stone-600"><div>Purchased <strong className="block text-xl text-stone-900">{totalPurchased}m</strong></div><div>Used <strong className="block text-xl text-stone-900">{totalUsed}m</strong></div><div>Available <strong className="block text-xl text-[#e84314]">{balanceMinutes}m</strong></div></div>
          </div>
        </div>

        <p className="text-[11px] text-stone-500 mt-4">
          Analytics are based on your wallet and recorded AI sessions. Audience metrics appear when viewer tracking is available.
        </p>
      </div>
    </DashboardLayout>
  );
}
