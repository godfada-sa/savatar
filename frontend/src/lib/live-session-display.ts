export const LIVE_SESSION_DISPLAY_EVENT = "savatar-live-session-display";
const LIVE_SESSION_DISPLAY_KEY = "savatar-active-stream-display";

interface LiveSessionDisplay {
  userId: string;
  deadlineAt: number;
}

export function publishLiveSessionDisplay(userId: string, deadlineAt: number) {
  if (typeof window === "undefined" || !Number.isFinite(deadlineAt)) return;
  localStorage.setItem(LIVE_SESSION_DISPLAY_KEY, JSON.stringify({ userId, deadlineAt } satisfies LiveSessionDisplay));
  window.dispatchEvent(new Event(LIVE_SESSION_DISPLAY_EVENT));
}

export function clearLiveSessionDisplay() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(LIVE_SESSION_DISPLAY_KEY);
  window.dispatchEvent(new Event(LIVE_SESSION_DISPLAY_EVENT));
}

export function readLiveSessionRemaining(userId: string): number {
  if (typeof window === "undefined") return 0;
  try {
    const value = JSON.parse(localStorage.getItem(LIVE_SESSION_DISPLAY_KEY) || "null") as LiveSessionDisplay | null;
    if (!value || value.userId !== userId || !Number.isFinite(value.deadlineAt)) return 0;
    const remaining = Math.max(0, Math.ceil((value.deadlineAt - Date.now()) / 1000));
    if (remaining === 0) localStorage.removeItem(LIVE_SESSION_DISPLAY_KEY);
    return remaining;
  } catch {
    localStorage.removeItem(LIVE_SESSION_DISPLAY_KEY);
    return 0;
  }
}
