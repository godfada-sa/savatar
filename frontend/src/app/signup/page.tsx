"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import ThemeToggle from "@/components/ThemeToggle";

export default function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const { signup, loginWithGoogle, loginWithApple } = useAuth();
  const router = useRouter();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signup(email, password, name);
      router.push("/dashboard");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Signup failed";
      if (msg.includes("email-already-in-use")) setError("An account with this email already exists");
      else if (msg.includes("weak-password")) setError("Use a stronger password with at least 10 characters");
      else setError("Signup failed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignup = async () => {
    try {
      await loginWithGoogle();
      router.push("/dashboard");
    } catch {
      setError("Google signup failed");
    }
  };

  const handleAppleSignup = async () => {
    try {
      await loginWithApple();
      router.push("/dashboard");
    } catch {
      setError("Apple signup failed");
    }
  };

  return (
    <div className="relative min-h-screen bg-[#faf9f7] flex items-center justify-center px-4 py-10">
      <div className="absolute right-4 top-4">
        <ThemeToggle className="border border-stone-300 bg-white text-stone-600 hover:text-stone-900" />
      </div>
      <div className="w-full max-w-sm">
        <Link href="/" className="flex items-center justify-center gap-2 mb-8">
          <img src="/logo.svg" alt="Savatar" className="w-8 h-8" />
          <span className="text-stone-900 font-semibold text-lg tracking-tight">Savatar</span>
        </Link>

        <h1 className="text-xl font-semibold text-stone-900 text-center mb-1 tracking-tight">Create your account</h1>
        <p className="text-stone-500 text-sm text-center mb-6">Start streaming in under a minute</p>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-xs">
            {error}
          </div>
        )}



        <div className="space-y-3 mb-5">
          <button
            onClick={handleGoogleSignup}
            className="w-full flex items-center justify-center gap-3 px-4 py-2.5 bg-white hover:bg-stone-50 border border-stone-300 rounded-lg text-sm text-stone-800 transition"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continue with Google
          </button>

          <button
            onClick={handleAppleSignup}
            className="w-full flex items-center justify-center gap-3 px-4 py-2.5 bg-white hover:bg-stone-50 border border-stone-300 rounded-lg text-sm text-stone-800 transition"
          >
            <svg className="w-4 h-4" fill="#1c1917" viewBox="0 0 24 24">
              <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.98-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
            </svg>
            Continue with Apple
          </button>
        </div>

        <div className="flex items-center gap-3 mb-5">
          <div className="flex-1 h-px bg-stone-300" />
          <span className="text-xs text-stone-400">or</span>
          <div className="flex-1 h-px bg-stone-300" />
        </div>

        <form onSubmit={handleSignup} className="space-y-3">
          <div>
            <label className="block text-xs text-stone-600 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              required
              className="w-full px-3 py-2.5 bg-white border border-stone-300 rounded-lg text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:border-[#ff4a1d] focus:ring-1 focus:ring-[#ff4a1d]/30 transition"
            />
          </div>
          <div>
            <label className="block text-xs text-stone-600 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="w-full px-3 py-2.5 bg-white border border-stone-300 rounded-lg text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:border-[#ff4a1d] focus:ring-1 focus:ring-[#ff4a1d]/30 transition"
            />
          </div>
          <div>
            <label className="block text-xs text-stone-600 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 10 characters"
              required
              minLength={10}
              className="w-full px-3 py-2.5 bg-white border border-stone-300 rounded-lg text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:border-[#ff4a1d] focus:ring-1 focus:ring-[#ff4a1d]/30 transition"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-[#ff4a1d] hover:bg-[#e84314] disabled:opacity-50 text-white text-sm font-medium rounded-lg transition"
          >
            {loading ? "Creating account..." : "Create Account"}
          </button>
        </form>

        <p className="text-center text-xs text-stone-500 mt-6">
          Already have an account?{" "}
          <Link href="/login" className="text-[#e84314] hover:text-[#c73608] transition font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
