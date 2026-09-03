"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, useEffect } from "react";

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
    // If splash was skipped (already seen), show logo immediately
    if (!sessionStorage.getItem("savatar-splash-seen")) {
      setLogoVisible(true);
    }
    return () => window.removeEventListener("splash-logo-arrived", onArrived);
  }, []);

  return (
    <nav className="fixed inset-x-0 top-0 z-50 border-b border-white/8 bg-[#090909]/95 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Savatar home">
          <span
            data-nav-logo
            className={`transition-opacity duration-300 ${logoVisible ? "opacity-100" : "opacity-0"}`}
          >
            <Image src="/logo.svg" alt="" width={30} height={30} priority />
          </span>
          <span className="font-display text-[15px] font-bold tracking-[-0.02em] text-white">Savatar</span>
        </Link>

        <div className="hidden items-center gap-8 text-[13px] font-medium text-neutral-400 md:flex">
          <a href="#features" className="transition-colors hover:text-white">Features</a>
          <a href="#how-it-works" className="transition-colors hover:text-white">How it works</a>
          <a href="#pricing" className="transition-colors hover:text-white">Pricing</a>
        </div>

        <div className="flex items-center gap-2.5">
          <Link href="/login" className="hidden px-3 py-2 text-[13px] font-medium text-neutral-300 transition-colors hover:text-white sm:inline-flex">
            Sign in
          </Link>
          <Link href="/signup" className="hidden rounded-lg bg-indigo-500 px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-indigo-400 sm:inline-flex">
            Get started
          </Link>
          <button
            type="button"
            aria-label="Toggle navigation"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((open) => !open)}
            className="rounded-lg border border-white/10 p-2 text-neutral-300 md:hidden"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={mobileOpen ? "M6 18L18 6M6 6l12 12" : "M4 7h16M4 12h16M4 17h16"} />
            </svg>
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="border-t border-white/8 bg-[#090909] px-5 py-5 md:hidden">
          <div className="flex flex-col gap-4 text-sm font-medium text-neutral-300">
            <a href="#features" onClick={() => setMobileOpen(false)}>Features</a>
            <a href="#how-it-works" onClick={() => setMobileOpen(false)}>How it works</a>
            <a href="#pricing" onClick={() => setMobileOpen(false)}>Pricing</a>
            <Link href="/login">Sign in</Link>
            <Link href="/signup" className="rounded-lg bg-indigo-500 px-4 py-3 text-center font-semibold text-white">Get started</Link>
          </div>
        </div>
      )}
    </nav>
  );
}

