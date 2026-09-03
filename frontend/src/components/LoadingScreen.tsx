"use client";

import { useEffect, useRef, useState } from "react";

/**
 * LoadingScreen — full-screen splash with SVG logo draw, particles,
 * streaming waves, and GSAP sequencing. Auto-dismisses after animation.
 *
 * Drop <LoadingScreen /> into layout.tsx and it handles everything.
 */
const SPLASH_KEY = "savatar-splash-seen";

export default function LoadingScreen() {
  // Start hidden; decide visibility after mount to avoid SSR hydration mismatch.
  const [visible, setVisible] = useState(false);
  const masterTLRef = useRef<any>(null);

  // Decide on first mount whether to show the splash
  useEffect(() => {
    if (sessionStorage.getItem(SPLASH_KEY)) return;
    sessionStorage.setItem(SPLASH_KEY, "1");
    setVisible(true);
  }, []);

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

      // ── Generate particles ──
      const particlesEl = document.getElementById("particles");
      if (particlesEl) {
        particlesEl.innerHTML = "";
        for (let i = 0; i < 30; i++) {
          const p = document.createElement("div");
          p.className = "particle";
          p.style.left = `${Math.random() * 100}%`;
          p.style.top = `${Math.random() * 100}%`;
          p.style.setProperty("--size", `${2 + Math.random() * 4}px`);
          const isGreen = Math.random() > 0.7;
          p.style.setProperty(
            "--color",
            isGreen
              ? "rgba(34,197,94,0.12)"
              : `rgba(99,102,241,${0.06 + Math.random() * 0.12})`
          );
          particlesEl.appendChild(p);
        }
      }

      // ── Wave canvas ──
      const canvas = document.getElementById("waveCanvas") as HTMLCanvasElement;
      const ctx = canvas?.getContext("2d");
      let waveAnim: number | null = null;
      let waveActive = false;

      function resizeCanvas() {
        if (!canvas) return;
        canvas.width = canvas.parentElement!.offsetWidth * 2;
        canvas.height = canvas.parentElement!.offsetHeight * 2;
      }
      resizeCanvas();

      function drawWaves(time: number) {
        if (!waveActive || !ctx || !canvas) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const w = canvas.width;
        const h = canvas.height;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.strokeStyle =
            i === 0
              ? "rgba(99,102,241,0.25)"
              : i === 1
                ? "rgba(99,102,241,0.12)"
                : "rgba(129,140,248,0.08)";
          ctx.lineWidth = 1.5;
          for (let x = 0; x <= w; x += 2) {
            const y =
              h * 0.5 +
              Math.sin((x / w) * 4 + time * 0.002 + i * 1.2) * (8 + i * 4) +
              Math.sin((x / w) * 7 + time * 0.003 + i * 0.8) * (4 + i * 2);
            x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
        waveAnim = requestAnimationFrame(drawWaves);
      }

      // ── Master timeline ──
      const tl = gsap.timeline({
        delay: 0.3,
        onComplete: () => {
          waveActive = false;
          if (waveAnim) cancelAnimationFrame(waveAnim);
          setVisible(false);
        },
      });
      masterTLRef.current = tl;

      // Phase 0: Particles
      tl.to(".particle", {
        opacity: () => 0.3 + Math.random() * 0.5,
        y: () => -(20 + Math.random() * 40),
        duration: 2.5,
        stagger: { each: 0.05, from: "random" },
        ease: "none",
      }, 0);

      // Phase 1: Corners
      tl.to(["#cTL", "#cTR", "#cBL", "#cBR"], {
        opacity: 1,
        duration: 0.6,
        stagger: 0.08,
        ease: "power2.out",
      }, 0.2);

      // Phase 2: Glow
      tl.to("#logoGlow", { opacity: 1, duration: 1, ease: "power2.out" }, 0.3);
      tl.to("#logoGlow", {
        scale: 1.1,
        duration: 3,
        yoyo: true,
        ease: "sine.inOut",
      }, 0.3);

      // Phase 3: Logo
      tl.to("#logoWrap", { opacity: 1, duration: 0.3 }, 0.4);
      tl.to("#logoBg", {
        strokeDashoffset: 0,
        duration: 1.4,
        ease: "power2.inOut",
      }, 0.5);
      tl.to("#sPath", {
        strokeDashoffset: 0,
        duration: 1,
        ease: "power3.out",
      }, 1.0);
      tl.to("#logoDot", {
        attr: { r: 4 },
        duration: 0.35,
        ease: "back.out(5)",
      }, 1.6);

      // Phase 3d: Orbit ring
      tl.to("#orbitRing", { opacity: 0.25, duration: 0.5 }, 1.5);
      tl.to("#orbitRing", {
        attr: { "stroke-dashoffset": -50 },
        duration: 8,
        ease: "none",
      }, 1.5);

      // Phase 3e: Glow pulse on dot pop
      tl.to("#logoGlow", {
        scale: 1.3,
        opacity: 1,
        duration: 0.3,
        ease: "power2.out",
      }, 1.6);
      tl.to("#logoGlow", {
        scale: 1,
        duration: 0.8,
        ease: "power2.out",
      }, 1.9);

      // Phase 4: Title letters
      tl.to("#splTitle .char", {
        opacity: 1,
        y: 0,
        duration: 0.5,
        stagger: 0.06,
        ease: "power3.out",
      }, 2.0);

      // Phase 5: Tagline words
      tl.to("#splTagline .word", {
        opacity: 1,
        y: 0,
        duration: 0.4,
        stagger: 0.08,
        ease: "power2.out",
      }, 2.4);

      // Phase 6: Live indicator
      tl.to("#liveDot", { opacity: 1, duration: 0.4, ease: "power2.out" }, 2.6);

      // Phase 7: Loading bar + waves
      tl.to("#splBar", { opacity: 1, duration: 0.3 }, 2.8);
      tl.to("#splBarFill", {
        width: "100%",
        duration: 2,
        ease: "power1.inOut",
        onStart: () => {
          waveActive = true;
          drawWaves(0);
        },
      }, 2.8);
      tl.to("#waveContainer", { opacity: 1, duration: 0.5 }, 2.8);

      // Phase 8: Logo flies to navbar position
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

      // Fade out everything except the logo
      tl.to(
        ["#splTitle", "#splTagline", "#liveDot", "#orbitRing"],
        { opacity: 0, y: -15, duration: 0.4, stagger: 0.03, ease: "power2.in" },
        5.0
      );
      tl.to("#splBar", { opacity: 0, scaleX: 0.8, duration: 0.3, ease: "power2.in" }, 5.0);
      tl.to("#waveContainer", { opacity: 0, duration: 0.3 }, 5.0);
      tl.to(["#cTL", "#cTR", "#cBL", "#cBR"], { opacity: 0, duration: 0.2, stagger: 0.02 }, 5.0);
      tl.to("#logoGlow", { opacity: 0, duration: 0.3 }, 5.0);
      tl.to(".particle", { opacity: 0, duration: 0.3, stagger: 0.01 }, 5.0);

      // Logo flies to navbar position with a smooth ease
      tl.to("#logoWrap", {
        x: navTarget.x,
        y: navTarget.y,
        scale: navTarget.scale,
        duration: 0.9,
        ease: "power3.inOut",
      }, 5.1);

      // Splash bg fades out after logo has left center
      tl.to("#splash", {
        opacity: 0,
        pointerEvents: "none",
        duration: 0.5,
        ease: "power2.in",
        onComplete: () => {
          // Dismiss the splash from HERE (the last tween's own callback).
          // The master timeline never fires onComplete while a sibling has
          // an infinite repeat, so relying on the timeline callback left an
          // invisible z-9999 overlay mounted that blocked all clicks.
          waveActive = false;
          if (waveAnim) cancelAnimationFrame(waveAnim);
          masterTLRef.current?.kill();
          window.dispatchEvent(new Event("splash-logo-arrived"));
          setVisible(false);
        },
      }, 5.6);

      // Hard fallback: never let the splash linger past ~8s no matter what.
      const watchdog = window.setTimeout(() => {
        masterTLRef.current?.kill();
        window.dispatchEvent(new Event("splash-logo-arrived"));
        setVisible(false);
      }, 8000);
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
        #splash {
          position: fixed; inset: 0; background: #090909;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          z-index: 9999;
        }
        .particles { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
        .particle {
          position: absolute;
          width: var(--size, 3px); height: var(--size, 3px);
          background: var(--color, rgba(99,102,241,0.15));
          border-radius: 50%; opacity: 0;
        }
        .logo-glow {
          position: absolute; width: 260px; height: 260px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%);
          opacity: 0; filter: blur(40px); pointer-events: none;
        }
        .logo-wrap {
          width: 88px; height: 88px; margin-bottom: 28px;
          opacity: 0; position: relative; z-index: 2;
        }
        .logo-wrap svg { width: 100%; height: 100%; }
        .spl-title {
          font-family: var(--font-display), 'Manrope', sans-serif;
          font-size: 34px; font-weight: 800; letter-spacing: -0.02em;
          display: flex; overflow: hidden; position: relative; z-index: 2;
        }
        .spl-title .char {
          display: inline-block; opacity: 0; transform: translateY(100%);
        }
        .spl-tagline {
          font-size: 12px; color: #525252; letter-spacing: 0.14em;
          text-transform: uppercase; margin-top: 8px; overflow: hidden;
          display: flex; gap: 6px; position: relative; z-index: 2;
        }
        .spl-tagline .word {
          display: inline-block; opacity: 0; transform: translateY(12px);
        }
        .spl-bar-wrap {
          width: 180px; height: 2px; background: #1a1a1a; border-radius: 2px;
          margin-top: 44px; overflow: hidden; opacity: 0; position: relative; z-index: 2;
        }
        .spl-bar-fill {
          width: 0%; height: 100%;
          background: linear-gradient(90deg, #4f46e5, #6366f1, #818cf8);
          border-radius: 2px; position: relative;
        }
        .spl-bar-fill::after {
          content: ''; position: absolute; inset: 0;
          background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 50%, transparent 100%);
          transform: translateX(-100%);
          animation: shimmer 1.2s ease-in-out infinite;
        }
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
        .wave-container {
          position: absolute; bottom: 0; left: 0; right: 0;
          height: 60px; overflow: hidden; opacity: 0;
        }
        .live-dot {
          position: absolute; top: 24px; right: 24px;
          display: flex; align-items: center; gap: 8px;
          opacity: 0; z-index: 2;
        }
        .live-dot .dot {
          width: 7px; height: 7px; background: #22c55e; border-radius: 50%;
          box-shadow: 0 0 8px rgba(34,197,94,0.5);
          animation: livePulse 1.5s ease-in-out infinite;
        }
        .live-dot span {
          font-size: 10px; font-weight: 700; letter-spacing: 0.14em;
          text-transform: uppercase; color: #22c55e;
        }
        @keyframes livePulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 8px rgba(34,197,94,0.5); }
          50% { opacity: 0.4; box-shadow: 0 0 2px rgba(34,197,94,0.2); }
        }
        .corner { position: absolute; opacity: 0; z-index: 2; }
        .corner-tl { top: 28px; left: 28px; }
        .corner-tr { top: 28px; right: 28px; }
        .corner-bl { bottom: 28px; left: 28px; }
        .corner-br { bottom: 28px; right: 28px; }
        .corner svg { width: 24px; height: 24px; }
      `}</style>

      <div id="splash">
        <div className="particles" id="particles" />
        <div className="logo-glow" id="logoGlow" />

        {/* Corner accents */}
        <div className="corner corner-tl" id="cTL">
          <svg viewBox="0 0 24 24" fill="none"><path d="M1 23V1h22" stroke="#6366f1" strokeWidth="1" opacity="0.3" /></svg>
        </div>
        <div className="corner corner-tr" id="cTR">
          <svg viewBox="0 0 24 24" fill="none"><path d="M23 23V1H1" stroke="#6366f1" strokeWidth="1" opacity="0.3" /></svg>
        </div>
        <div className="corner corner-bl" id="cBL">
          <svg viewBox="0 0 24 24" fill="none"><path d="M1 1v22h22" stroke="#6366f1" strokeWidth="1" opacity="0.3" /></svg>
        </div>
        <div className="corner corner-br" id="cBR">
          <svg viewBox="0 0 24 24" fill="none"><path d="M23 1v22H1" stroke="#6366f1" strokeWidth="1" opacity="0.3" /></svg>
        </div>

        {/* Live indicator */}
        <div className="live-dot" id="liveDot">
          <div className="dot" />
          <span>Live</span>
        </div>

        {/* SVG Logo */}
        <div className="logo-wrap" id="logoWrap">
          <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <rect
              id="logoBg" x="1" y="1" width="46" height="46" rx="11"
              stroke="#6366f1" strokeWidth="2" fill="none"
              strokeDasharray="172" strokeDashoffset="172"
            />
            <path
              id="sPath"
              d="M16 14c0-2.2 1.8-4 4-4h8c2.2 0 4 1.8 4 4v2c0 1.1-.9 2-2 2h-10c-2.2 0-4 1.8-4 4v2c0 2.2 1.8 4 4 4h12c2.2 0 4 1.8 4 4v2c0 2.2-1.8 4-4 4h-8c-2.2 0-4-1.8-4-4v-2"
              stroke="white" strokeWidth="2.5" strokeLinecap="round" fill="none"
              strokeDasharray="120" strokeDashoffset="120" filter="url(#glow)"
            />
            <circle id="logoDot" cx="38" cy="10" r="0" fill="#22c55e" />
            <circle
              id="orbitRing" cx="24" cy="24" r="30"
              stroke="#6366f1" strokeWidth="0.5" fill="none"
              opacity="0" strokeDasharray="4 8" strokeDashoffset="0"
            />
          </svg>
        </div>

        <div className="spl-title" id="splTitle" />
        <div className="spl-tagline" id="splTagline">
          <span className="word">AI</span>
          <span className="word">FULL</span>
          <span className="word">BODY</span>
          <span className="word">SWAP</span>
          <span className="word">FOR</span>
          <span className="word">CREATORS</span>
        </div>

        <div className="spl-bar-wrap" id="splBar">
          <div className="spl-bar-fill" id="splBarFill" />
        </div>

        <div className="wave-container" id="waveContainer">
          <canvas id="waveCanvas" style={{ width: "100%", height: "100%" }} />
        </div>
      </div>
    </>
  );
}
