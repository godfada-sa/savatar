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
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { CREDIT_PACKS, DECART_COST_PACKS, DECART_COST_PER_SEC, GHS_PER_USD } from "@/lib/credit-packs";
import ThemeToggle from "@/components/ThemeToggle";

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

const ADMIN_EMAILS = ["safful652@gmail.com"];

const DECART_PACKS = DECART_COST_PACKS;
const USER_PACKS = CREDIT_PACKS;

type Tab = "overview" | "users" | "promos" | "buy" | "pricing" | "logs";

const NAV_ITEMS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  {
    id: "overview",
    label: "Overview",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
      </svg>
    ),
  },
  {
    id: "users",
    label: "Users",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
      </svg>
    ),
  },
  {
    id: "promos",
    label: "Promos",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 6h.008v.008H6V6z" />
      </svg>
    ),
  },
  {
    id: "buy",
    label: "Buy for User",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
      </svg>
    ),
  },
  {
    id: "pricing",
    label: "Pricing",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    id: "logs",
    label: "Logs",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
];

function formatTime(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

export default function AdminPage() {
  const { user, loading: authLoading, logout } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
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

  // Buy for user form
  const [buyEmail, setBuyEmail] = useState("");
  const [buyPackId, setBuyPackId] = useState("");
  const [buyMsg, setBuyMsg] = useState("");
  const [buyLoading, setBuyLoading] = useState(false);

  // Promo form
  const [promoCode, setPromoCode] = useState("");
  const [promoBonus, setPromoBonus] = useState("");
  const [promoDiscount, setPromoDiscount] = useState("");
  const [promoMaxUses, setPromoMaxUses] = useState("");
  const [promoMsg, setPromoMsg] = useState("");
  const [promoLoading, setPromoLoading] = useState(false);

  const mountedRef = useState(() => ({ current: false }))[0];

  useEffect(() => {
    mountedRef.current = true;
  }, []);

  useEffect(() => {
    if (!authLoading && mountedRef.current) {
      if (!user) router.push("/login");
      else if (!ADMIN_EMAILS.includes(user.email || "")) {
        router.push("/dashboard");
      }
    }
  }, [user, authLoading, router, mountedRef]);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const db = getDb();
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
  }

  async function adminRequest(payload: Record<string, unknown>) {
    if (!user) throw new Error("Sign in again to continue");
    const response = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
      body: JSON.stringify(payload),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) throw new Error(result.error || "Admin action failed");
  }

  // ─── Credit User (manual seconds) ─────────────────
  const handleCreditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreditMsg("");
    setCreditLoading(true);
    try {
      const db = getDb();
      const q = query(collection(db, "users"), where("email", "==", creditEmail));
      const snap = await getDocs(q);
      if (snap.empty) {
        setCreditMsg("User not found with this email");
        setCreditLoading(false);
        return;
      }
      const targetDoc = snap.docs[0];
      const seconds = parseInt(creditSeconds);
      if (isNaN(seconds) || seconds <= 0) {
        setCreditMsg("Enter a valid number of seconds");
        setCreditLoading(false);
        return;
      }
      await adminRequest({ action: "credit", userId: targetDoc.id, seconds, reason: creditReason });
      setCreditMsg(`Added ${formatTime(seconds)} to ${creditEmail}`);
      setCreditEmail("");
      setCreditSeconds("");
      setCreditReason("");
      loadData();
    } catch (err) {
      console.error("Credit user error:", err);
      setCreditMsg("Failed to credit user. Check Firestore rules.");
    }
    setCreditLoading(false);
  };

  // ─── Buy for User (at Decart cost, no profit) ────
  const handleBuyForUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setBuyMsg("");
    setBuyLoading(true);
    try {
      const db = getDb();
      const pack = DECART_PACKS.find((p) => p.id === buyPackId);
      if (!pack) {
        setBuyMsg("Select a credit pack");
        setBuyLoading(false);
        return;
      }

      // Find user by email
      const q = query(collection(db, "users"), where("email", "==", buyEmail));
      const snap = await getDocs(q);
      if (snap.empty) {
        setBuyMsg("User not found with this email");
        setBuyLoading(false);
        return;
      }

      const targetDoc = snap.docs[0];

      // Add credits to user wallet
      await adminRequest({ action: "credit", userId: targetDoc.id, seconds: pack.seconds, purchase: true, amount: pack.costGHS, reason: `Admin purchased ${pack.name} pack` });

      setBuyMsg(`Added ${pack.timeLabel} (${pack.seconds}s) to ${buyEmail} at Decart cost GH ${pack.costGHS}`);
      setBuyEmail("");
      setBuyPackId("");
      loadData();
    } catch (err) {
      console.error("Buy for user error:", err);
      setBuyMsg("Failed to process. Check Firestore rules.");
    }
    setBuyLoading(false);
  };

  // ─── Promo CRUD ────────────────────────────────────
  const handleCreatePromo = async (e: React.FormEvent) => {
    e.preventDefault();
    setPromoMsg("");
    setPromoLoading(true);
    try {
      const db = getDb();
      const code = promoCode.toUpperCase().trim();
      if (!code) {
        setPromoMsg("Enter a promo code");
        setPromoLoading(false);
        return;
      }
      await adminRequest({ action: "promo", code, bonusSeconds: parseInt(promoBonus) || 0, discountPercent: parseInt(promoDiscount) || 0, maxUses: parseInt(promoMaxUses) || null });
      setPromoMsg(`Promo "${code}" created successfully`);
      setPromoCode("");
      setPromoBonus("");
      setPromoDiscount("");
      setPromoMaxUses("");
      loadData();
    } catch (err) {
      console.error("Create promo error:", err);
      setPromoMsg("Failed to create promo");
    }
    setPromoLoading(false);
  };

  const togglePromo = async (promoId: string, currentActive: boolean) => {
    try {
      await adminRequest({ action: "togglePromo", promoId, active: !currentActive });
      loadData();
    } catch (err) {
      console.error("Toggle promo error:", err);
    }
  };

  // ─── Computed stats ────────────────────────────────
  const filteredUsers = users.filter(
    (u) =>
      u.email?.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.displayName?.toLowerCase().includes(userSearch.toLowerCase())
  );

  const totalUsers = users.length;
  const totalCreditsIssued = users.reduce((sum, u) => sum + (u.wallet?.totalPurchased || 0), 0);
  const totalCreditsUsed = users.reduce((sum, u) => sum + (u.wallet?.totalUsed || 0), 0);
  const activePromos = promos.filter((p) => p.active).length;
  const utilization = totalCreditsIssued > 0 ? Math.round((totalCreditsUsed / totalCreditsIssued) * 100) : 0;

  const tabCounts: Partial<Record<Tab, number>> = {
    users: filteredUsers.length,
    promos: promos.length,
    logs: logs.length,
  };

  const pageTitle: Record<Tab, string> = {
    overview: "Control room",
    users: "Members & wallets",
    promos: "Promo codes",
    buy: "Buy for a user",
    pricing: "Pack economics",
    logs: "Audit trail",
  };

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-[#faf9f7] flex items-center justify-center">
        <div className="flex items-center gap-2 text-stone-500 text-sm">
          <span className="w-4 h-4 rounded-full border-2 border-stone-200 border-t-[#ff4a1d] animate-spin" />
          Loading…
        </div>
      </div>
    );
  }

  if (!ADMIN_EMAILS.includes(user.email || "")) {
    return (
      <div className="min-h-screen bg-[#faf9f7] flex items-center justify-center">
        <div className="text-center max-w-sm px-6">
          <div className="w-10 h-10 rounded-xl bg-red-50 border border-red-200 text-red-600 flex items-center justify-center mx-auto mb-3">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <h1 className="font-display text-lg font-bold text-stone-900">Access denied</h1>
          <p className="text-xs text-stone-500 mt-1">You don&apos;t have admin access to this panel.</p>
          <Link href="/dashboard" className="inline-block mt-4 px-4 py-2 bg-[#ff4a1d] hover:bg-[#e84314] text-white text-xs font-medium rounded-lg transition">
            Go to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f4f1ed] text-stone-900">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 h-12 bg-white border-b border-stone-200 flex items-center gap-3 px-3 sm:px-6">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-6 h-6 rounded-md bg-[#ff4a1d] text-white grid place-items-center font-display text-[10px] font-extrabold flex-shrink-0">S</span>
          <span className="font-display text-sm font-extrabold tracking-tight">Admin</span>
          <span className="hidden md:inline text-[10px] font-bold uppercase tracking-[0.18em] text-stone-400 border-l border-stone-200 pl-3 ml-0.5 truncate">
            Control room
          </span>
        </div>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
          <span className="hidden sm:block text-xs text-stone-400 max-w-[180px] truncate">{user.email}</span>
          <Link href="/dashboard" className="hidden sm:inline-flex text-xs text-stone-500 hover:text-stone-900 transition">
            App dashboard
          </Link>
          <ThemeToggle className="border border-stone-200 bg-white text-stone-600 hover:text-stone-900 flex-shrink-0" />
          <button
            onClick={() => { logout(); router.push("/login"); }}
            className="text-xs font-medium px-3 py-1.5 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 hover:text-stone-900 transition flex-shrink-0"
          >
            Log out
          </button>
        </div>
      </header>

      {/* Tab strip */}
      <nav className="sticky top-12 z-20 bg-[#faf9f7] border-b border-stone-200 px-2 sm:px-4 flex items-stretch overflow-x-auto no-scrollbar">
        {NAV_ITEMS.map((item) => {
          const isActive = tab === item.id;
          const count = tabCounts[item.id];
          return (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`relative flex items-center gap-2 px-3 sm:px-4 h-11 text-xs font-semibold whitespace-nowrap transition flex-shrink-0 ${
                isActive ? "text-[#e84314]" : "text-stone-500 hover:text-stone-900"
              }`}
            >
              <span className={isActive ? "" : "text-stone-400"}>{item.icon}</span>
              <span>{item.label}</span>
              {count !== undefined && (
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${
                  isActive ? "bg-[#ff4a1d]/10 text-[#e84314]" : "bg-stone-200/70 text-stone-500"
                }`}>
                  {count}
                </span>
              )}
              {isActive && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[#ff4a1d]" />}
            </button>
          );
        })}
      </nav>

      {/* Content */}
      <main className="px-3 sm:px-6 py-6 max-w-6xl mx-auto w-full">
        {/* Tab header */}
        <div className="mb-5">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#e84314]">{tab}</p>
          <h1 className="font-display text-xl sm:text-2xl font-extrabold tracking-tight mt-0.5">{pageTitle[tab]}</h1>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-stone-500 text-sm py-16 justify-center">
            <span className="w-4 h-4 rounded-full border-2 border-stone-200 border-t-[#ff4a1d] animate-spin" />
            Loading…
          </div>
        ) : (
          <>
            {/* ─── Overview ─── */}
            {tab === "overview" && (
              <div className="space-y-4">
                <div className="rounded-lg bg-white border border-stone-200 divide-y divide-stone-100 md:divide-y-0 md:grid md:grid-cols-4 md:divide-x">
                  {[
                    { label: "Total Users", value: totalUsers.toString(), tone: "text-stone-900" },
                    { label: "Credits Issued", value: formatTime(totalCreditsIssued), tone: "text-[#e84314]" },
                    { label: "Credits Used", value: formatTime(totalCreditsUsed), tone: "text-emerald-600" },
                    { label: "Active Promos", value: activePromos.toString(), tone: "text-stone-900" },
                  ].map((s) => (
                    <div key={s.label} className="px-4 py-4 sm:px-5">
                      <div className="text-[10px] font-bold text-stone-400 uppercase tracking-[0.16em]">{s.label}</div>
                      <div className={`font-display text-2xl font-extrabold tracking-tight mt-1.5 ${s.tone}`}>{s.value}</div>
                    </div>
                  ))}
                </div>

                {/* Revenue & utilization */}
                <div className="rounded-lg bg-white border border-stone-200 overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-stone-100 flex items-center justify-between">
                    <h3 className="text-sm font-bold">Economics</h3>
                    <span className="text-[10px] text-stone-400">lifetime, all users</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y divide-stone-100 sm:divide-y-0 sm:divide-x">
                    <div className="px-5 py-4">
                      <div className="text-[10px] text-stone-400 uppercase tracking-wider">Decart cost</div>
                      <div className="font-display text-lg font-extrabold text-emerald-600 mt-1">${(totalCreditsUsed * DECART_COST_PER_SEC).toFixed(2)}</div>
                    </div>
                    <div className="px-5 py-4">
                      <div className="text-[10px] text-stone-400 uppercase tracking-wider">Credits remaining</div>
                      <div className="font-display text-lg font-extrabold mt-1">{formatTime(totalCreditsIssued - totalCreditsUsed)}</div>
                    </div>
                    <div className="px-5 py-4">
                      <div className="text-[10px] text-stone-400 uppercase tracking-wider">Utilization</div>
                      <div className="font-display text-lg font-extrabold mt-1">{utilization}%</div>
                      <div className="h-1 rounded-full bg-stone-100 mt-2 overflow-hidden">
                        <div className="h-full bg-[#ff4a1d] rounded-full" style={{ width: `${Math.min(utilization, 100)}%` }} />
                      </div>
                    </div>
                    <div className="px-5 py-4">
                      <div className="text-[10px] text-stone-400 uppercase tracking-wider">Avg per user</div>
                      <div className="font-display text-lg font-extrabold mt-1">{totalUsers > 0 ? formatTime(Math.floor(totalCreditsIssued / totalUsers)) : "0m"}</div>
                    </div>
                  </div>
                </div>

                {/* Recent activity */}
                <div className="rounded-lg bg-white border border-stone-200 overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-stone-100">
                    <h3 className="text-sm font-bold">Recent activity</h3>
                  </div>
                  {logs.length === 0 ? (
                    <p className="text-xs text-stone-400 py-8 text-center">No admin actions yet</p>
                  ) : (
                    <div className="divide-y divide-stone-100">
                      {logs.slice(0, 5).map((log) => (
                        <div key={log.id} className="flex items-center gap-3 px-5 py-2.5">
                          <span className={`w-6 h-6 rounded-md grid place-items-center text-[10px] font-bold flex-shrink-0 ${
                            log.action === "credit_user" || log.action === "buy_for_user" ? "bg-emerald-50 text-emerald-600" :
                            log.action === "create_promo" ? "bg-[#ff4a1d]/10 text-[#e84314]" :
                            "bg-stone-100 text-stone-500"
                          }`}>
                            {log.action === "credit_user" || log.action === "buy_for_user" ? "+" : log.action === "create_promo" ? "P" : "A"}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-stone-900 truncate">{log.details || log.action.replace(/_/g, " ")}</div>
                            <div className="text-[10px] text-stone-400 truncate">{log.targetUser || log.adminEmail}</div>
                          </div>
                          <div className="text-[10px] text-stone-400 flex-shrink-0">
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
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <h2 className="font-display text-lg font-extrabold tracking-tight">Users ({filteredUsers.length})</h2>
                  <input
                    type="text"
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Search by name or email…"
                    className="px-3 py-2 bg-white border border-stone-300 rounded-lg text-xs text-stone-900 placeholder-stone-400 focus:outline-none focus:border-[#ff4a1d] focus:ring-2 focus:ring-[#ff4a1d]/10 w-52 sm:w-64 transition"
                  />
                </div>

                {/* Credit User Form */}
                <div className="rounded-lg bg-white border border-stone-200 p-4 sm:p-5">
                  <h3 className="text-sm font-bold mb-3">Credit user manually</h3>
                  {creditMsg && (
                    <div className={`mb-3 px-3 py-2 rounded-lg text-xs ${
                      creditMsg.includes("not found") || creditMsg.includes("Failed")
                        ? "bg-red-50 border border-red-200 text-red-600"
                        : "bg-emerald-50 border border-emerald-200 text-emerald-700"
                    }`}>
                      {creditMsg}
                    </div>
                  )}
                  <form onSubmit={handleCreditUser} className="flex gap-3 items-end flex-wrap">
                    <div className="flex-1 min-w-[200px]">
                      <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-[0.14em] mb-1">Email</label>
                      <input type="email" value={creditEmail} onChange={(e) => setCreditEmail(e.target.value)} placeholder="user@example.com" required
                        className="w-full px-3 py-2 bg-white border border-stone-300 rounded-lg text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:border-[#ff4a1d] focus:ring-2 focus:ring-[#ff4a1d]/10 transition" />
                    </div>
                    <div className="w-32">
                      <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-[0.14em] mb-1">Seconds</label>
                      <input type="number" value={creditSeconds} onChange={(e) => setCreditSeconds(e.target.value)} placeholder="500" required
                        className="w-full px-3 py-2 bg-white border border-stone-300 rounded-lg text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:border-[#ff4a1d] focus:ring-2 focus:ring-[#ff4a1d]/10 transition" />
                    </div>
                    <div className="flex-1 min-w-[160px]">
                      <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-[0.14em] mb-1">Reason</label>
                      <input type="text" value={creditReason} onChange={(e) => setCreditReason(e.target.value)} placeholder="Promo / bonus" required
                        className="w-full px-3 py-2 bg-white border border-stone-300 rounded-lg text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:border-[#ff4a1d] focus:ring-2 focus:ring-[#ff4a1d]/10 transition" />
                    </div>
                    <button type="submit" disabled={creditLoading}
                      className="px-5 py-2 bg-[#ff4a1d] hover:bg-[#e84314] disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition">
                      {creditLoading ? "…" : "Credit user"}
                    </button>
                  </form>
                  <p className="mt-2 text-[10px] text-stone-400">1,000 Lucy credits ≈ 500 stream seconds</p>
                </div>

                {/* Users Table */}
                <div className="rounded-lg bg-white border border-stone-200 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-stone-50 text-stone-500 text-[10px] uppercase tracking-[0.14em]">
                          <th className="text-left px-4 py-2.5 font-bold">User</th>
                          <th className="text-left px-4 py-2.5 font-bold hidden sm:table-cell">Plan</th>
                          <th className="text-left px-4 py-2.5 font-bold">Balance</th>
                          <th className="text-left px-4 py-2.5 font-bold hidden md:table-cell">Purchased</th>
                          <th className="text-left px-4 py-2.5 font-bold hidden md:table-cell">Used</th>
                          <th className="text-left px-4 py-2.5 font-bold hidden lg:table-cell">Joined</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredUsers.map((u) => (
                          <tr key={u.id} className="border-t border-stone-100 hover:bg-stone-50/60 transition">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2.5">
                                <div className="w-7 h-7 rounded-full bg-[#ff4a1d]/10 flex items-center justify-center text-[#e84314] text-[10px] font-bold flex-shrink-0">
                                  {(u.displayName || u.email || "U")[0].toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                  <div className="text-xs font-semibold text-stone-900 truncate">{u.displayName || "Unnamed"}</div>
                                  <div className="text-[10px] text-stone-400 truncate">{u.email}</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 hidden sm:table-cell">
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-stone-100 text-stone-600 capitalize">{u.plan || "starter"}</span>
                            </td>
                            <td className="px-4 py-3 text-xs font-mono font-semibold text-[#e84314]">{formatTime(u.wallet?.balanceSeconds || 0)}</td>
                            <td className="px-4 py-3 text-xs text-stone-500 hidden md:table-cell">{formatTime(u.wallet?.totalPurchased || 0)}</td>
                            <td className="px-4 py-3 text-xs text-stone-500 hidden md:table-cell">{formatTime(u.wallet?.totalUsed || 0)}</td>
                            <td className="px-4 py-3 text-[10px] text-stone-400 hidden lg:table-cell">
                              {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {filteredUsers.length === 0 && (
                    <div className="text-center py-10 text-stone-400 text-xs">
                      {userSearch ? "No users match your search" : "No users yet"}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ─── Promos ─── */}
            {tab === "promos" && (
              <div className="space-y-4">
                <h2 className="font-display text-lg font-extrabold tracking-tight">All codes ({promos.length})</h2>

                <div className="rounded-lg bg-white border border-stone-200 p-4 sm:p-5">
                  <h3 className="text-sm font-bold mb-3">Create promo code</h3>
                  {promoMsg && (
                    <div className={`mb-3 px-3 py-2 rounded-lg text-xs ${
                      promoMsg.includes("Failed")
                        ? "bg-red-50 border border-red-200 text-red-600"
                        : "bg-emerald-50 border border-emerald-200 text-emerald-700"
                    }`}>
                      {promoMsg}
                    </div>
                  )}
                  <form onSubmit={handleCreatePromo} className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-[0.14em] mb-1">Code</label>
                      <input type="text" value={promoCode} onChange={(e) => setPromoCode(e.target.value.toUpperCase())} placeholder="SUMMER2026" required
                        className="w-full px-3 py-2 bg-white border border-stone-300 rounded-lg text-xs text-stone-900 font-mono uppercase placeholder-stone-300 focus:outline-none focus:border-[#ff4a1d] focus:ring-2 focus:ring-[#ff4a1d]/10 transition" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-[0.14em] mb-1">Bonus (sec)</label>
                      <input type="number" value={promoBonus} onChange={(e) => setPromoBonus(e.target.value)} placeholder="60"
                        className="w-full px-3 py-2 bg-white border border-stone-300 rounded-lg text-xs text-stone-900 focus:outline-none focus:border-[#ff4a1d] focus:ring-2 focus:ring-[#ff4a1d]/10 transition" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-[0.14em] mb-1">Discount %</label>
                      <input type="number" value={promoDiscount} onChange={(e) => setPromoDiscount(e.target.value)} placeholder="10"
                        className="w-full px-3 py-2 bg-white border border-stone-300 rounded-lg text-xs text-stone-900 focus:outline-none focus:border-[#ff4a1d] focus:ring-2 focus:ring-[#ff4a1d]/10 transition" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-[0.14em] mb-1">Max uses</label>
                      <input type="number" value={promoMaxUses} onChange={(e) => setPromoMaxUses(e.target.value)} placeholder="Unlimited"
                        className="w-full px-3 py-2 bg-white border border-stone-300 rounded-lg text-xs text-stone-900 focus:outline-none focus:border-[#ff4a1d] focus:ring-2 focus:ring-[#ff4a1d]/10 transition" />
                    </div>
                    <div className="flex items-end">
                      <button type="submit" disabled={promoLoading}
                        className="w-full px-4 py-2 bg-[#ff4a1d] hover:bg-[#e84314] disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition">
                        {promoLoading ? "…" : "Create"}
                      </button>
                    </div>
                  </form>
                </div>

                <div className="rounded-lg bg-white border border-stone-200 overflow-hidden">
                  {promos.length === 0 ? (
                    <div className="text-center py-12 text-stone-400 text-xs">No promo codes created yet</div>
                  ) : (
                    <div className="divide-y divide-stone-100">
                      {promos.map((p) => (
                        <div key={p.id} className="px-4 sm:px-5 py-3 flex items-center gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono font-bold text-stone-900">{p.code}</span>
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                                p.active ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-600 border border-red-200"
                              }`}>
                                {p.active ? "Active" : "Inactive"}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-[10px] text-stone-400">
                              {p.bonusSeconds > 0 && <span>+{p.bonusSeconds}s bonus</span>}
                              {p.discountPercent > 0 && <span>{p.discountPercent}% off</span>}
                              <span>Used {p.usedCount}{p.maxUses ? ` / ${p.maxUses}` : ""}</span>
                            </div>
                          </div>
                          <button
                            onClick={() => togglePromo(p.id, p.active)}
                            className={`px-3 py-1.5 rounded-lg text-[10px] font-semibold border transition ${
                              p.active
                                ? "bg-red-50 border-red-200 text-red-600 hover:bg-red-100"
                                : "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
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

            {/* ─── Buy for User (at Decart cost) ─── */}
            {tab === "buy" && (
              <div className="space-y-4">
                <p className="text-xs text-stone-500 -mt-2">
                  Purchase credits for any user at Decart&apos;s original cost — no markup, you pay the real API price.
                </p>

                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700/80">Decart API cost</div>
                  <div className="font-display text-xl font-extrabold text-emerald-700">
                    ${DECART_COST_PER_SEC}<span className="text-sm font-bold">/sec</span>
                    <span className="text-stone-500 text-sm font-semibold mx-2">=</span>
                    GH {(DECART_COST_PER_SEC * 60 * GHS_PER_USD).toFixed(0)}/min
                  </div>
                </div>

                <div className="rounded-lg bg-white border border-stone-200 p-4 sm:p-5">
                  <h3 className="text-sm font-bold mb-4">Purchase for a user</h3>
                  {buyMsg && (
                    <div className={`mb-4 px-3 py-2 rounded-lg text-xs ${
                      buyMsg.includes("not found") || buyMsg.includes("Failed")
                        ? "bg-red-50 border border-red-200 text-red-600"
                        : "bg-emerald-50 border border-emerald-200 text-emerald-700"
                    }`}>
                      {buyMsg}
                    </div>
                  )}
                  <form onSubmit={handleBuyForUser} className="space-y-5">
                    <div>
                      <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-[0.14em] mb-1">User email</label>
                      <input
                        type="email"
                        value={buyEmail}
                        onChange={(e) => setBuyEmail(e.target.value)}
                        placeholder="user@example.com"
                        required
                        className="w-full max-w-md px-3 py-2 bg-white border border-stone-300 rounded-lg text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:border-[#ff4a1d] focus:ring-2 focus:ring-[#ff4a1d]/10 transition"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-[0.14em] mb-2">Pick a pack (at Decart cost)</label>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                        {DECART_PACKS.map((pack) => (
                          <button
                            key={pack.id}
                            type="button"
                            onClick={() => setBuyPackId(pack.id)}
                            className={`p-3 rounded-lg border text-left transition ${
                              buyPackId === pack.id
                                ? "bg-[#ff4a1d]/5 border-[#ff4a1d]/50 ring-1 ring-[#ff4a1d]/20"
                                : "bg-white border-stone-200 hover:border-stone-300"
                            }`}
                          >
                            <div className="text-[10px] font-bold text-stone-400">{pack.name}</div>
                            <div className="text-sm font-bold text-stone-900 mt-0.5">{pack.timeLabel}</div>
                            <div className="text-xs font-bold text-[#e84314] mt-0.5">GH {pack.costGHS}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={buyLoading || !buyEmail || !buyPackId}
                      className="w-full max-w-md py-3 bg-stone-900 hover:bg-stone-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition"
                    >
                      {buyLoading ? "Processing…" : buyPackId ? `Add ${DECART_PACKS.find((p) => p.id === buyPackId)?.timeLabel || ""} to user (GH ${DECART_PACKS.find((p) => p.id === buyPackId)?.costGHS || 0})` : "Select a pack"}
                    </button>
                  </form>
                </div>

                {/* Comparison table */}
                <div className="rounded-lg bg-white border border-stone-200 overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-stone-100">
                    <h3 className="text-sm font-bold">User price vs your cost</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-stone-50 text-stone-500 text-[10px] uppercase tracking-[0.14em]">
                          <th className="text-left px-4 py-2.5 font-bold">Pack</th>
                          <th className="text-left px-4 py-2.5 font-bold">Time</th>
                          <th className="text-left px-4 py-2.5 font-bold">User pays</th>
                          <th className="text-left px-4 py-2.5 font-bold">Decart cost</th>
                          <th className="text-left px-4 py-2.5 font-bold">Profit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {USER_PACKS.map((up) => {
                          const dp = DECART_PACKS.find((d) => d.id === up.id)!;
                          return (
                            <tr key={up.id} className="border-t border-stone-100">
                              <td className="px-4 py-2.5 text-xs font-semibold text-stone-900">{up.name}</td>
                              <td className="px-4 py-2.5 text-xs text-stone-500">{up.timeLabel}</td>
                              <td className="px-4 py-2.5 text-xs font-medium text-[#e84314]">GH {up.priceGHS.toLocaleString()}</td>
                              <td className="px-4 py-2.5 text-xs text-emerald-600">GH {dp.costGHS}</td>
                              <td className="px-4 py-2.5 text-xs font-semibold text-stone-900">GH {up.priceGHS - dp.costGHS}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* ─── Pricing ─── */}
            {tab === "pricing" && (
              <div className="space-y-4">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-4">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700/80">Decart API cost</div>
                  <div className="font-display text-xl font-extrabold text-emerald-700 mt-0.5">${DECART_COST_PER_SEC}/sec</div>
                  <div className="text-xs text-stone-600 mt-1">
                    = ${DECART_COST_PER_SEC * 60}/min = GH {(DECART_COST_PER_SEC * 60 * GHS_PER_USD).toFixed(0)}/min (at $1 = GH{GHS_PER_USD})
                  </div>
                </div>

                <div className="rounded-lg bg-white border border-stone-200 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-stone-50 text-stone-500 text-[10px] uppercase tracking-[0.14em]">
                          <th className="text-left px-4 py-2.5 font-bold">Pack</th>
                          <th className="text-left px-4 py-2.5 font-bold">Time</th>
                          <th className="text-left px-4 py-2.5 font-bold">User price</th>
                          <th className="text-left px-4 py-2.5 font-bold">Your cost</th>
                          <th className="text-left px-4 py-2.5 font-bold">Profit</th>
                          <th className="text-left px-4 py-2.5 font-bold">Margin</th>
                        </tr>
                      </thead>
                      <tbody>
                        {USER_PACKS.map((pack) => {
                          const dp = DECART_PACKS.find((d) => d.id === pack.id)!;
                          const profit = pack.priceGHS - dp.costGHS;
                          const margin = ((profit / pack.priceGHS) * 100).toFixed(0);
                          return (
                            <tr key={pack.id} className="border-t border-stone-100 hover:bg-stone-50/60 transition">
                              <td className="px-4 py-3 text-xs font-semibold text-stone-900">{pack.name}</td>
                              <td className="px-4 py-3 text-xs text-stone-500">{pack.timeLabel}</td>
                              <td className="px-4 py-3 text-xs font-medium text-[#e84314]">GH {pack.priceGHS.toLocaleString()}</td>
                              <td className="px-4 py-3 text-xs text-emerald-600">GH {dp.costGHS}</td>
                              <td className="px-4 py-3 text-xs font-semibold text-stone-900">GH {profit}</td>
                              <td className="px-4 py-3">
                                <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${
                                  parseInt(margin) >= 50 ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-amber-50 text-amber-700 border border-amber-200"
                                }`}>
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

                <div className="rounded-lg bg-white border border-stone-200 overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-stone-100">
                    <h3 className="text-sm font-bold">Pricing strategy</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 divide-y divide-stone-100 sm:divide-y-0 sm:divide-x">
                    <div className="px-5 py-4">
                      <div className="text-[10px] text-stone-400 uppercase tracking-wider">Market average</div>
                      <div className="font-display text-lg font-extrabold mt-1">~GH 50/min</div>
                    </div>
                    <div className="px-5 py-4">
                      <div className="text-[10px] text-stone-400 uppercase tracking-wider">Your cost</div>
                      <div className="font-display text-lg font-extrabold text-emerald-600 mt-1">GH 30/min</div>
                    </div>
                    <div className="px-5 py-4">
                      <div className="text-[10px] text-stone-400 uppercase tracking-wider">Your price</div>
                      <div className="font-display text-lg font-extrabold text-[#e84314] mt-1">GH 33–50/min</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ─── Logs ─── */}
            {tab === "logs" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-lg font-extrabold tracking-tight">All actions ({logs.length})</h2>
                  <button onClick={loadData} className="px-3 py-1.5 bg-white hover:bg-stone-50 border border-stone-300 rounded-lg text-[10px] font-semibold text-stone-600 transition">
                    Refresh
                  </button>
                </div>

                <div className="rounded-lg bg-white border border-stone-200 overflow-hidden">
                  {logs.length === 0 ? (
                    <div className="text-center py-12 text-stone-400 text-xs">No admin actions logged yet</div>
                  ) : (
                    <div className="divide-y divide-stone-100">
                      {logs.map((log) => (
                        <div key={log.id} className="px-4 sm:px-5 py-3 flex items-start gap-3">
                          <span className={`w-7 h-7 rounded-md grid place-items-center text-[10px] font-bold flex-shrink-0 ${
                            log.action === "credit_user" || log.action === "buy_for_user" ? "bg-emerald-50 text-emerald-600" :
                            log.action === "create_promo" ? "bg-[#ff4a1d]/10 text-[#e84314]" :
                            log.action?.includes("deactivate") ? "bg-red-50 text-red-600" :
                            "bg-stone-100 text-stone-500"
                          }`}>
                            {log.action === "credit_user" || log.action === "buy_for_user" ? "+" : log.action === "create_promo" ? "P" : "A"}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold text-stone-900">
                              {log.action?.replace(/_/g, " ")}
                            </div>
                            {log.details && <div className="text-[10px] text-stone-500 mt-0.5 truncate">{log.details}</div>}
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[10px] text-stone-400">
                              <span>by {log.adminEmail}</span>
                              {log.targetUser && <span>→ {log.targetUser}</span>}
                              {log.createdAt && <span>· {new Date(log.createdAt).toLocaleString()}</span>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
