const firebaseVariables = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const firebaseVariableNames = {
  apiKey: "NEXT_PUBLIC_FIREBASE_API_KEY",
  authDomain: "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  projectId: "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  storageBucket: "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  appId: "NEXT_PUBLIC_FIREBASE_APP_ID",
} as const;

const missingFirebaseVariables = Object.entries(firebaseVariables)
  .filter(([, value]) => !value)
  .map(([name]) => firebaseVariableNames[name as keyof typeof firebaseVariableNames]);

if (missingFirebaseVariables.length > 0) {
  throw new Error(
    `Missing Firebase configuration: ${missingFirebaseVariables.join(", ")}. ` +
      "Add these variables to the Vercel project and redeploy."
  );
}

export const firebaseConfig = firebaseVariables as {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
};

export const signalingUrl = process.env.NEXT_PUBLIC_SIGNALING_URL ?? "http://localhost:4000";

const fallbackIceServers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
let cachedIceServers: { servers: RTCIceServer[]; refreshAt: number } | null = null;

/** Load short-lived TURN credentials without bundling a reusable secret in JavaScript. */
export async function getIceServers(): Promise<RTCIceServer[]> {
  if (cachedIceServers && cachedIceServers.refreshAt > Date.now()) return cachedIceServers.servers;

  try {
    const response = await fetch("/api/webrtc/ice-servers", { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) return fallbackIceServers;
    const body = (await response.json()) as { iceServers?: RTCIceServer[]; expiresAt?: number };
    if (!Array.isArray(body.iceServers) || !body.iceServers.length) return fallbackIceServers;
    const servers = body.iceServers.filter((server) => typeof server?.urls === "string" || Array.isArray(server?.urls));
    if (!servers.length) return fallbackIceServers;
    const expiresAt = Number(body.expiresAt) || Date.now() + 5 * 60_000;
    cachedIceServers = { servers, refreshAt: Math.max(Date.now() + 30_000, expiresAt - 60_000) };
    return servers;
  } catch {
    return fallbackIceServers;
  }
}
