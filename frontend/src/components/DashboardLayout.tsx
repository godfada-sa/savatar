"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import ThemeToggle from "@/components/ThemeToggle";

const NAV_ITEMS = [
  {
    label: "Studio",
    href: "/dashboard",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    label: "Feed",
    href: "/feed",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
      </svg>
    ),
  },
  {
    label: "AI & OBS",
    href: "/ai-obs",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
      </svg>
    ),
  },
  {
    label: "Analytics",
    href: "/analytics",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
  },
  {
    label: "Credits",
    href: "/credits",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
      </svg>
    ),
  },
  {
    label: "Transactions",
    href: "/transactions",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
    ),
  },
  {
    label: "Settings",
    href: "/settings",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, userData, loading: authLoading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const mountedRef = useState(() => ({ current: false }))[0];

  useEffect(() => {
    mountedRef.current = true;
  }, []);

  useEffect(() => {
    if (!authLoading && !user && mountedRef.current) {
      router.push("/login");
    }
  }, [user, authLoading, router, mountedRef]);

  // Close sidebar on route change (mobile)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setSidebarOpen(false));
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-[#faf9f7] flex items-center justify-center">
        <div className="text-stone-500 text-sm">Loading...</div>
      </div>
    );
  }

  const balanceMinutes = ((userData?.wallet?.balanceSeconds || 0) / 60).toFixed(1);
  const plan = userData?.plan || "Standard";
  const currentSection = NAV_ITEMS.find((item) => item.href === pathname)?.label ?? "";
  const userInitial = (user.email?.[0] || "S").toUpperCase();

  return (
    <div className="min-h-screen bg-[#f4f1ed] text-stone-900 flex flex-col">
      {/* Top Status Bar */}
      <header className="flex items-center gap-2 sm:gap-3 px-2 sm:px-4 py-2 border-b border-stone-200 bg-white">
        {/* Mobile hamburger */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label="Toggle navigation"
          className="lg:hidden flex items-center justify-center w-9 h-9 rounded-lg bg-white border border-stone-200 text-stone-600 hover:text-stone-900 transition flex-shrink-0"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {sidebarOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>

        <ThemeToggle className="border border-stone-200 bg-white text-stone-600 hover:text-stone-900 flex-shrink-0" />

        {/* Current section eyebrow */}
        <div className="hidden md:flex items-center gap-2 min-w-0 flex-shrink-0">
          <span className="w-1.5 h-1.5 rounded-[3px] bg-[#ff4a1d]" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-stone-400 truncate">{currentSection}</span>
        </div>

        {/* Status deck — one ink console strip instead of scattered pills */}
        <div className="ml-auto flex items-stretch min-w-0 overflow-hidden rounded-xl bg-[#1c1917] text-white shadow-[0_4px_18px_-10px_rgba(28,25,23,0.55)]">
          {/* Credits — always visible */}
          <div className="flex items-center gap-2.5 px-3 sm:px-3.5 py-1.5 whitespace-nowrap">
            <div className="flex flex-col gap-0.5 leading-none">
              <span className="text-[8px] font-bold uppercase tracking-[0.2em] text-stone-400">Credits</span>
              <span className="font-display text-sm sm:text-base font-extrabold leading-none tracking-tight">{balanceMinutes}m</span>
            </div>
          </div>

          {/* Plan — sm+ */}
          <div className="hidden sm:flex items-center px-3.5 py-1.5 border-l border-white/10 whitespace-nowrap">
            <div className="flex flex-col gap-0.5 leading-none">
              <span className="text-[8px] font-bold uppercase tracking-[0.2em] text-stone-400">Plan</span>
              <span className="text-[13px] font-bold leading-none capitalize">{plan}</span>
            </div>
          </div>

          {/* System — md+ */}
          <div className="hidden md:flex items-center px-3.5 py-1.5 border-l border-white/10 whitespace-nowrap">
            <div className="flex flex-col gap-1 leading-none">
              <span className="text-[8px] font-bold uppercase tracking-[0.2em] text-stone-400">System</span>
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 live-pulse" />
                <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-emerald-300">Ready</span>
              </span>
            </div>
          </div>

          {/* User — lg+ */}
          <div className="hidden lg:flex items-center gap-2.5 px-3.5 py-1.5 border-l border-white/10 min-w-0">
            <span className="grid place-items-center w-6 h-6 rounded-full bg-[#ff4a1d]/20 text-[#ff8a68] text-[11px] font-bold uppercase flex-shrink-0">{userInitial}</span>
            <span className="text-[11px] font-medium text-stone-200 truncate max-w-[150px]">{user.email}</span>
          </div>
        </div>
      </header>

      {/* Body: Sidebar + Content */}
      <div className="flex flex-1 min-h-0 relative">
        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-30 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Left Sidebar */}
        <aside
          className={`fixed lg:static inset-y-0 left-0 z-40 w-56 flex-shrink-0 border-r border-stone-200 bg-white flex flex-col transition-transform duration-200 ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
          }`}
        >
          {/* Logo */}
          <div className="px-4 py-3 border-b border-stone-200 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <img src="/logo.svg" alt="Savatar" className="w-7 h-7" />
              <span className="font-semibold text-sm text-stone-900">Savatar</span>
            </Link>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden p-1 rounded text-neutral-400 hover:text-stone-900"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition ${
                    isActive
                      ? "bg-[#ff4a1d]/10 text-[#e84314] font-semibold"
                      : "text-stone-500 hover:bg-stone-100 hover:text-stone-900"
                  }`}
                >
                  <span className="flex-shrink-0">{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Community */}
          <div className="px-3 py-3 border-t border-stone-200 hidden sm:block">
            <div className="text-xs font-semibold text-stone-900 mb-1">Community</div>
            <p className="text-[10px] text-stone-500 mb-2">Join our groups for updates and support.</p>
            <div className="space-y-1.5">
              <a href="https://t.me/saf_ful" target="_blank" rel="noreferrer" className="block px-3 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-[11px] font-medium text-center transition">
                Message on Telegram
              </a>
              <a href="https://wa.me/233256238978" target="_blank" rel="noreferrer" className="block px-3 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-[11px] font-medium text-center transition">
                Message on WhatsApp
              </a>
            </div>
          </div>

          {/* Logout */}
          <div className="px-3 pb-3">
            <button
              onClick={() => {
                logout();
                router.push("/login");
              }}
              className="w-full px-3 py-2 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs font-medium text-center transition"
            >
              Log out
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
