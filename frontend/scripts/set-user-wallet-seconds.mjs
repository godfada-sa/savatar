import { readFile } from "node:fs/promises";
import { cert, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const [email, secondsText] = process.argv.slice(2);
const seconds = Number(secondsText);
if (!email || !Number.isSafeInteger(seconds) || seconds < 0) throw new Error("Usage: node scripts/set-user-wallet-seconds.mjs user@example.com seconds");
const raw = await readFile(".env.local", "utf8");
const value = (name) => raw.split(/\r?\n/).find((line) => line.startsWith(`${name}=`))?.slice(name.length + 1).replace(/^"|"$/g, "").replace(/\\n/g, "\n");
initializeApp({ credential: cert({ projectId: value("FIREBASE_PROJECT_ID") ?? value("NEXT_PUBLIC_FIREBASE_PROJECT_ID"), clientEmail: value("FIREBASE_CLIENT_EMAIL"), privateKey: value("FIREBASE_PRIVATE_KEY") }) });
const db = getFirestore();
const users = await db.collection("users").where("email", "==", email).limit(1).get();
if (users.empty) throw new Error("User not found");
const user = users.docs[0];
await db.runTransaction(async (tx) => {
  const latest = await tx.get(user.ref);
  const used = Math.max(0, Number(latest.data()?.wallet?.totalUsed ?? 0));
  tx.update(user.ref, { wallet: { balanceSeconds: seconds, totalPurchased: seconds + used, totalUsed: used } });
  tx.set(db.collection("transactions").doc(), { userId: user.id, type: "admin", seconds, adjustment: true, note: "Lucy 2.5 credit conversion: 2 Decart credits per second", createdAt: FieldValue.serverTimestamp() });
});
console.log(`Wallet set to ${seconds} seconds for ${email}`);
