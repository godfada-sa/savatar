"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * LoadingScreen — full-screen brand intro. Minimal editorial lockup:
 * the coral logo mark draws itself in (exactly matching the navbar logo),
 * the wordmark staggers in, a hairline bar fills, then the logo flies to
 * the navbar position and the splash fades. Theme-aware: paper in light
 * mode, deep ink in dark mode. No glow blobs, particles, or other
 * AI-template flourishes.
 *
 * Drop <LoadingScreen /> into layout.tsx and it handles everything.
 */
const SPLASH_KEY = "savatar-splash-seen";
const INTRO_COOKIE = "savatar_intro_seen";

/** Mark the intro as seen for this browser session (server-readable). */
function markIntroSeen() {
  try {
    document.cookie = `${INTRO_COOKIE}=1; path=/; SameSite=Lax`;
  } catch {
    // Storage may be unavailable (private mode) — the sessionStorage flag still applies.
  }
}

// Watch rooms and OBS browser sources are media surfaces (an OBS capture would
// record the splash over the stream) — they never show the brand intro.
function isMediaPath(pathname: string | null) {
  return !!pathname && (pathname.startsWith("/watch/") || pathname.startsWith("/obs/"));
}

export default function LoadingScreen({ introSeen = false }: { introSeen?: boolean }) {
  const masterTLRef = useRef<any>(null);
  const pathname = usePathname();

  // Include the splash in the initial server-rendered HTML so the first paint
  // IS the splash — no flash of the page underneath. Landing replays on
  // every full load; every other page only before the intro has played once
  // this browser session. The mount effect below governs the client-side cases
  // the server couldn't predict.
  const [visible, setVisible] = useState(() => {
    if (pathname === "/") return true;
    if (isMediaPath(pathname)) return false;
    return !introSeen;
  });

  // Runs once per full page load (SPA navigations don't remount this component,
  // so client-side route changes never re-trigger the splash).
  useEffect(() => {
    if (isMediaPath(pathname)) return;
    if (pathname === "/") {
      markIntroSeen();
      setVisible(true);
      return;
    }
    // SSR already painted the intro — it is showing right now, so record it
    // (covers first loads this tab missed the flag for).
    if (visible) {
      markIntroSeen();
      sessionStorage.setItem(SPLASH_KEY, "1");
      return;
    }
    // Intro wasn't in the first paint (media pages excluded above, or a
    // response the server rendered without it): show it once per browser
    // session. Skip if already shown in this tab or elsewhere.
    if (introSeen || sessionStorage.getItem(SPLASH_KEY)) return;
    markIntroSeen();
    sessionStorage.setItem(SPLASH_KEY, "1");
    setVisible(true);
  }, []);

  // The splash follows the active theme (paper in light, ink in dark), so
  // while it is on screen the root background must match — otherwise Safari
  // paints the opposite color at the notch, home indicator, and overscroll
  // edges around the fixed overlay. The .splash-active rules use !important
  // so they beat inline root styling set by pages underneath (e.g. the
  // landing page painting html/body itself).
  useEffect(() => {
    if (!visible) return;
    document.documentElement.classList.add("splash-active");
    return () => document.documentElement.classList.remove("splash-active");
  }, [visible]);

  useEffect(() => {
    if (!visible) return;

    // Dynamic import GSAP (client-only)
    const init = async () => {
      const gsapModule = await import("gsap");
      const gsap = gsapModule.default;

      // ── Generate title letters ──
      const titleEl = document.getElementById("splTitle");
      if (titleEl) {
        titleEl.innerHTML = "";
        "Savatar".split("").forEach((ch) => {
          const span = document.createElement("span");
          span.className = "char";
          span.textContent = ch;
          titleEl.appendChild(span);
        });
      }

      // ── Master timeline ──
      const tl = gsap.timeline({
        delay: 0.25,
      });
      masterTLRef.current = tl;

      // Phase 1: Logo mark draws itself in — coral square outline, coral
      // fill, white S, then the live dot — ending as the exact navbar logo.
      tl.to("#logoWrap", { opacity: 1, y: 0, duration: 0.3 }, 0.1);
      tl.to("#logoBg", {
        strokeDashoffset: 0,
        duration: 1.2,
        ease: "power2.inOut",
      }, 0.2);
      tl.to("#logoFill", {
        opacity: 1,
        duration: 0.45,
        ease: "power2.out",
      }, 1.05);
      tl.to("#sPath", {
        strokeDashoffset: 0,
        duration: 0.8,
        ease: "power3.out",
      }, 1.2);
      tl.to("#logoDot", {
        attr: { r: 4 },
        duration: 0.3,
        ease: "back.out(3)",
      }, 1.7);

      // Phase 2: Wordmark letters
      tl.to("#splTitle .char", {
        opacity: 1,
        y: 0,
        duration: 0.5,
        stagger: 0.05,
        ease: "power3.out",
      }, 1.85);

      // Phase 3: Hairline progress bar
      tl.to("#splBar", { opacity: 1, duration: 0.3 }, 2.4);
      tl.to("#splBarFill", {
        width: "100%",
        duration: 1.8,
        ease: "power1.inOut",
      }, 2.4);

      // Phase 4: Logo flies to navbar position
      // Find the navbar logo to get its screen position
      const navLogo = document.querySelector("[data-nav-logo]") as HTMLElement | null;
      const logoWrap = document.getElementById("logoWrap");
      let navTarget = { x: 0, y: 0, scale: 1 };
      if (navLogo && logoWrap) {
        const navRect = navLogo.getBoundingClientRect();
        const logoRect = logoWrap.getBoundingClientRect();
        const scaleX = navRect.width / logoRect.width;
        const scaleY = navRect.height / logoRect.height;
        const targetScale = Math.min(scaleX, scaleY);
        navTarget = {
          x: navRect.left + navRect.width / 2 - (logoRect.left + logoRect.width / 2),
          y: navRect.top + navRect.height / 2 - (logoRect.top + logoRect.height / 2),
          scale: targetScale,
        };
      }

      // Fade out the wordmark and bar, keep the logo
      tl.to(["#splTitle", "#splBar"], {
        opacity: 0,
        y: -12,
        duration: 0.35,
        stagger: 0.05,
        ease: "power2.in",
      }, 4.45);

      // Logo flies to navbar position with a smooth ease
      tl.to("#logoWrap", {
        x: navTarget.x,
        y: navTarget.y,
        scale: navTarget.scale,
        duration: 0.85,
        ease: "power3.inOut",
      }, 4.55);

      // Splash bg fades out after logo has left center
      tl.to("#splash", {
        opacity: 0,
        pointerEvents: "none",
        duration: 0.45,
        ease: "power2.in",
        onComplete: () => {
          // Dismiss the splash from HERE (the last tween's own callback).
          masterTLRef.current?.kill();
          window.dispatchEvent(new Event("splash-logo-arrived"));
          setVisible(false);
        },
      }, 5.05);

      // Hard fallback: never let the splash linger past ~7s no matter what.
      const watchdog = window.setTimeout(() => {
        masterTLRef.current?.kill();
        window.dispatchEvent(new Event("splash-logo-arrived"));
        setVisible(false);
      }, 7000);
    };

    init();

    return () => {
      masterTLRef.current?.kill();
    };
  }, [visible]);
  if (!visible) return null;

  return (
    <>
      <style>{`
        html.splash-active { background: #faf9f7 !important; }
        html.splash-active body { background: #faf9f7 !important; }
        html.dark.splash-active { background: #0d0c0a !important; }
        html.dark.splash-active body { background: #0d0c0a !important; }

        #splash {
          --splash-bg: #faf9f7;
          --splash-ink: #1c1917;
          --splash-track: #e7e2da;
          --splash-accent: #ff4a1d;
          position: fixed; inset: 0; background: var(--splash-bg);
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          z-index: 9999;
        }
        html.dark #splash {
          --splash-bg: #0d0c0a;
          --splash-ink: #f7f2ea;
          --splash-track: #262220;
        }

        .logo-cluster {
          position: relative; width: 88px; height: 88px;
          margin-bottom: 26px; z-index: 2;
        }
        .logo-wrap {
          width: 100%; height: 100%;
          opacity: 0; transform: translateY(12px); position: relative;
        }
        .logo-wrap svg { width: 100%; height: 100%; }
        #logoFill { opacity: 0; }

        .spl-title {
          font-family: var(--font-display), 'Manrope', sans-serif;
          font-size: 38px; font-weight: 800; letter-spacing: -0.035em;
          color: var(--splash-ink);
          display: flex; overflow: hidden; position: relative; z-index: 2;
        }
        .spl-title .char:nth-child(1) {
          color: var(--splash-accent);
        }
        .spl-title .char {
          display: inline-block; opacity: 0; transform: translateY(100%);
        }

        .spl-bar-wrap {
          width: 180px; height: 2px; background: var(--splash-track); border-radius: 2px;
          margin-top: 34px; overflow: hidden; opacity: 0; position: relative; z-index: 2;
        }
        .spl-bar-fill {
          width: 0%; height: 100%;
          background: var(--splash-accent);
          border-radius: 2px; position: relative;
        }
      `}</style>

      <div id="splash" className="force-dark">
        {/* SVG logo — draws in to become the exact navbar badge */}
        <div className="logo-cluster">
          <div className="logo-wrap" id="logoWrap">
            <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect
                id="logoBg" x="1" y="1" width="46" height="46" rx="12"
                stroke="#ff4a1d" strokeWidth="2" fill="none"
                strokeDasharray="172" strokeDashoffset="172"
              />
              <rect
                id="logoFill" x="1" y="1" width="46" height="46" rx="12"
                fill="#ff4a1d" opacity="0"
              />
              <path
                id="sPath"
                d="M16 14c0-2.2 1.8-4 4-4h8c2.2 0 4 1.8 4 4v2c0 1.1-.9 2-2 2h-10c-2.2 0-4 1.8-4 4v2c0 2.2 1.8 4 4 4h12c2.2 0 4 1.8 4 4v2c0 2.2-1.8 4-4 4h-8c-2.2 0-4-1.8-4-4v-2"
                stroke="white" strokeWidth="2.5" strokeLinecap="round" fill="none"
                strokeDasharray="120" strokeDashoffset="120"
              />
              <circle id="logoDot" cx="38" cy="10" r="0" fill="#22c55e" />
            </svg>
          </div>
        </div>

        <div className="spl-title" id="splTitle" />

        <div className="spl-bar-wrap" id="splBar">
          <div className="spl-bar-fill" id="splBarFill" />
        </div>
      </div>
    </>
  );
}