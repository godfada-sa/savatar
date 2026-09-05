import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import SiteNavbar from "@/components/SiteNavbar";

interface LegalPageProps {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}

export function LegalSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-stone-200 pt-8">
      <h2 className="font-display text-xl font-bold tracking-[-0.025em] text-stone-900 sm:text-2xl">
        {title}
      </h2>
      <div className="mt-4 space-y-4 text-[15px] leading-7 text-stone-600">{children}</div>
    </section>
  );
}

export function LegalPage({ eyebrow, title, description, children }: LegalPageProps) {
  return (
    <main className="min-h-screen bg-[#faf9f7] text-stone-900">
      {/* Shared responsive header — same component as the landing page, so
          dark mode inverts both identically and the wordmark never clips on
          mobile (links collapse into the hamburger menu). */}
      <SiteNavbar
        links={[
          { label: "Terms", href: "/terms" },
          { label: "Privacy", href: "/privacy" },
        ]}
      />

      <header className="border-b border-stone-200 px-5 py-16 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#e84314]">{eyebrow}</p>
          <h1 className="font-display mt-4 text-4xl font-extrabold tracking-[-0.045em] text-stone-900 sm:text-5xl">{title}</h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-stone-600">{description}</p>
          <div className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-xs text-stone-500">
            <span>Effective: 1 September 2026</span>
            <span>Last updated: 1 September 2026</span>
          </div>
        </div>
      </header>

      <div className="px-5 py-12 sm:px-6 sm:py-16">
        <article className="mx-auto max-w-3xl space-y-10">{children}</article>
      </div>

      <footer className="border-t border-stone-200 bg-[#f4f1ed] px-5 py-10 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/logo.svg" alt="" width={26} height={26} />
            <span className="font-display text-sm font-bold text-stone-900">Savatar</span>
          </Link>
          <div className="flex gap-6 text-xs font-medium text-stone-500">
            <Link href="/" className="transition-colors hover:text-stone-900">Home</Link>
            <Link href="/terms" className="transition-colors hover:text-stone-900">Terms</Link>
            <Link href="/privacy" className="transition-colors hover:text-stone-900">Privacy</Link>
          </div>
          <p className="text-xs text-stone-500">© 2026 SaffulTech. All rights reserved.</p>
        </div>
      </footer>
    </main>
  );
}
