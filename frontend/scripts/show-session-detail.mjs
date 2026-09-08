import { readFile } from "node:fs/promises";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const id = process.argv[2];
if (!id) throw new Error("Usage: node scripts/show-session-detail.mjs SESSION_ID");
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
const d = (await getFirestore().collection("streamSessions").doc(id).get()).data();
if (!d) {
  console.log("not found");
  process.exit(1);
}
for (const [k, v] of Object.entries(d)) {
  if (v && typeof v === "object" && "toDate" in v) console.log(k, "=", v.toDate().toISOString());
  else if (typeof v === "string" && (k.toLowerCase().includes("token") || k.includes("ticket"))) console.log(k, "=", `${v.slice(0, 24)}...`);
  else console.log(k, "=", JSON.stringify(v));
}
process.exit(0);