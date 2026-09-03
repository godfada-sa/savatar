"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, useEffect } from "react";
import ThemeToggle from "@/components/ThemeToggle";

// Light, warm "paper" theme. Brand accent is a live-broadcast coral — not the
// indigo/purple AI-template default. Studio (dashboard) stays dark; the
// marketing page is intentionally light with straight edges and hairline
// borders instead of glow blobs and uniform rounded cards.

const features = [
  {
    title: "Character replacement",
    description: "Transform your camera into a character, brand mascot, or custom identity from a single reference.",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M15.75 6.75a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 20.25a7.5 7.5 0 0115 0" />
    ),
  },
  {
    title: "Live style control",
    description: "Move between realistic, illustrated, cinematic, and branded looks without stopping your session.",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-3.421-3.419a15.996 15.996 0 014.648-4.763l5.814-3.876a1.151 1.151 0 011.597 1.597L17.68 9.855a15.995 15.995 0 01-4.763 4.648" />
    ),
  },
  {
    title: "Background control",
    description: "Place your stream in a polished environment without a green screen or a complicated studio setup.",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 19.5h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z" />
    ),
  },
  {
    title: "Shareable live rooms",
    description: "Create a watch link for viewers, track attendance, and keep the conversation beside your broadcast.",
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M15.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
    ),
  },
];

const steps = [
  {
    number: "01",
    title: "Connect your camera",
    description: "Open the studio and allow camera access. Nothing needs to be installed.",
  },
  {
    number: "02",
    title: "Choose a direction",
    description: "Select a mode, add a prompt, and review the transformed output before going live.",
  },
  {
    number: "03",
    title: "Start your room",
    description: "Go live, share your watch link, and manage the session from one workspace.",
  },
];

const plans = [
  {
    name: "Starter",
    credits: "300 credits",
    price: "GH 139",
    duration: "~2.5 min AI streaming",
    description: "For trying a focused creative idea.",
    features: ["All transformation modes", "Live room access", "Viewer chat"],
  },
  {
    name: "Basic",
    credits: "1,000 credits",
    price: "GH 439",
    duration: "~8 min AI streaming",
    description: "For short shows and product demos.",
    features: ["All transformation modes", "Live room access", "Viewer chat"],
    featured: true,
  },
  {
    name: "Pro",
    credits: "2,000 credits",
    price: "GH 839",
    duration: "~17 min AI streaming",
    description: "For regular live sessions and events.",
    features: ["All transformation modes", "Live room access", "Viewer chat"],
  },
  {
    name: "Ultimate",
    credits: "5,000 credits",
    price: "GH 2,189",
    duration: "~42 min AI streaming",
    description: "For longer broadcasts and campaigns.",
    features: ["All transformation modes", "Live room access", "Viewer chat"],
  },
  {
    name: "Creator",
    credits: "12,000 credits",
    price: "GH 5,039",
    duration: "~100 min AI streaming",
    description: "For professional creators and agencies.",
    features: ["All transformation modes", "Live room access", "Viewer chat", "Priority support"],
  },
];

