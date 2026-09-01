"use client";

import { useAuth } from "@/lib/auth-context";
import DashboardLayout from "@/components/DashboardLayout";

export default function AnalyticsPage() {
  const { userData } = useAuth();

  const totalPurchased = ((userData?.wallet?.totalPurchased || 0) / 60).toFixed(1);
  const totalUsed = ((userData?.wallet?.totalUsed || 0) / 60).toFixed(1);
  const balanceMinutes = ((userData?.wallet?.balanceSeconds || 0) / 60).toFixed(1);

  const weeklyData = [
    { day: "Mon", minutes: 2.5 },
    { day: "Tue", minutes: 4.2 },
    { day: "Wed", minutes: 1.8 },
    { day: "Thu", minutes: 6.1 },
    { day: "Fri", minutes: 3.5 },
    { day: "Sat", minutes: 8.2 },
    { day: "Sun", minutes: 5.0 },
  ];

  const maxMinutes = Math.max(...weeklyData.map((d) => d.minutes), 1);

  return (
    <DashboardLayout>
      <div className="p-6">
        {/* Error banner */}
        <div className="mb-4 p-4 rounded-xl bg-red-950/30 border border-red-500/20">
          <div className="text-sm font-semibold text-red-400">Session error</div>
          <div className="text-xs text-red-300/70 mt-0.5">No camera was found. Connect a camera, then reload this page.</div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
          {[
            { label: "Live Viewers", value: "0", sub: "Offline", color: "text-white" },
            { label: "Stream Time (Today)", value: "0:00", sub: "This session", color: "text-white" },
            { label: "Followers", value: "0", sub: "+0 this week", color: "text-emerald-400" },
            { label: "AI Usage", value: "0%", sub: "of stream time", color: "text-white" },
            { label: "Engagement", value: "0%", sub: "Above average", color: "text-indigo-400" },
            { label: "Credits Left", value: balanceMinutes + "m", sub: "Available", color: "text-white" },
          ].map((stat) => (
            <div key={stat.label} className="p-4 rounded-xl bg-[#111] border border-white/5">
              <div className="text-[10px] text-neutral-500 uppercase tracking-wider leading-none mb-2">{stat.label}</div>
              <div className={`font-display text-xl font-bold ${stat.color}`}>{stat.value}</div>
              <div className="text-[11px] text-neutral-500 mt-0.5">{stat.sub}</div>
            </div>
          ))}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Viewers over time */}
          <div className="p-5 rounded-xl bg-[#111] border border-white/5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold">Viewers over time</h3>
              <span className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-neutral-500">Sample</span>
            </div>
            <div className="flex items-end gap-1.5 h-40">
              {[12, 8, 15, 10, 18, 14, 20, 16, 22, 19, 24, 21, 25].map((v, i) => (
                <div
                  key={i}
                  className="flex-1 bg-indigo-500/40 rounded-t"
                  style={{ height: `${(v / 25) * 100}%`, minHeight: "4px" }}
                />
              ))}
            </div>
          </div>

          {/* AI usage (last 12 streams) */}
          <div className="p-5 rounded-xl bg-[#111] border border-white/5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold">AI usage (last 12 streams)</h3>
              <span className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-neutral-500">Sample</span>
            </div>
            <div className="flex items-end gap-1.5 h-40">
              {[65, 72, 58, 80, 68, 75, 82, 70, 85, 78, 88, 82].map((v, i) => (
                <div
                  key={i}
                  className="flex-1 bg-indigo-500/40 rounded-t"
                  style={{ height: `${v}%`, minHeight: "4px" }}
                />
              ))}
            </div>
          </div>
        </div>

        <p className="text-[11px] text-neutral-600 mt-4">
          Analytics show sample data. Live metrics will populate once audience tracking is connected.
        </p>
      </div>
    </DashboardLayout>
  );
}
