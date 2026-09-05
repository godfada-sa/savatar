"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import ThemeToggle from "@/components/ThemeToggle";

interface SiteLink {
  label: string;
  href: string;
}

interface SiteNavbarProps {
  /** Center (desktop) and mobile-menu links. `#anchor` hrefs render as <a>. */
  links?: SiteLink[];
  /**
   * Landing-page only: hides the navbar logo until the intro splash fires
   * "splash-logo-arrived" (the splash logo travels to this spot). Legal and
   * other pages keep the logo always visible.
   */
  splashHandoff?: boolean;
}

/**
 * Shared responsive header for the public (light-paper) pages: landing, terms,
 * privacy. `sticky` rather than `fixed` on purpose — dark mode is a CSS filter
 * inversion on `.app-root`, and Safari composites `position: fixed` + backdrop
 * blur outside that filtered subtree (leaving a white, un-inverted header in
 * dark mode). A sticky nav stays inside the scroll container and inverts like
 * the rest of the page.
 */
export default function SiteNavbar({ links = [], splashHandoff = false }: SiteNavbarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [logoVisible, setLogoVisible] = useState(!splashHandoff);

  useEffect(() => {
    if (!splashHandoff) return;
    const onArrived = () => setLogoVisible(true);
    window.addEventListener("splash-logo-arrived", onArrived);
    // Splash was skipped (already seen this session): show the logo immediately.
    // When the splash plays, the LoadingScreen fires splash-logo-arrived once
    // its logo lands in the navbar position, so we keep the logo hidden until
    // then.
    if (sessionStorage.getItem("savatar-splash-seen")) {
      setLogoVisible(true);
    }
    return () => window.removeEventListener("splash-logo-arrived", onArrived);
  }, [splashHandoff]);

  return (
    <nav className="sticky top-0 z-50 border-b border-stone-200 bg-[#faf9f7]/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Savatar home">
          {splashHandoff && (
            <span
              data-nav-logo
              className={`transition-opacity duration-300 ${logoVisible ? "opacity-100" : "opacity-0"}`}
            >
              <Image src="/logo.svg" alt="" width={30} height={30} priority />
            </span>
          )}
          {!splashHandoff && <Image src="/logo.svg" alt="" width={30} height={30} priority />}
          <span className="font-display text-[15px] font-bold tracking-[-0.02em] text-stone-900">
            Savatar
          </span>
        </Link>

        <div className="hidden items-center gap-8 text-[13px] font-medium text-stone-500 md:flex">
          {links.map((link) =>
            link.href.startsWith("#") ? (
              <a key={link.href + link.label} href={link.href} className="transition-colors hover:text-stone-900">
                {link.label}
              </a>
            ) : (
              <Link key={link.href + link.label} href={link.href} className="transition-colors hover:text-stone-900">
                {link.label}
              </Link>
            ),
          )}
        </div>

        <div className="flex items-center gap-2.5">
          <ThemeToggle className="border border-stone-300 bg-white text-stone-600 hover:text-stone-900" />
          <Link
            href="/login"
            className="hidden px-3 py-2 text-[13px] font-medium text-stone-600 transition-colors hover:text-stone-900 sm:inline-flex"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="hidden rounded-md bg-[#ff4a1d] px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-[#e84314] sm:inline-flex"
          >
            Get started
          </Link>
          <button
            type="button"
            aria-label="Toggle navigation"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((open) => !open)}
            className="rounded-md border border-stone-300 p-2 text-stone-700 md:hidden"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.8}
                d={mobileOpen ? "M6 18L18 6M6 6l12 12" : "M4 7h16M4 12h16M4 17h16"}
              />
            </svg>
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="border-t border-stone-200 bg-[#faf9f7] px-5 py-5 md:hidden">
          <div className="flex flex-col gap-4 text-sm font-medium text-stone-700">
            {links.map((link) =>
              link.href.startsWith("#") ? (
                <a key={link.href + link.label} href={link.href} onClick={() => setMobileOpen(false)}>
                  {link.label}
                </a>
              ) : (
                <Link key={link.href + link.label} href={link.href} onClick={() => setMobileOpen(false)}>
                  {link.label}
                </Link>
              ),
            )}
            <Link href="/login" onClick={() => setMobileOpen(false)}>
              Sign in
            </Link>
            <Link
              href="/signup"
              onClick={() => setMobileOpen(false)}
              className="rounded-md bg-[#ff4a1d] px-4 py-3 text-center font-semibold text-white"
            >
              Get started
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}