function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [logoVisible, setLogoVisible] = useState(false);

  useEffect(() => {
    const onArrived = () => setLogoVisible(true);
    window.addEventListener("splash-logo-arrived", onArrived);
    // Splash was skipped (already seen this session): show the logo immediately.
    // When the splash plays, the LoadingScreen fires splash-logo-arrived once
    // its logo lands in the navbar position, so we keep the logo hidden until
    // then. (Previously this condition was inverted — the logo waited for an
    // event that never fires when the splash is skipped, so a refresh made it
    // disappear.)
    if (sessionStorage.getItem("savatar-splash-seen")) {
      setLogoVisible(true);
    }
    return () => window.removeEventListener("splash-logo-arrived", onArrived);
  }, []);

  return (
    <nav className="fixed inset-x-0 top-0 z-50 border-b border-stone-200 bg-[#faf9f7]/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Savatar home">
          <span
            data-nav-logo
            className={`transition-opacity duration-300 ${logoVisible ? "opacity-100" : "opacity-0"}`}
          >
            <Image src="/logo.svg" alt="" width={30} height={30} priority />
          </span>
          <span className="font-display text-[15px] font-bold tracking-[-0.02em] text-stone-900">Savatar</span>
        </Link>

        <div className="hidden items-center gap-8 text-[13px] font-medium text-stone-500 md:flex">
          <a href="#features" className="transition-colors hover:text-stone-900">Features</a>
          <a href="#how-it-works" className="transition-colors hover:text-stone-900">How it works</a>
          <a href="#pricing" className="transition-colors hover:text-stone-900">Pricing</a>
        </div>

        <div className="flex items-center gap-2.5">
          <ThemeToggle className="border border-stone-300 bg-white text-stone-600 hover:text-stone-900" />
          <Link href="/login" className="hidden px-3 py-2 text-[13px] font-medium text-stone-600 transition-colors hover:text-stone-900 sm:inline-flex">
            Sign in
          </Link>
          <Link href="/signup" className="hidden rounded-md bg-[#ff4a1d] px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-[#e84314] sm:inline-flex">
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
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={mobileOpen ? "M6 18L18 6M6 6l12 12" : "M4 7h16M4 12h16M4 17h16"} />
            </svg>
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="border-t border-stone-200 bg-[#faf9f7] px-5 py-5 md:hidden">
          <div className="flex flex-col gap-4 text-sm font-medium text-stone-700">
            <a href="#features" onClick={() => setMobileOpen(false)}>Features</a>
            <a href="#how-it-works" onClick={() => setMobileOpen(false)}>How it works</a>
            <a href="#pricing" onClick={() => setMobileOpen(false)}>Pricing</a>
            <Link href="/login">Sign in</Link>
            <Link href="/signup" className="rounded-md bg-[#ff4a1d] px-4 py-3 text-center font-semibold text-white">Get started</Link>
          </div>
        </div>
      )}
    </nav>
  );
}

