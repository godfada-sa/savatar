"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { updatePassword, reauthenticateWithCredential, EmailAuthProvider } from "firebase/auth";
import DashboardLayout from "@/components/DashboardLayout";

export default function SettingsPage() {
  const { user, userData } = useAuth();

  const [resolution, setResolution] = useState("1080p");
  const [frameRate, setFrameRate] = useState("30");
  const [bitrate, setBitrate] = useState("4500");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordMsg, setPasswordMsg] = useState("");
  const [saveMsg, setSaveMsg] = useState("");

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const saved = localStorage.getItem("streamSettings");
      if (saved) {
        const settings = JSON.parse(saved);
        setResolution(settings.resolution || "1080p");
        setFrameRate(settings.frameRate || "30");
        setBitrate(settings.bitrate || "4500");
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const handleSaveStreamSettings = () => {
    localStorage.setItem("streamSettings", JSON.stringify({ resolution, frameRate, bitrate }));
    setSaveMsg("Stream settings saved");
    setTimeout(() => setSaveMsg(""), 3000);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMsg("");
    if (!user || !currentPassword || !newPassword) return;
    try {
      const credential = EmailAuthProvider.credential(user.email!, currentPassword);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPassword);
      setPasswordMsg("Password updated successfully");
      setCurrentPassword("");
      setNewPassword("");
    } catch {
      setPasswordMsg("Current password is incorrect");
    }
  };

  const balanceMinutes = ((userData?.wallet?.balanceSeconds || 0) / 60).toFixed(1);

  return (
    <DashboardLayout>
      <div className="p-6">
        {/* Error banner */}
        <div className="mb-4 p-4 rounded-xl bg-red-950/30 border border-red-500/20">
          <div className="text-sm font-semibold text-red-400">Session error</div>
          <div className="text-xs text-red-300/70 mt-0.5">No camera was found. Connect a camera, then reload this page.</div>
        </div>

        {/* Preferences Header */}
        <div className="p-6 rounded-xl bg-indigo-500/[0.06] border border-indigo-500/15 mb-6 flex items-center justify-between">
          <div>
            <div className="text-[10px] text-indigo-400 font-semibold uppercase tracking-wider mb-1">Preferences</div>
            <h1 className="text-xl font-bold">Settings</h1>
            <p className="text-xs text-neutral-500 mt-1">
              Manage your stream quality, devices, account details, and security — all in one place.
            </p>
          </div>
          <div className="flex items-center gap-3 px-4 py-2 rounded-xl bg-[#111] border border-white/5">
            <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-400 text-xs font-semibold">
              {(user?.displayName || user?.email || "U")[0].toUpperCase()}
            </div>
            <div>
              <div className="text-sm font-medium">{user?.email}</div>
              <div className="text-[11px] text-neutral-500 capitalize">{userData?.plan || "Standard"} account</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Stream & Devices */}
          <div className="p-5 rounded-xl bg-[#111] border border-white/5">
            <h2 className="text-sm font-semibold mb-1">Stream & devices</h2>
            <p className="text-xs text-neutral-500 mb-4">Output quality and input controls</p>

            <div className="grid grid-cols-3 gap-3 mb-4">
              <div>
                <label className="block text-[10px] text-neutral-500 uppercase tracking-wider mb-1">Resolution</label>
                <select
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="720p">720p</option>
                  <option value="1080p">1080p</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-neutral-500 uppercase tracking-wider mb-1">Frame Rate</label>
                <select
                  value={frameRate}
                  onChange={(e) => setFrameRate(e.target.value)}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="24">24 FPS</option>
                  <option value="30">30 FPS</option>
                  <option value="60">60 FPS</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-neutral-500 uppercase tracking-wider mb-1">Bitrate</label>
                <select
                  value={bitrate}
                  onChange={(e) => setBitrate(e.target.value)}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="2500">2500 kbps</option>
                  <option value="4500">4500 kbps</option>
                  <option value="6000">6000 kbps</option>
                  <option value="8000">8000 kbps</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="p-3 rounded-lg bg-white/5 border border-white/10 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center text-indigo-400">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
                <div>
                  <div className="text-xs font-medium text-white">Camera</div>
                  <div className="text-[11px] text-emerald-400">On</div>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-white/5 border border-white/10 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center text-indigo-400">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                </div>
                <div>
                  <div className="text-xs font-medium text-white">Microphone</div>
                  <div className="text-[11px] text-emerald-400">On</div>
                </div>
              </div>
            </div>

            <p className="text-[11px] text-neutral-500 mb-3">These defaults apply to your next Studio or AI streaming session.</p>

            <div className="flex items-center gap-3">
              <button onClick={handleSaveStreamSettings} className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-medium rounded-lg transition">
                Save Settings
              </button>
              {saveMsg && <span className="text-xs text-emerald-400">{saveMsg}</span>}
            </div>
          </div>

          {/* Account & Wallet */}
          <div className="p-5 rounded-xl bg-[#111] border border-white/5">
            <h2 className="text-sm font-semibold mb-1">Account & wallet</h2>
            <p className="text-xs text-neutral-500 mb-4">Your plan and credit balance</p>

            <div className="space-y-2">
              <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
                <span className="text-xs text-neutral-400">Email</span>
                <span className="text-sm text-white">{user?.email}</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
                <span className="text-xs text-neutral-400">Sponsored access</span>
                <span className="text-xs text-neutral-500">Disabled</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
                <span className="text-xs text-neutral-400">Credits remaining</span>
                <span className="font-display text-sm font-bold text-indigo-400">{balanceMinutes}m</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
                <span className="text-xs text-neutral-400">Payment gateway</span>
                <span className="text-xs text-white">Moolre (MoMo)</span>
              </div>
            </div>

            <div className="flex gap-2 mt-4">
              <a href="/credits" className="flex-1 py-2 bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-medium rounded-lg text-center transition">
                Buy credits
              </a>
              <a href="/transactions" className="flex-1 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-medium rounded-lg text-center transition">
                View transactions
              </a>
            </div>
          </div>
        </div>

        {/* Security */}
        <div className="mt-6 p-5 rounded-xl bg-[#111] border border-white/5">
          <h2 className="text-sm font-semibold mb-1">Security</h2>
          <p className="text-xs text-neutral-500 mb-4">Update your password</p>

          {passwordMsg && (
            <div className={`mb-3 p-2 rounded text-xs ${passwordMsg.includes("success") ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
              {passwordMsg}
            </div>
          )}

          <form onSubmit={handleChangePassword} className="flex items-end gap-3">
            <div className="flex-1">
              <label className="block text-[10px] text-neutral-500 uppercase tracking-wider mb-1">Current Password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div className="flex-1">
              <label className="block text-[10px] text-neutral-500 uppercase tracking-wider mb-1">New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={6}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-indigo-500"
              />
            </div>
            <button type="submit" className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-medium rounded-lg transition">
              Update
            </button>
          </form>
        </div>

        {/* Danger Zone */}
        <div className="mt-6 p-5 rounded-xl bg-red-500/5 border border-red-500/20">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-red-400">Danger Zone</h2>
              <p className="text-xs text-neutral-500">Permanently delete your account and all data</p>
            </div>
            <button
              onClick={() => {
                if (confirm("Are you sure? This cannot be undone.")) {
                  alert("Account deletion requires backend processing. Contact support.");
                }
              }}
              className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-xs font-medium rounded-lg transition"
            >
              Delete Account
            </button>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
