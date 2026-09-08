import { readFile } from "node:fs/promises";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const email = process.argv[2];
if (!email) throw new Error("Usage: node scripts/inspect-user-wallet.mjs user@example.com");
const raw = await readFile(".env.local", "utf8");
const value = (name) => raw.split(/\r?\n/).find((line) => line.startsWith(`${name}=`))?.slice(name.length + 1).replace(/^"|"$/g, "").replace(/\\n/g, "\n");
initializeApp({ credential: cert({ projectId: value("FIREBASE_PROJECT_ID") ?? value("NEXT_PUBLIC_FIREBASE_PROJECT_ID"), clientEmail: value("FIREBASE_CLIENT_EMAIL"), privateKey: value("FIREBASE_PRIVATE_KEY") }) });
const db = getFirestore();
const snapshot = await db.collection("users").where("email", "==", email).get();
if (snapshot.empty) { console.log("user not found"); process.exit(1); }
const uid = snapshot.docs[0].id;
const sessions = await db.collection("streamSessions").where("userId", "==", uid).limit(8).get();
for (const s of sessions.docs) {
  const d = s.data();
  console.log(s.id, "| status:", d.status, "| transport:", d.transport ?? "-", "| reserved:", d.reservedSeconds, "| settled:", d.settledSeconds ?? "-", "| provider:", d.provider ?? "-", "| created:", d.createdAt?.toDate?.().toISOString() ?? "-");
}