// Dark product window on a light page — reads as a screenshot of the real
// studio, not a dark site. Kept visually close to the actual dashboard.
function StudioPreview() {
  return (
    <div className="rounded-lg border border-stone-300/80 bg-white p-2.5 shadow-[0_24px_60px_-30px_rgba(28,25,23,0.45)]">
      <div className="force-dark overflow-hidden rounded-md border border-white/10 bg-[#101010]">
        <div className="flex h-10 items-center justify-between border-b border-white/10 px-3.5">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-stone-600" />
            <span className="h-2 w-2 rounded-full bg-stone-700" />
            <span className="h-2 w-2 rounded-full bg-stone-800" />
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">Creator studio</span>
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
        </div>

        <div className="grid gap-3 p-3 sm:grid-cols-[1fr_140px]">
          <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-md border border-white/10 bg-[#0d0d0d]">
            <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded border border-red-400/30 bg-[#1c1010] px-2 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-red-300">
              <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
              Live preview
            </div>
            <div className="relative flex h-36 w-28 items-center justify-center rounded-[48%_48%_42%_42%] border border-[#ff4a1d]/40 bg-[#ff4a1d]/8">
              <div className="absolute top-7 h-12 w-12 rounded-full border border-[#ff4a1d]/40" />
              <div className="absolute bottom-5 h-12 w-20 rounded-t-[50%] border border-[#ff4a1d]/30 border-b-0" />
            </div>
            <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between rounded-md border border-white/10 bg-black/60 px-3 py-2">
              <span className="text-[10px] font-medium text-neutral-300">Character transformation</span>
              <span className="text-[9px] text-emerald-300">Connected</span>
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-md border border-white/10 bg-[#141414] p-3">
              <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-neutral-600">Session</p>
              <p className="mt-1.5 font-display text-lg font-bold text-white">12:48</p>
              <p className="mt-0.5 text-[10px] text-neutral-500">Elapsed time</p>
            </div>
            <div className="rounded-md border border-white/10 bg-[#141414] p-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-neutral-500">Viewers</span>
                <span className="font-display text-sm font-bold text-white">28</span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full w-3/5 rounded-full bg-[#ff4a1d]" />
              </div>
            </div>
            <button type="button" className="w-full rounded-md bg-[#ff4a1d] px-3 py-2.5 text-[11px] font-semibold text-white">
              Manage stream
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section className="px-5 pb-20 pt-32 sm:px-6 sm:pb-24 sm:pt-40">
      <div className="mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        <div>
          <div className="mb-6 inline-flex items-center gap-2.5">
            <span className="h-2 w-2 rounded-full bg-[#ff4a1d]" />
            <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-stone-500">AI live production in your browser</span>
          </div>
          <h1 className="font-display max-w-2xl text-[2.9rem] font-extrabold leading-[1.02] tracking-[-0.045em] text-stone-900 sm:text-6xl lg:text-[4rem]">
            Transform your camera.
            <br />
            <span className="text-[#ff4a1d]">Go live as anyone.</span>
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-stone-600 sm:text-lg">
            Create a polished AI-powered live presence, switch looks in real time, and invite viewers into a shareable room from one browser workspace.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/signup" className="inline-flex items-center justify-center rounded-md bg-[#ff4a1d] px-6 py-3.5 text-sm font-semibold text-white shadow-[0_10px_24px_-12px_rgba(255,74,29,0.7)] transition-colors hover:bg-[#e84314]">
              Start creating
            </Link>
            <a href="#how-it-works" className="inline-flex items-center justify-center rounded-md border border-stone-300 bg-white px-6 py-3.5 text-sm font-semibold text-stone-800 transition-colors hover:border-stone-900">
              See how it works
            </a>
          </div>
          <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-stone-500">
            {["No software install", "Mobile money payments", "Shareable watch rooms"].map((item) => (
              <span key={item} className="flex items-center gap-2">
                <svg className="h-3.5 w-3.5 text-[#ff4a1d]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                {item}
              </span>
            ))}
          </div>
        </div>
        {/* Studio screenshot is desktop-only — on mobile it stacks below the
            hero text and makes the page scroll too long. lg+ shows it. */}
        <div className="hidden lg:block">
          <StudioPreview />
        </div>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section id="features" className="scroll-mt-16 bg-[#f4f1ed] px-5 py-20 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-6 border-b border-stone-300 pb-10 md:grid-cols-[0.9fr_1.1fr] md:items-end">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#e84314]">What it does</p>
            <h2 className="font-display mt-3 text-3xl font-extrabold tracking-[-0.035em] text-stone-900 sm:text-4xl">Everything a live show needs</h2>
          </div>
          <p className="max-w-2xl text-[15px] leading-7 text-stone-600 md:justify-self-end">
            Camera, transformation, streaming controls, audience status, and chat stay together so you can focus on the session instead of the setup.
          </p>
        </div>

        {/* Flat editorial list — hairline rules instead of bordered cards */}
        <div className="mt-10 grid gap-x-14 sm:grid-cols-2">
          {features.map((feature) => (
            <article key={feature.title} className="flex gap-4 border-t border-stone-300 py-6 sm:py-7">
              <div className="mt-0.5 shrink-0 text-[#ff4a1d]">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">{feature.icon}</svg>
              </div>
              <div>
                <h3 className="font-display text-lg font-bold tracking-[-0.02em] text-stone-900">{feature.title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-stone-600">{feature.description}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-16 px-5 py-20 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#e84314]">How it works</p>
            <h2 className="font-display mt-3 max-w-xl text-3xl font-extrabold tracking-[-0.035em] text-stone-900 sm:text-4xl">
              From camera to live room in three steps
            </h2>
          </div>
        </div>

        {/* Big ghost numerals, no card chrome */}
        <div className="mt-12 grid gap-12 md:grid-cols-3 md:gap-10">
          {steps.map((step) => (
            <article key={step.number} className="border-t-2 border-stone-900 pt-6">
              <span className="font-display text-[2.6rem] font-extrabold leading-none tracking-[-0.04em] text-stone-200">{step.number}</span>
              <h3 className="font-display mt-4 text-xl font-bold tracking-[-0.025em] text-stone-900">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-stone-600">{step.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  return (
    <section id="pricing" className="scroll-mt-16 border-y border-stone-300 bg-[#f4f1ed] px-5 py-20 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#e84314]">Pricing</p>
            <h2 className="font-display mt-3 text-3xl font-extrabold tracking-[-0.035em] text-stone-900 sm:text-4xl">Buy the time you need</h2>
          </div>
          <p className="max-w-md text-sm leading-6 text-stone-600 sm:text-right">No subscription and no automatic renewal. Credits stay in your wallet until you use them.</p>
        </div>

        {/* Mobile: horizontal swipeable carousel (one pack per screen, no long
            vertical stack). sm+: 2-col grid, lg+: 4-col. */}
        <div className="mt-12 -mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-4">
          {plans.map((plan) => (
            <article
              key={plan.name}
              className={`flex min-h-[340px] w-[85%] flex-shrink-0 snap-center flex-col rounded-lg border p-6 sm:w-auto ${
                plan.featured
                  ? "border-stone-900 bg-stone-900 text-white shadow-[0_24px_50px_-24px_rgba(28,25,23,0.5)]"
                  : "border-stone-300 bg-white"
              }`}
            >
              <div className="flex min-h-7 items-start justify-between gap-3">
                <h3 className={`font-display text-base font-bold ${plan.featured ? "text-white" : "text-stone-900"}`}>{plan.name}</h3>
                {plan.featured && (
                  <span className="rounded-full bg-[#ff4a1d] px-2 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-white">Most popular</span>
                )}
              </div>
              <p className={`mt-4 text-sm leading-6 ${plan.featured ? "text-stone-400" : "text-stone-600"}`}>{plan.description}</p>
              <div className="mt-6">
                <p className={`font-display text-3xl font-extrabold tracking-[-0.035em] ${plan.featured ? "text-white" : "text-stone-900"}`}>{plan.price}</p>
                <p className={`mt-1 text-xs font-semibold ${plan.featured ? "text-[#ff8a68]" : "text-[#e84314]"}`}>{plan.credits}</p>
                <p className={`mt-0.5 text-[11px] ${plan.featured ? "text-stone-400" : "text-stone-500"}`}>{plan.duration}</p>
              </div>
              <ul className={`mt-6 space-y-3 text-xs ${plan.featured ? "text-stone-300" : "text-stone-600"}`}>
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-2.5">
                    <svg className={`h-3.5 w-3.5 shrink-0 ${plan.featured ? "text-[#ff8a68]" : "text-[#ff4a1d]"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    {feature}
                  </li>
                ))}
              </ul>
              <Link
                href="/signup"
                className={`mt-auto flex items-center justify-center rounded-md px-4 py-3 text-sm font-semibold transition-colors ${
                  plan.featured
                    ? "bg-[#ff4a1d] text-white hover:bg-[#e84314]"
                    : "border border-stone-300 bg-white text-stone-800 hover:border-stone-900"
                }`}
              >
                Choose {plan.name}
              </Link>
            </article>
          ))}
        </div>
        <p className="mt-3 text-center text-[11px] font-medium text-stone-500 sm:hidden">
          Swipe to see all packs
        </p>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="px-5 py-20 sm:px-6 sm:py-24">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-8 rounded-lg bg-stone-900 p-8 sm:p-12 md:flex-row md:items-center">
        <div className="max-w-2xl">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#ff8a68]">Start free</p>
          <h2 className="font-display mt-3 text-3xl font-extrabold tracking-[-0.035em] text-white sm:text-4xl">Build your first live look today</h2>
          <p className="mt-3 text-[15px] leading-7 text-stone-400">Create your account, connect a camera, and see the transformed preview before you spend any streaming credits.</p>
        </div>
        <Link href="/signup" className="shrink-0 rounded-md bg-[#ff4a1d] px-6 py-3.5 text-sm font-bold text-white transition-colors hover:bg-[#e84314]">
          Create an account
        </Link>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-stone-300 bg-[#f4f1ed] px-5 py-10 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/logo.svg" alt="" width={26} height={26} />
          <span className="font-display text-sm font-bold text-stone-900">Savatar</span>
        </Link>
        <div className="flex flex-wrap gap-x-6 gap-y-3 text-xs font-medium text-stone-500">
          <a href="#features" className="transition-colors hover:text-stone-900">Features</a>
          <a href="#pricing" className="transition-colors hover:text-stone-900">Pricing</a>
          <Link href="/terms" className="transition-colors hover:text-stone-900">Terms</Link>
          <Link href="/privacy" className="transition-colors hover:text-stone-900">Privacy</Link>
        </div>
        <p className="text-xs text-stone-500">AI live creation for modern creators.</p>
      </div>
    </footer>
  );
}

export default function Home() {
  // Paint the root light while this page is mounted so overscroll edges and
  // the browser chrome match the landing theme (the rest of the app is dark).
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.background;
    const prevBody = body.style.background;
    html.style.background = "#faf9f7";
    body.style.background = "#faf9f7";
    return () => {
      html.style.background = prevHtml;
      body.style.background = prevBody;
    };
  }, []);

  return (
    <main className="min-h-screen bg-[#faf9f7] text-stone-900">
      <Navbar />
      <Hero />
      <Features />
      <HowItWorks />
      <Pricing />
      <FinalCta />
      <Footer />
    </main>
  );
}
