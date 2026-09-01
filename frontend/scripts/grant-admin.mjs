import { readFile } from "node:fs/promises";
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

function envValue(contents, name) {
  const line = contents.split(/\r?\n/).find((entry) => entry.startsWith(`${name}=`));
  return line?.slice(name.length + 1).replace(/^"|"$/g, "").replace(/\\n/g, "\n");
}

const email = process.argv[2];
if (!email) throw new Error("Usage: node scripts/grant-admin.mjs admin@example.com");

const env = await readFile(".env.local", "utf8");
const projectId = envValue(env, "FIREBASE_PROJECT_ID") ?? envValue(env, "NEXT_PUBLIC_FIREBASE_PROJECT_ID");
const clientEmail = envValue(env, "FIREBASE_CLIENT_EMAIL");
const privateKey = envValue(env, "FIREBASE_PRIVATE_KEY");
if (!projectId || !clientEmail || !privateKey) throw new Error("Firebase Admin credentials are required in .env.local");

initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId });
const user = await getAuth().getUserByEmail(email);
await getAuth().setCustomUserClaims(user.uid, { ...(user.customClaims ?? {}), admin: true });
console.log(`Admin claim granted to ${email}. Sign out and back in to refresh the ID token.`);
