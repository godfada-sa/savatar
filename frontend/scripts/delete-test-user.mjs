// Delete a test user (auth + firestore docs) by email.
// Usage: node scripts/delete-test-user.mjs <email>
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const email = process.argv[2];
if (!email) throw new Error("Usage: node scripts/delete-test-user.mjs <email>");

const p = join(__dirname, "..", ".env.local");
const env = Object.fromEntries(
  readFileSync(p, "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      let v = l.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      return [l.slice(0, i).trim(), v];
    })
);

const { cert, initializeApp, getApps } = await import("firebase-admin/app");
const { getAuth } = await import("firebase-admin/auth");
const { getFirestore } = await import("firebase-admin/firestore");
if (getApps().length === 0) {
  initializeApp({
    credential: cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
    projectId: env.FIREBASE_PROJECT_ID,
  });
}

const auth = getAuth();
const db = getFirestore();
const users = await db.collection("users").where("email", "==", email).get();
let uid = null;
for (const d of users.docs) {
  uid = d.id;
  await d.ref.delete();
}
if (!uid) {
  // Email might not have a users doc; try auth lookup
  try {
    const rec = await auth.getUserByEmail(email);
    uid = rec.uid;
  } catch {}
}
if (uid) {
  const sessions = await db.collection("streamSessions").where("userId", "==", uid).get();
  for (const d of sessions.docs) await d.ref.delete();
  const txs = await db.collection("transactions").where("userId", "==", uid).get();
  for (const d of txs.docs) await d.ref.delete();
  await auth.deleteUser(uid).catch(() => {});
  console.log(`Deleted test user ${uid} (${email})`);
} else {
  console.log(`No user found for ${email}`);
}