"use client";

import { useState } from "react";
import Link from "next/link";

// ─── Navbar ──────────────────────────────────────────────
function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-[#0a0a0a]/90 backdrop-blur-md border-b border-white/5">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <img src="/logo.svg" alt="Savatar" className="w-7 h-7" />
          <span className="text-white font-semibold text-base tracking-tight font-[Space_Grotesk]">Savatar</span>
        </Link>

        <div className="hidden md:flex items-center gap-7 text-[13px] text-neutral-400 font-medium">
          <a href="#features" className="hover:text-white transition">Features</a>
          <a href="#how-it-works" className="hover:text-white transition">How It Works</a>
          <a href="#pricing" className="hover:text-white transition">Pricing</a>
        </div>

        <div className="flex items-center gap-3">
          <Link href="/login" className="hidden sm:inline-flex text-[13px] text-neutral-400 hover:text-white transition font-medium">
            Sign In
          </Link>
          <Link
            href="/signup"
            className="hidden sm:inline-flex px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white text-[13px] font-medium rounded-md transition"
          >
            Get Started
          </Link>

          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden text-neutral-400 hover:text-white p-1"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {mobileOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="md:hidden bg-[#0a0a0a] border-t border-white/5 px-6 py-4 space-y-3">
          <a href="#features" className="block text-neutral-400 hover:text-white text-sm">Features</a>
          <a href="#how-it-works" className="block text-neutral-400 hover:text-white text-sm">How It Works</a>
          <a href="#pricing" className="block text-neutral-400 hover:text-white text-sm">Pricing</a>
          <Link href="/login" className="block text-neutral-400 hover:text-white text-sm">Sign In</Link>
          <Link href="/signup" className="block text-indigo-400 font-medium text-sm">Get Started Free</Link>
        </div>
      )}
    </nav>
  );
}