function StudioPreview() {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#101010] p-2.5 shadow-[0_30px_90px_rgba(0,0,0,0.45)]">
      <div className="overflow-hidden rounded-xl border border-white/8 bg-[#080808]">
        <div className="flex h-11 items-center justify-between border-b border-white/8 px-4">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-neutral-600" />
            <span className="h-2 w-2 rounded-full bg-neutral-700" />
            <span className="h-2 w-2 rounded-full bg-neutral-800" />
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-500">Creator studio</span>
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
        </div>

        <div className="grid gap-3 p-3 sm:grid-cols-[1fr_148px]">
          <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-lg border border-white/8 bg-[#0d0d0d]">
            <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-md border border-red-400/20 bg-[#171010] px-2 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-red-300">
              <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
              Live preview
            </div>
            <div className="relative flex h-36 w-28 items-center justify-center rounded-[48%_48%_42%_42%] border border-indigo-400/35 bg-indigo-400/8">
              <div className="absolute top-7 h-12 w-12 rounded-full border border-indigo-300/40" />
              <div className="absolute bottom-5 h-12 w-20 rounded-t-[50%] border border-indigo-300/30 border-b-0" />
            </div>
            <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between rounded-md border border-white/8 bg-black/60 px-3 py-2">
              <span className="text-[10px] font-medium text-neutral-300">Character transformation</span>
              <span className="text-[9px] text-emerald-300">Connected</span>
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-lg border border-white/8 bg-[#111] p-3">
              <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-neutral-600">Session</p>
              <p className="mt-1.5 font-display text-lg font-bold text-white">12:48</p>
              <p className="mt-0.5 text-[10px] text-neutral-500">Elapsed time</p>
            </div>
            <div className="rounded-lg border border-white/8 bg-[#111] p-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-neutral-500">Viewers</span>
                <span className="font-display text-sm font-bold text-white">28</span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/5">
                <div className="h-full w-3/5 rounded-full bg-indigo-400" />
              </div>
            </div>
            <button type="button" className="w-full rounded-lg bg-indigo-500 px-3 py-2.5 text-[11px] font-semibold text-white">
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
    <section className="border-b border-white/8 px-5 pb-20 pt-32 sm:px-6 sm:pb-24 sm:pt-40">
      <div className="mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[0.88fr_1.12fr] lg:gap-16">
        <div>
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-indigo-400/25 bg-indigo-400/8 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-300">
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-300" />
            AI live production in your browser
          </div>
          <h1 className="font-display max-w-2xl text-5xl font-bold leading-[1.04] tracking-[-0.045em] text-white sm:text-6xl lg:text-[4.25rem]">
            Transform your camera. Go live as anyone.
          </h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-neutral-400 sm:text-lg">
            Create a polished AI-powered live presence, switch looks in real time, and invite viewers into a shareable room from one browser workspace.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/signup" className="inline-flex items-center justify-center rounded-lg bg-indigo-500 px-5 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-400">
              Start creating
            </Link>
            <a href="#how-it-works" className="inline-flex items-center justify-center rounded-lg border border-white/12 bg-white/[0.03] px-5 py-3.5 text-sm font-semibold text-neutral-200 transition-colors hover:bg-white/[0.06]">
              See how it works
            </a>
          </div>
          <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-xs text-neutral-500">
            {["No software install", "Mobile money payments", "Shareable watch rooms"].map((item) => (
              <span key={item} className="flex items-center gap-2">
                <svg className="h-3.5 w-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                {item}
              </span>
            ))}
          </div>
        </div>
        {/* Studio mockup is desktop-only — on mobile it stacks below the hero
            text and makes the page scroll too long. lg+ shows it side-by-side. */}
        <div className="hidden lg:block">
          <StudioPreview />
        </div>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section id="features" className="scroll-mt-16 px-5 py-20 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-8 border-b border-white/8 pb-12 md:grid-cols-[0.8fr_1.2fr] md:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-300">Built for live creation</p>
            <h2 className="font-display mt-3 text-3xl font-bold tracking-[-0.035em] text-white sm:text-4xl">A simpler production workflow</h2>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-neutral-400 md:justify-self-end md:text-base">
            Camera, transformation, streaming controls, audience status, and chat stay together so you can focus on the session instead of the setup.
          </p>
        </div>

        <div className="grid gap-px overflow-hidden rounded-2xl border border-white/8 bg-white/8 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <article key={feature.title} className="bg-[#0d0d0d] p-6 sm:min-h-64">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-indigo-400/20 bg-indigo-400/8 text-indigo-300">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">{feature.icon}</svg>
              </div>
              <h3 className="font-display mt-8 text-lg font-bold tracking-[-0.02em] text-white">{feature.title}</h3>
              <p className="mt-3 text-sm leading-6 text-neutral-500">{feature.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-16 border-y border-white/8 bg-[#0c0c0c] px-5 py-20 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-300">How it works</p>
          <h2 className="font-display mt-3 text-3xl font-bold tracking-[-0.035em] text-white sm:text-4xl">From camera to live room in three steps</h2>
        </div>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {steps.map((step) => (
            <article key={step.number} className="rounded-xl border border-white/8 bg-[#101010] p-6">
              <span className="font-display text-sm font-bold text-indigo-300">{step.number}</span>
              <h3 className="font-display mt-12 text-xl font-bold tracking-[-0.025em] text-white">{step.title}</h3>
              <p className="mt-3 text-sm leading-6 text-neutral-500">{step.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  return (
    <section id="pricing" className="scroll-mt-16 px-5 py-20 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div className="max-w-xl">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-300">Pricing</p>
            <h2 className="font-display mt-3 text-3xl font-bold tracking-[-0.035em] text-white sm:text-4xl">Buy the time you need</h2>
          </div>
          <p className="max-w-md text-sm leading-6 text-neutral-500 sm:text-right">No subscription and no automatic renewal. Credits stay in your wallet until you use them.</p>
        </div>

        {/* Mobile: horizontal swipeable carousel (one pack per screen, no long
            vertical stack). sm+: normal 2-col, lg+: 4-col grid. */}
        <div className="mt-12 -mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-4">
          {plans.map((plan) => (
            <article
              key={plan.name}
              className={`flex min-h-[350px] w-[85%] flex-shrink-0 snap-center flex-col rounded-2xl border bg-[#101010] p-6 sm:w-auto ${
                plan.featured ? "border-indigo-400/50" : "border-white/10"
              }`}
            >
              <div className="flex min-h-7 items-start justify-between gap-3">
                <h3 className="font-display text-base font-bold text-white">{plan.name}</h3>
                {plan.featured && <span className="rounded-full border border-indigo-300/30 bg-indigo-400/10 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-indigo-200">Popular</span>}
              </div>
              <p className="mt-5 text-sm leading-6 text-neutral-500">{plan.description}</p>
              <div className="mt-7">
                <p className="font-display text-3xl font-bold tracking-[-0.035em] text-white">{plan.price}</p>
                <p className="mt-1 text-xs font-medium text-indigo-400">{plan.credits}</p>
                <p className="mt-0.5 text-[11px] text-neutral-500">{plan.duration}</p>
              </div>
              <ul className="mt-7 space-y-3 text-xs text-neutral-400">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-2.5">
                    <svg className="h-3.5 w-3.5 shrink-0 text-indigo-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    {feature}
                  </li>
                ))}
              </ul>
              <Link
                href="/signup"
                className={`mt-auto flex items-center justify-center rounded-lg px-4 py-3 text-sm font-semibold transition-colors ${plan.featured ? "bg-indigo-500 text-white hover:bg-indigo-400" : "border border-white/12 bg-white/[0.03] text-neutral-200 hover:bg-white/[0.06]"}`}
              >
                Choose {plan.name}
              </Link>
            </article>
          ))}
        </div>
        <p className="mt-3 text-center text-[11px] text-neutral-500 sm:hidden">
          Swipe to see all packs
        </p>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="px-5 pb-20 sm:px-6 sm:pb-24">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-8 rounded-2xl border border-indigo-300/20 bg-indigo-400/8 p-8 sm:p-10 md:flex-row md:items-center">
        <div className="max-w-2xl">
          <h2 className="font-display text-3xl font-bold tracking-[-0.035em] text-white">Build your first live look today</h2>
          <p className="mt-3 text-sm leading-6 text-neutral-400">Create your account, connect a camera, and see the transformed preview before you spend any streaming credits.</p>
        </div>
        <Link href="/signup" className="shrink-0 rounded-lg bg-white px-5 py-3.5 text-sm font-bold text-black transition-colors hover:bg-neutral-200">Create an account</Link>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/8 px-5 py-10 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/logo.svg" alt="" width={26} height={26} />
          <span className="font-display text-sm font-bold text-white">Savatar</span>
        </Link>
        <div className="flex flex-wrap gap-x-6 gap-y-3 text-xs font-medium text-neutral-500">
          <a href="#features" className="transition-colors hover:text-white">Features</a>
          <a href="#pricing" className="transition-colors hover:text-white">Pricing</a>
          <Link href="/terms" className="transition-colors hover:text-white">Terms</Link>
          <Link href="/privacy" className="transition-colors hover:text-white">Privacy</Link>
        </div>
        <p className="text-xs text-neutral-600">AI live creation for modern creators.</p>
      </div>
    </footer>
  );
}

export default function Home() {
  return (
    <main className="min-h-screen bg-[#090909]">
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
