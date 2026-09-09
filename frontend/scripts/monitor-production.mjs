// Zero-provider-cost production monitor. It never opens an AI session or payment.
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const origin = (process.env.PRODUCTION_ORIGIN ?? "https://savatar.vercel.app").replace(/\/$/, "");
const signaling = (process.env.PRODUCTION_SIGNALING_URL ?? "https://savatar-signaling.onrender.com").replace(/\/$/, "");
const dailyAlertSeconds = Number(process.env.AI_USAGE_ALERT_SECONDS_PER_DAY ?? 3600);
const failures = [];

function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

async function getJson(url) {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  let body = {};
  try { body = await response.json(); } catch {}
  return { response, body };
}

try {
  const site = await fetch(origin, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
  check("frontend uptime", site.ok, `HTTP ${site.status}`);

  const health = await getJson(`${signaling}/health`);
  check("signaling uptime", health.response.ok && health.body.status === "ok", `HTTP ${health.response.status}`);

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) throw new Error("Firebase monitor credentials are missing");
  if (!getApps().length) initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId });
  const db = getFirestore();
  const now = Date.now();

  const active = await db.collection("streamSessions").where("status", "==", "active").limit(5).get();
  const expired = active.docs.filter((doc) => Number(doc.data().deadlineAt?.toMillis?.() ?? Infinity) < now);
  const invalidReservations = active.docs.filter((doc) => {
    const seconds = Number(doc.data().reservedSeconds);
    return !Number.isInteger(seconds) || seconds < 1 || seconds > 300;
  });
  check("single AI session invariant", active.size <= 1, `${active.size} active`);
  check("no expired active sessions", expired.length === 0, `${expired.length} expired`);
  check("reservation limits", invalidReservations.length === 0, `${invalidReservations.length} invalid`);

  const negativeWallets = await db.collection("users").where("wallet.balanceSeconds", "<", 0).limit(1).get();
  check("no negative wallets", negativeWallets.empty, `${negativeWallets.size} found`);

  const since = new Date(now - 24 * 60 * 60_000);
  const recent = await db.collection("streamSessions").where("endedAt", ">=", since).limit(100).get();
  const usedSeconds = recent.docs.reduce((sum, doc) => sum + Math.max(0, Number(doc.data().usedSeconds ?? 0)), 0);
  check("daily AI usage threshold", usedSeconds <= dailyAlertSeconds, `${usedSeconds}s / ${dailyAlertSeconds}s threshold`);
} catch (error) {
  check("monitor execution", false, error instanceof Error ? error.message : "unknown error");
}

if (failures.length) {
  console.error(`Production monitor failed: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("Production monitor passed without starting an AI stream or payment.");