// ─── Hero ────────────────────────────────────────────────
function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-14">
      <div className="relative z-10 text-center px-6 max-w-4xl mx-auto">


        <h1 className="text-[3.5rem] md:text-[5rem] lg:text-[6rem] font-bold tracking-[-0.03em] leading-[0.95] mb-6 font-[Space_Grotesk]">
          <span className="text-white">Go Live.</span>
          <br />
          <span className="text-indigo-400">Transform Instantly.</span>
        </h1>

        <p className="text-base md:text-lg text-neutral-400 max-w-xl mx-auto mb-10 leading-relaxed">
          The browser-based AI live streaming platform for desktop creators.
          Switch between your real camera and AI-powered avatars instantly.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/signup"
            className="px-6 py-3.5 bg-indigo-500 hover:bg-indigo-600 text-white font-medium rounded-lg text-sm transition"
          >
            Start Streaming
          </Link>
          <a
            href="#how-it-works"
            className="px-6 py-3.5 bg-white/5 hover:bg-white/10 text-neutral-300 font-medium rounded-lg text-sm border border-white/10 transition"
          >
            See How It Works
          </a>
        </div>

        <div className="flex items-center justify-center gap-6 mt-12 text-xs text-neutral-500">
          <div className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            Pay with MoMo
          </div>
          <div className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            Instant credits
          </div>
          <div className="hidden sm:flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            1080p at 30fps
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Features ────────────────────────────────────────────
function Features() {
  const features = [
    {
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.182 15.182a4.5 4.5 0 01-6.364 0M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75zm-.375 0h.008v.015h-.008V9.75zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75zm-.375 0h.008v.015h-.008V9.75z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21a8.966 8.966 0 01-5.982-2.275M12 21c1.5 0 2.5-.5 3-1.5M12 21a9 9 0 009-9c0-5-3.5-8-9-9S3 6 3 11a9 9 0 009 9z" /></svg>
      ),
      title: "Character Replacement",
      desc: "Turn yourself into any character with a single photo. VTuber avatars, brand mascots, or custom characters.",
    },
    {
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" /></svg>
      ),
      title: "Virtual Try-On",
      desc: "Change your clothes live on camera. Perfect for fashion streams, live commerce, and interactive shopping.",
    },
    {
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3H21m-3.75 3H21" /></svg>
      ),
      title: "Background Replacement",
      desc: "Swap backgrounds in real-time. No green screen needed. Beach, office, space — anywhere you want.",
    },
    {
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" /></svg>
      ),
      title: "Style Transfer",
      desc: "Transform your entire scene into anime, cyberpunk, oil painting, or any style you can describe.",
    },
    {
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>
      ),
      title: "Instant Switching",
      desc: "Two synchronized feeds: your real camera and AI output. Switch instantly without interrupting your broadcast.",
    },
    {
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" /></svg>
      ),
      title: "Stream Anywhere",
      desc: "RTMP output to Twitch, YouTube, TikTok, or any platform. Your audience sees the AI-transformed version.",
    },
  ];

  return (
    <section id="features" className="py-24 px-6 border-t border-white/5">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-3 font-[Space_Grotesk] tracking-tight">
            Everything You Need to Go Live
          </h2>
          <p className="text-neutral-400 text-sm max-w-lg mx-auto">
            Powerful AI transformation tools that work right in your browser.
            No downloads. No setup.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((f, i) => (
            <div
              key={i}
              className="p-5 rounded-xl bg-[#111] border border-white/5 hover:border-white/10 transition"
            >
              <div className="w-10 h-10 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mb-3">{f.icon}</div>
              <h3 className="text-sm font-semibold text-white mb-1.5 tracking-tight">
                {f.title}
              </h3>
              <p className="text-neutral-500 text-[13px] leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── How It Works ────────────────────────────────────────
function HowItWorks() {
  const steps = [
    { step: "1", title: "Open Your Camera", desc: "Click Start Streaming and allow camera access. Works in Chrome, Edge, and Firefox." },
    { step: "2", title: "Choose Your Transformation", desc: "Upload a reference image or pick a style. Type a prompt like 'anime warrior' or 'cyberpunk robot'." },
    { step: "3", title: "Go Live", desc: "See yourself transformed in real-time. Share the watch link or stream to Twitch/YouTube via RTMP." },
  ];

  return (
    <section id="how-it-works" className="py-24 px-6 bg-[#070707]">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-3 font-[Space_Grotesk] tracking-tight">
            Live in 3 Steps
          </h2>
          <p className="text-neutral-400 text-sm">
            No downloads. No installation. Just your browser.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
          {steps.map((s, i) => (
            <div key={i} className="text-center">
              <div className="w-10 h-10 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 font-semibold text-sm mx-auto mb-4 font-[Space_Grotesk]">
                {s.step}
              </div>
              <h3 className="text-sm font-semibold text-white mb-2 tracking-tight">{s.title}</h3>
              <p className="text-neutral-500 text-[13px] leading-relaxed max-w-xs mx-auto">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Pricing ─────────────────────────────────────────────
function Pricing() {
  return (
    <section id="pricing" className="py-24 px-6 border-t border-white/5">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-3 font-[Space_Grotesk] tracking-tight">
            Simple, Transparent Pricing
          </h2>
          <p className="text-neutral-400 text-sm">
            Pay only for what you use. No subscriptions. No hidden fees.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Starter */}
          <div className="p-5 rounded-xl bg-[#111] border border-white/5">
            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1">Starter</h3>
            <div className="text-2xl font-bold text-white mb-0.5 font-[Space_Grotesk]">GH 250</div>
            <p className="text-neutral-600 text-[11px] mb-4">5 minutes</p>
            <Link href="/signup" className="block text-center py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white text-xs font-medium transition border border-white/10">Get Started</Link>
          </div>

          {/* Basic */}
          <div className="p-5 rounded-xl bg-[#111] border border-indigo-500/30 relative">
            <div className="absolute -top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-indigo-500 text-white text-[9px] font-semibold rounded uppercase tracking-wider">Popular</div>
            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1">Basic</h3>
            <div className="text-2xl font-bold text-white mb-0.5 font-[Space_Grotesk]">GH 650</div>
            <p className="text-neutral-600 text-[11px] mb-4">15 minutes</p>
            <Link href="/signup" className="block text-center py-2 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-medium transition">Buy Now</Link>
          </div>

          {/* Pro */}
          <div className="p-5 rounded-xl bg-[#111] border border-white/5">
            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1">Pro</h3>
            <div className="text-2xl font-bold text-white mb-0.5 font-[Space_Grotesk]">GH 1,100</div>
            <p className="text-neutral-600 text-[11px] mb-4">30 minutes</p>
            <Link href="/signup" className="block text-center py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white text-xs font-medium transition border border-white/10">Buy Now</Link>
          </div>

          {/* Creator */}
          <div className="p-5 rounded-xl bg-[#111] border border-white/5">
            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1">Creator</h3>
            <div className="text-2xl font-bold text-white mb-0.5 font-[Space_Grotesk]">GH 1,800</div>
            <p className="text-neutral-600 text-[11px] mb-4">1 hour</p>
            <Link href="/signup" className="block text-center py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white text-xs font-medium transition border border-white/10">Buy Now</Link>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Footer ──────────────────────────────────────────────
function Footer() {
  return (
    <footer className="border-t border-white/5 py-10 px-6">
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-5">
        <div className="flex items-center gap-2">
          <img src="/logo.svg" alt="Savatar" className="w-6 h-6" />
          <span className="text-white font-semibold text-sm font-[Space_Grotesk]">Savatar</span>
        </div>

        <div className="flex items-center gap-5 text-xs text-neutral-500">
          <a href="#features" className="hover:text-white transition">Features</a>
          <a href="#pricing" className="hover:text-white transition">Pricing</a>
          <a href="/terms" className="hover:text-white transition">Terms</a>
          <a href="/privacy" className="hover:text-white transition">Privacy</a>
        </div>


      </div>
    </footer>
  );
}

// ─── Page ────────────────────────────────────────────────
export default function Home() {
  return (
    <main className="min-h-screen">
      <Navbar />
      <Hero />
      <Features />
      <HowItWorks />
      <Pricing />
      <Footer />
    </main>
  );
}
