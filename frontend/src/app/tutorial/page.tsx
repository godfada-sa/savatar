"use client";

import Link from "next/link";
import DashboardLayout from "@/components/DashboardLayout";

const steps = [
  ["1", "Prepare your look", "Open AI & OBS, upload a clear full-body reference, then choose a background or style."],
  ["2", "Set up OBS", "Copy your stable OBS Browser Source URL. In OBS, add a Browser Source at 1280×720 and paste it."],
  ["3", "Choose camera and mic", "Open Studio, choose your camera, and mute the Savatar microphone if another call device will carry audio."],
  ["4", "Start AI before the call", "Select Go Live and wait for AI output live. The AI & OBS monitor and OBS Browser Source will receive the same transformed stream."],
  ["5", "Use it in the call", "Start OBS Virtual Camera, then select it in Telegram, WhatsApp, or your meeting app."],
  ["6", "Stop safely", "Select Stop before closing the tab. Savatar disconnects immediately and returns every unused reserved second to your wallet."],
];

export default function TutorialPage() {
  return (
    <DashboardLayout>
      <div className="mx-auto max-w-5xl space-y-5 p-3 sm:p-6">
        <div className="rounded-xl border border-[#e84314]/20 bg-[#e84314]/5 p-5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#e84314]">Production workflow</div>
          <h1 className="mt-1 text-2xl font-bold text-stone-900">AI calls and OBS</h1>
          <p className="mt-2 max-w-3xl text-sm text-stone-600">Follow this order so the transformed feed is ready before Telegram, WhatsApp, OBS, or another calling app opens its camera.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/ai-obs" className="rounded-lg bg-[#e84314] px-4 py-2 text-sm font-medium text-white">Open AI & OBS</Link>
            <Link href="/dashboard" className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700">Open Studio</Link>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {steps.map(([number, title, description]) => (
            <section key={number} className="rounded-xl border border-stone-200 bg-white p-4">
              <div className="flex gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#e84314] text-sm font-bold text-white">{number}</span>
                <div><h2 className="font-semibold text-stone-900">{title}</h2><p className="mt-1 text-xs leading-5 text-stone-500">{description}</p></div>
              </div>
            </section>
          ))}
        </div>

        <section className="rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="font-semibold text-stone-900">Reference tutorials</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <a href="https://youtu.be/u-gFcEVk9do" target="_blank" rel="noreferrer" className="rounded-lg border border-stone-200 p-3 text-sm text-stone-700 hover:border-[#e84314]">Telegram / call setup ↗</a>
            <a href="https://youtu.be/4RYObe1HKvM" target="_blank" rel="noreferrer" className="rounded-lg border border-stone-200 p-3 text-sm text-stone-700 hover:border-[#e84314]">AI & OBS workflow ↗</a>
            <a href="https://youtu.be/vNxZGYvizzg" target="_blank" rel="noreferrer" className="rounded-lg border border-stone-200 p-3 text-sm text-stone-700 hover:border-[#e84314]">Two-phone workflow ↗</a>
            <a href="https://youtu.be/c2CKrGt5Hsk" target="_blank" rel="noreferrer" className="rounded-lg border border-stone-200 p-3 text-sm text-stone-700 hover:border-[#e84314]">OBS Virtual Camera ↗</a>
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
}
