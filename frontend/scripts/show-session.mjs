import { readFile } from "node:fs/promises";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const uid = process.argv[2];
if (!uid) throw new Error("Usage: node scripts/show-session.mjs UID");
const raw = await readFile(".env.local", "utf8");
const value = (name) =>
  raw
    .split(/\r?\n/)
    .find((line) => line.startsWith(`${name}=`))
    ?.slice(name.length + 1)
    .replace(/^"|"$/g, "")
    .replace(/\\n/g, "\n");
initializeApp({
  credential: cert({
    projectId: value("FIREBASE_PROJECT_ID") ?? value("NEXT_PUBLIC_FIREBASE_PROJECT_ID"),
    clientEmail: value("FIREBASE_CLIENT_EMAIL"),
    privateKey: value("FIREBASE_PRIVATE_KEY"),
  }),
});
const db = getFirestore();
const sessions = await db.collection("streamSessions").where("userId", "==", uid).limit(5).get();
for (const s of sessions.docs) {
  const d = s.data();
  console.log(
    "session:",
    s.id,
    JSON.stringify({
      status: d.status,
      transport: d.transport,
      provider: d.provider,
      reservedSeconds: d.reservedSeconds,
      claimedAt: d.claimedAt?.toDate?.()?.toISOString() ?? d.claimedAt ?? null,
      activatedAt: d.activatedAt?.toDate?.()?.toISOString() ?? d.activatedAt ?? null,
      finalizedAt: d.finalizedAt?.toDate?.()?.toISOString() ?? d.finalizedAt ?? null,
      settledSeconds: d.settledSeconds ?? d.usedSeconds ?? null,
      generationSeconds: d.generationSeconds ?? null,
    })
  );
}
const txs = await db.collection("transactions").where("userId", "==", uid).limit(6).get();
for (const t of txs.docs) {
  const d = t.data();
  console.log(
    "tx:",
    t.id,
    JSON.stringify({ type: d.type, seconds: d.seconds, status: d.status, createdAt: d.createdAt?.toDate?.()?.toISOString() ?? null })
  );
}