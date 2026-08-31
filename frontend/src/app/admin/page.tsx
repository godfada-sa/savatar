"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  where,
  updateDoc,
  doc,
  increment,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  wallet: { balanceSeconds: number; totalPurchased: number; totalUsed: number };
  createdAt: string;
  plan: string;
}

interface PromoRecord {
  id: string;
  code: string;
  discountPercent: number;
  bonusSeconds: number;
  maxUses: number | null;
  usedCount: number;
  active: boolean;
  createdAt: string;
}

interface LogRecord {
  id: string;
  action: string;
  adminEmail: string;
  targetUser?: string;
  details?: string;
  createdAt: string;
}

const ADMIN_EMAILS = ["safful652@gmail.com"]; // Add your admin emails here

export default function AdminPage() {
  const { user, loading: authLoading, logout } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<"overview" | "users" | "promos" | "pricing" | "logs">("overview");
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [promos, setPromos] = useState<PromoRecord[]>([]);
  const [logs, setLogs] = useState<LogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [userSearch, setUserSearch] = useState("");

  // Credit user form
  const [creditEmail, setCreditEmail] = useState("");
  const [creditSeconds, setCreditSeconds] = useState("");
  const [creditReason, setCreditReason] = useState("");
  const [creditMsg, setCreditMsg] = useState("");
  const [creditLoading, setCreditLoading] = useState(false);

  // Promo form
  const [promoCode, setPromoCode] = useState("");
  const [promoBonus, setPromoBonus] = useState("");
  const [promoDiscount, setPromoDiscount] = useState("");
  const [promoMaxUses, setPromoMaxUses] = useState("");
  const [promoMsg, setPromoMsg] = useState("");
  const [promoLoading, setPromoLoading] = useState(false);

  // Sidebar collapsed
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) router.push("/login");
    if (!authLoading && user && !ADMIN_EMAILS.includes(user.email || "")) {
      router.push("/dashboard");
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const usersSnap = await getDocs(query(collection(db, "users"), orderBy("createdAt", "desc"), limit(200)));
      setUsers(usersSnap.docs.map((d) => ({ id: d.id, ...d.data() } as UserRecord)));

      const promosSnap = await getDocs(query(collection(db, "promos"), orderBy("createdAt", "desc")));
      setPromos(promosSnap.docs.map((d) => ({ id: d.id, ...d.data() } as PromoRecord)));

      const logsSnap = await getDocs(query(collection(db, "adminLogs"), orderBy("createdAt", "desc"), limit(50)));
      setLogs(logsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as LogRecord)));
    } catch (err) {
      console.error("Failed to load admin data:", err);
    }
    setLoading(false);
  };

  const handleCreditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreditMsg("");
    setCreditLoading(true);
    try {
      const q = query(collection(db, "users"), where("email", "==", creditEmail));
      const snap = await getDocs(q);
      if (snap.empty) {
        setCreditMsg("User not found with this email");
        setCreditLoading(false);
        return;
      }
      const targetDoc = snap.docs[0];
      const seconds = parseInt(creditSeconds);
      await updateDoc(doc(db, "users", targetDoc.id), {
        "wallet.balanceSeconds": increment(seconds),
        "wallet.totalPurchased": increment(seconds),
      });
      // Log the action
      await setDoc(doc(collection(db, "adminLogs")), {
        action: "credit_user",
        adminEmail: user?.email,
        targetUser: creditEmail,
        seconds,
        reason: creditReason,
        createdAt: new Date().toISOString(),
      });
      setCreditMsg(`Added ${seconds}s (${Math.floor(seconds / 60)}m ${seconds % 60}s) to ${creditEmail}`);
      setCreditEmail("");
      setCreditSeconds("");
      setCreditReason("");
      loadData();
    } catch {
      setCreditMsg("Failed to credit user");
    }
    setCreditLoading(false);
  };

  const handleCreatePromo = async (e: React.FormEvent) => {
    e.preventDefault();
    setPromoMsg("");
    setPromoLoading(true);
    try {
      const code = promoCode.toUpperCase().trim();
      await setDoc(doc(collection(db, "promos")), {
        code,
        bonusSeconds: parseInt(promoBonus) || 0,
        discountPercent: parseInt(promoDiscount) || 0,
        maxUses: parseInt(promoMaxUses) || null,
        usedCount: 0,
        active: true,
        createdAt: new Date().toISOString(),
      });
      await setDoc(doc(collection(db, "adminLogs")), {
        action: "create_promo",
        adminEmail: user?.email,
        details: `Created promo "${code}" — bonus: ${promoBonus}s, discount: ${promoDiscount}%, max uses: ${promoMaxUses || "unlimited"}`,
        createdAt: new Date().toISOString(),
      });
      setPromoMsg(`Promo "${code}" created successfully`);
      setPromoCode("");
      setPromoBonus("");
      setPromoDiscount("");
      setPromoMaxUses("");
      loadData();
    } catch {
      setPromoMsg("Failed to create promo");
    }
    setPromoLoading(false);
  };

  const togglePromo = async (promoId: string, currentActive: boolean) => {
    await updateDoc(doc(db, "promos", promoId), { active: !currentActive });
    await setDoc(doc(collection(db, "adminLogs")), {
      action: currentActive ? "deactivate_promo" : "activate_promo",
      adminEmail: user?.email,
      details: `Toggled promo ${promoId}`,
      createdAt: new Date().toISOString(),
    });
    loadData();
  };

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m ${s}s`;
  };

  const filteredUsers = users.filter(
    (u) =>
      u.email?.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.displayName?.toLowerCase().includes(userSearch.toLowerCase())
  );

  // Stats
  const totalUsers = users.length;
  const totalCreditsIssued = users.reduce((sum, u) => sum + (u.wallet?.totalPurchased || 0), 0);
  const totalCreditsUsed = users.reduce((sum, u) => sum + (u.wallet?.totalUsed || 0), 0);
  const activePromos = promos.filter((p) => p.active).length;

  // Decart cost
  const DECART_COST_PER_SEC = 0.02;
  const GHS_PER_USD = 15;

  const CREDIT_PACKS = [
    { id: "starter", name: "Starter", seconds: 300, priceGHS: 250, timeLabel: "5 min" },
    { id: "basic", name: "Basic", seconds: 900, priceGHS: 650, timeLabel: "15 min" },
    { id: "pro", name: "Pro", seconds: 1800, priceGHS: 1100, timeLabel: "30 min" },
    { id: "creator", name: "Creator", seconds: 3600, priceGHS: 1800, timeLabel: "1 hour" },
    { id: "unlimited", name: "Unlimited", seconds: 18000, priceGHS: 7500, timeLabel: "5 hours" },
  ];

  const NAV_ITEMS = [
    { id: "overview" as const, label: "Overview", icon: "O" },
    { id: "users" as const, label: "Users", icon: "U" },
    { id: "promos" as const, label: "Promos", icon: "P" },
    { id: "pricing" as const, label: "Pricing", icon: "$" },
    { id: "logs" as const, label: "Logs", icon: "L" },
  ];

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-neutral-500 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col">
      {/* Top Bar */}
      <header className="h-12 border-b border-white/5 flex items-center px-4 gap-3 bg-[#0a0a0a]">
        <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)} className="md:hidden p-1.5 rounded-lg bg-white/5 text-neutral-400 hover:text-white">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-red-500 flex items-center justify-center text-white font-bold text-[9px]">ADM</div>
          <span className="font-semibold text-sm">Admin Panel</span>
        </div>
        <span className="text-[10px] text-neutral-500 hidden sm:inline">{user.email}</span>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/dashboard" className="text-xs text-indigo-400 hover:text-indigo-300 transition">
            App Dashboard
          </Link>
          <button onClick={() => { logout(); router.push("/login"); }} className="text-xs text-neutral-500 hover:text-white transition">
            Logout
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <aside className={`${sidebarCollapsed ? "w-12" : "w-44"} border-r border-white/5 bg-[#0a0a0a] flex flex-col transition-all duration-200 flex-shrink-0 hidden md:flex`}>
          <nav className="flex-1 px-2 py-3 space-y-0.5">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition ${
                  tab === item.id ? "bg-white/10 text-white font-medium" : "text-neutral-400 hover:bg-white/5"
                }`}
              >
                <span className="w-5 h-5 rounded bg-white/5 flex items-center justify-center text-[9px] font-bold flex-shrink-0">{item.icon}</span>
                {!sidebarCollapsed && <span>{item.label}</span>}
              </button>
            ))}
          </nav>
        </aside>

        {/* Mobile tab bar */}
        <div className="md:hidden fixed bottom-0 left-0 right-0 z-20 bg-[#0a0a0a] border-t border-white/5 flex">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2 transition ${tab === item.id ? "text-indigo-400" : "text-neutral-500"}`}
            >
              <span className="text-[10px] font-bold">{item.icon}</span>
              <span className="text-[8px]">{item.label}</span>
            </button>
          ))}
        </div>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 pb-24 md:pb-6">
          {/* ─── Overview ─── */}
          {tab === "overview" && (
            <div className="space-y-6">
              <h2 className="text-lg font-bold">Dashboard Overview</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: "Total Users", value: totalUsers.toString(), color: "text-white" },
                  { label: "Credits Issued", value: formatTime(totalCreditsIssued), color: "text-indigo-400" },
                  { label: "Credits Used", value: formatTime(totalCreditsUsed), color: "text-emerald-400" },
                  { label: "Active Promos", value: activePromos.toString(), color: "text-amber-400" },
                ].map((s) => (
                  <div key={s.label} className="p-4 rounded-xl bg-[#111] border border-white/5">
                    <div className="text-[10px] text-neutral-500 uppercase tracking-wider">{s.label}</div>
                    <div className={`text-xl font-bold font-[Space_Grotesk] mt-1 ${s.color}`}>{s.value}</div>
                  </div>
                ))}
              </div>

              {/* Revenue estimate */}
              <div className="p-5 rounded-xl bg-[#111] border border-white/5">
                <h3 className="text-sm font-semibold mb-3">Revenue Estimate</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="p-3 rounded-lg bg-white/5">
                    <div className="text-[10px] text-neutral-500">Decart Cost</div>
                    <div className="text-sm font-bold text-emerald-400">${(totalCreditsUsed * DECART_COST_PER_SEC).toFixed(2)}</div>
                  </div>
                  <div className="p-3 rounded-lg bg-white/5">
                    <div className="text-[10px] text-neutral-500">Credits Remaining</div>
                    <div className="text-sm font-bold text-amber-400">{formatTime(totalCreditsIssued - totalCreditsUsed)}</div>
                  </div>
                  <div className="p-3 rounded-lg bg-white/5">
                    <div className="text-[10px] text-neutral-500">Utilization</div>
                    <div className="text-sm font-bold text-white">{totalCreditsIssued > 0 ? ((totalCreditsUsed / totalCreditsIssued) * 100).toFixed(0) : 0}%</div>
                  </div>
                  <div className="p-3 rounded-lg bg-white/5">
                    <div className="text-[10px] text-neutral-500">Avg per User</div>
                    <div className="text-sm font-bold text-white">{totalUsers > 0 ? formatTime(Math.floor(totalCreditsIssued / totalUsers)) : "0m"}</div>
                  </div>
                </div>
              </div>

              {/* Recent activity */}
              <div className="p-5 rounded-xl bg-[#111] border border-white/5">
                <h3 className="text-sm font-semibold mb-3">Recent Activity</h3>
                {logs.length === 0 ? (
                  <p className="text-xs text-neutral-500 py-4 text-center">No admin actions yet</p>
                ) : (
                  <div className="space-y-2">
                    {logs.slice(0, 5).map((log) => (
                      <div key={log.id} className="flex items-center gap-3 py-2 border-b border-white/5 last:border-0">
                        <div className={`w-6 h-6 rounded flex items-center justify-center text-[9px] font-bold ${
                          log.action === "credit_user" ? "bg-emerald-500/10 text-emerald-400" :
                          log.action === "create_promo" ? "bg-indigo-500/10 text-indigo-400" :
                          "bg-white/5 text-neutral-400"
                        }`}>
                          {log.action === "credit_user" ? "+" : log.action === "create_promo" ? "P" : "A"}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-white truncate">{log.details || log.action.replace("_", " ")}</div>
                          <div className="text-[10px] text-neutral-500">{log.targetUser || log.adminEmail}</div>
                        </div>
                        <div className="text-[10px] text-neutral-600 flex-shrink-0">
                          {log.createdAt ? new Date(log.createdAt).toLocaleDateString() : ""}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ─── Users ─── */}
          {tab === "users" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold">Users ({filteredUsers.length})</h2>
                <input
                  type="text"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Search by name or email..."
                  className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-indigo-500 w-48 md:w-64"
                />
              </div>

              {/* Credit User Form */}
              <div className="p-4 rounded-xl bg-[#111] border border-white/5">
                <h3 className="text-sm font-semibold mb-3">Credit User</h3>
                {creditMsg && (
                  <div className={`mb-3 p-2 rounded text-xs ${creditMsg.includes("not found") || creditMsg.includes("Failed") ? "bg-red-500/10 text-red-400" : "bg-emerald-500/10 text-emerald-400"}`}>
                    {creditMsg}
                  </div>
                )}
                <form onSubmit={handleCreditUser} className="flex gap-2 items-end flex-wrap">
                  <div className="flex-1 min-w-[180px]">
                    <label className="block text-[10px] text-neutral-500 uppercase tracking-wider mb-1">Email</label>
                    <input type="email" value={creditEmail} onChange={(e) => setCreditEmail(e.target.value)} placeholder="user@example.com" required
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500" />
                  </div>
                  <div className="w-28">
                    <label className="block text-[10px] text-neutral-500 uppercase tracking-wider mb-1">Seconds</label>
                    <input type="number" value={creditSeconds} onChange={(e) => setCreditSeconds(e.target.value)} placeholder="300" required
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500" />
                  </div>
                  <div className="flex-1 min-w-[140px]">
                    <label className="block text-[10px] text-neutral-500 uppercase tracking-wider mb-1">Reason</label>
                    <input type="text" value={creditReason} onChange={(e) => setCreditReason(e.target.value)} placeholder="Promo / Bonus" required
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500" />
                  </div>
                  <button type="submit" disabled={creditLoading}
                    className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition">
                    {creditLoading ? "..." : "Credit"}
                  </button>
                </form>
              </div>

              {/* Users Table */}
              <div className="rounded-xl bg-[#111] border border-white/5 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-white/5 text-neutral-400 text-[10px] uppercase tracking-wider">
                        <th className="text-left px-4 py-2">User</th>
                        <th className="text-left px-4 py-2 hidden sm:table-cell">Plan</th>
                        <th className="text-left px-4 py-2">Balance</th>
                        <th className="text-left px-4 py-2 hidden md:table-cell">Purchased</th>
                        <th className="text-left px-4 py-2 hidden md:table-cell">Used</th>
                        <th className="text-left px-4 py-2 hidden lg:table-cell">Joined</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.map((u) => (
                        <tr key={u.id} className="border-t border-white/5 hover:bg-white/[0.02] transition">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-400 text-[10px] font-semibold flex-shrink-0">
                                {(u.displayName || u.email || "U")[0].toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs font-medium text-white truncate">{u.displayName || "Unnamed"}</div>
                                <div className="text-[10px] text-neutral-500 truncate">{u.email}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 hidden sm:table-cell">
                            <span className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-neutral-400 capitalize">{u.plan || "starter"}</span>
                          </td>
                          <td className="px-4 py-3 text-xs font-mono text-indigo-400">{formatTime(u.wallet?.balanceSeconds || 0)}</td>
                          <td className="px-4 py-3 text-xs text-neutral-400 hidden md:table-cell">{formatTime(u.wallet?.totalPurchased || 0)}</td>
                          <td className="px-4 py-3 text-xs text-neutral-400 hidden md:table-cell">{formatTime(u.wallet?.totalUsed || 0)}</td>
                          <td className="px-4 py-3 text-[10px] text-neutral-600 hidden lg:table-cell">
                            {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {filteredUsers.length === 0 && (
                  <div className="text-center py-8 text-neutral-600 text-xs">
                    {userSearch ? "No users match your search" : "No users yet"}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ─── Promos ─── */}
          {tab === "promos" && (
            <div className="space-y-4">
              <h2 className="text-lg font-bold">Promo Codes ({promos.length})</h2>

              {/* Create Promo */}
              <div className="p-4 rounded-xl bg-[#111] border border-white/5">
                <h3 className="text-sm font-semibold mb-3">Create Promo Code</h3>
                {promoMsg && (
                  <div className={`mb-3 p-2 rounded text-xs ${promoMsg.includes("Failed") ? "bg-red-500/10 text-red-400" : "bg-emerald-500/10 text-emerald-400"}`}>
                    {promoMsg}
                  </div>
                )}
                <form onSubmit={handleCreatePromo} className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  <div>
                    <label className="block text-[10px] text-neutral-500 uppercase tracking-wider mb-1">Code</label>
                    <input type="text" value={promoCode} onChange={(e) => setPromoCode(e.target.value.toUpperCase())} placeholder="SUMMER2026" required
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs text-white font-mono uppercase focus:outline-none focus:border-indigo-500" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-neutral-500 uppercase tracking-wider mb-1">Bonus (sec)</label>
                    <input type="number" value={promoBonus} onChange={(e) => setPromoBonus(e.target.value)} placeholder="60"
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-neutral-500 uppercase tracking-wider mb-1">Discount %</label>
                    <input type="number" value={promoDiscount} onChange={(e) => setPromoDiscount(e.target.value)} placeholder="10"
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500" />
                  </div>
                  <div>
                    <label className="block text-[10px] text-neutral-500 uppercase tracking-wider mb-1">Max Uses</label>
                    <input type="number" value={promoMaxUses} onChange={(e) => setPromoMaxUses(e.target.value)} placeholder="Unlimited"
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500" />
                  </div>
                  <div className="flex items-end">
                    <button type="submit" disabled={promoLoading}
                      className="w-full px-4 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition">
                      {promoLoading ? "..." : "Create"}
                    </button>
                  </div>
                </form>
              </div>

              {/* Promos List */}
              <div className="rounded-xl bg-[#111] border border-white/5 overflow-hidden">
                {promos.length === 0 ? (
                  <div className="text-center py-12 text-neutral-600 text-xs">No promo codes created yet</div>
                ) : (
                  <div className="divide-y divide-white/5">
                    {promos.map((p) => (
                      <div key={p.id} className="px-4 py-3 flex items-center gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono font-bold text-white">{p.code}</span>
                            <span className={`text-[9px] px-1.5 py-0.5 rounded ${p.active ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
                              {p.active ? "Active" : "Inactive"}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 mt-1 text-[10px] text-neutral-500">
                            {p.bonusSeconds > 0 && <span>+{p.bonusSeconds}s bonus</span>}
                            {p.discountPercent > 0 && <span>{p.discountPercent}% off</span>}
                            <span>Used: {p.usedCount}{p.maxUses ? `/${p.maxUses}` : ""}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => togglePromo(p.id, p.active)}
                          className={`px-3 py-1.5 rounded-lg text-[10px] font-medium transition ${
                            p.active ? "bg-red-500/10 text-red-400 hover:bg-red-500/20" : "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                          }`}
                        >
                          {p.active ? "Deactivate" : "Activate"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ─── Pricing ─── */}
          {tab === "pricing" && (
            <div className="space-y-4">
              <h2 className="text-lg font-bold">Pricing Overview</h2>

              <div className="p-5 rounded-xl bg-gradient-to-r from-emerald-500/10 to-transparent border border-white/5">
                <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1">Decart API Cost</div>
                <div className="text-2xl font-bold text-emerald-400 font-[Space_Grotesk]">${DECART_COST_PER_SEC}/sec</div>
                <div className="text-xs text-neutral-500 mt-1">
                  = ${DECART_COST_PER_SEC * 60}/min = GH {(DECART_COST_PER_SEC * 60 * GHS_PER_USD).toFixed(0)}/min (at $1=GH{GHS_PER_USD})
                </div>
              </div>

              <div className="rounded-xl bg-[#111] border border-white/5 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-white/5 text-neutral-400 text-[10px] uppercase tracking-wider">
                        <th className="text-left px-4 py-2">Pack</th>
                        <th className="text-left px-4 py-2">Time</th>
                        <th className="text-left px-4 py-2">User Price</th>
                        <th className="text-left px-4 py-2">Your Cost</th>
                        <th className="text-left px-4 py-2">Profit</th>
                        <th className="text-left px-4 py-2">Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {CREDIT_PACKS.map((pack) => {
                        const costUSD = pack.seconds * DECART_COST_PER_SEC;
                        const costGHS = costUSD * GHS_PER_USD;
                        const profit = pack.priceGHS - costGHS;
                        const margin = ((profit / pack.priceGHS) * 100).toFixed(0);
                        return (
                          <tr key={pack.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                            <td className="px-4 py-3 text-xs font-medium text-white">{pack.name}</td>
                            <td className="px-4 py-3 text-xs text-neutral-400">{pack.timeLabel}</td>
                            <td className="px-4 py-3 text-xs text-indigo-400 font-medium">GH {pack.priceGHS.toLocaleString()}</td>
                            <td className="px-4 py-3 text-xs text-emerald-400">GH {costGHS.toFixed(0)}</td>
                            <td className="px-4 py-3 text-xs text-white font-medium">GH {profit.toFixed(0)}</td>
                            <td className="px-4 py-3">
                              <span className={`text-xs px-2 py-0.5 rounded ${parseInt(margin) >= 50 ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400"}`}>
                                {margin}%
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-[#111] border border-white/5">
                <h3 className="text-sm font-semibold mb-2">Pricing Strategy</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  <div className="p-3 rounded-lg bg-white/5">
                    <div className="text-neutral-500 mb-1">Virofy charges</div>
                    <div className="text-white font-bold">~GH 60/min</div>
                  </div>
                  <div className="p-3 rounded-lg bg-white/5">
                    <div className="text-neutral-500 mb-1">Your cost</div>
                    <div className="text-emerald-400 font-bold">GH 30/min</div>
                  </div>
                  <div className="p-3 rounded-lg bg-white/5">
                    <div className="text-neutral-500 mb-1">Your price</div>
                    <div className="text-indigo-400 font-bold">GH 33-50/min</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ─── Logs ─── */}
          {tab === "logs" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold">Admin Logs ({logs.length})</h2>
                <button onClick={loadData} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[10px] text-neutral-300 transition">
                  Refresh
                </button>
              </div>

              <div className="rounded-xl bg-[#111] border border-white/5 overflow-hidden">
                {logs.length === 0 ? (
                  <div className="text-center py-12 text-neutral-600 text-xs">No admin actions logged yet</div>
                ) : (
                  <div className="divide-y divide-white/5">
                    {logs.map((log) => (
                      <div key={log.id} className="px-4 py-3 flex items-start gap-3">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-[9px] font-bold flex-shrink-0 ${
                          log.action === "credit_user" ? "bg-emerald-500/10 text-emerald-400" :
                          log.action === "create_promo" ? "bg-indigo-500/10 text-indigo-400" :
                          log.action?.includes("deactivate") ? "bg-red-500/10 text-red-400" :
                          "bg-white/5 text-neutral-400"
                        }`}>
                          {log.action === "credit_user" ? "+" : log.action === "create_promo" ? "P" : "A"}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-white">
                            {log.action?.replace(/_/g, " ")}
                          </div>
                          {log.details && <div className="text-[10px] text-neutral-500 mt-0.5 truncate">{log.details}</div>}
                          <div className="flex items-center gap-2 mt-1 text-[10px] text-neutral-600">
                            <span>by {log.adminEmail}</span>
                            {log.targetUser && <span>→ {log.targetUser}</span>}
                            {log.createdAt && <span>• {new Date(log.createdAt).toLocaleString()}</span>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
