// One-off probe: does Firebase's verification email actually arrive as a
// clickable HTML link? Creates a disposable mail.tm inbox, requests a real
// verification email via the production Identity Toolkit API (the exact call
// the client SDK makes), then dumps the delivered message for inspection.
// Cleanup: deletes the Firebase test user and the mail.tm account.
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);
const API_KEY = env.NEXT_PUBLIC_FIREBASE_API_KEY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- 1. disposable inbox ---------------------------------------------------
const domainsRes = await fetch("https://api.mail.tm/domains");
const domain = (await domainsRes.json())["hydra:member"][0].domain;
const address = `savatar-probe-${Date.now()}@${domain}`;
const mailPass = "Probe!23456789";
const accRes = await fetch("https://api.mail.tm/accounts", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ address, password: mailPass }),
});
if (!accRes.ok) throw new Error(`mail.tm account failed: ${accRes.status} ${await accRes.text()}`);
const acc = await accRes.json();
await sleep(1200);
const tokRes = await fetch("https://api.mail.tm/token", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ address, password: mailPass }),
});
const { token: mailToken } = await tokRes.json();
console.log(`[probe] inbox ready: ${address}`);

// --- 2. trigger the real verification email --------------------------------
const signupRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: address, password: "Probe!Passw0rd!", returnSecureToken: true }),
});
const signup = await signupRes.json();
if (!signup.idToken) throw new Error(`signUp failed: ${JSON.stringify(signup).slice(0, 300)}`);
const oobRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${API_KEY}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    requestType: "VERIFY_EMAIL",
    idToken: signup.idToken,
    continueUrl: "https://savatar.vercel.app/login?verified=1",
  }),
});
const oob = await oobRes.json();
console.log(`[probe] sendOobCode -> ${oobRes.status} ${oob.email ? "(email queued)" : JSON.stringify(oob).slice(0, 200)}`);

// --- 3. wait for delivery, dump the MIME -----------------------------------
let msg = null;
for (let i = 0; i < 18 && !msg; i += 1) {
  await sleep(5000);
  const listRes = await fetch("https://api.mail.tm/messages", { headers: { Authorization: `Bearer ${mailToken}` } });
  const list = await listRes.json();
  msg = list["hydra:member"]?.[0] ?? null;
  if (i === 5 && !msg) console.log("[probe] still waiting...");
}
if (!msg) throw new Error("verification email did not arrive within 90s");
const fullRes = await fetch(`https://api.mail.tm/messages/${msg.id}`, { headers: { Authorization: `Bearer ${mailToken}` } });
const full = await fullRes.json();

console.log("\n=== DELIVERED EMAIL ===");
console.log("from:", JSON.stringify(full.from));
console.log("subject:", full.subject);
const html = Array.isArray(full.html) ? full.html.join("\n") : full.html;
const hasAnchor = /<a\s+href/i.test(html ?? "");
const anchorMatch = html?.match(/<a\s+href="([^"]{0,120})/i);
console.log("has text/plain part:", typeof full.text === "string" && full.text.length > 0);
console.log("has HTML part:", !!html);
console.log("HTML contains clickable anchor:", hasAnchor);
if (anchorMatch) console.log("anchor href starts:", anchorMatch[1]);
console.log("--- HTML body (first 600 chars) ---");
console.log((html ?? "(none)").slice(0, 600));
console.log("--- text/plain part (first 300 chars) ---");
console.log((full.text ?? "(none)").slice(0, 300));

// --- 4. cleanup --------------------------------------------------------------
const del1 = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${API_KEY}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ idToken: signup.idToken }),
});
console.log(`\n[cleanup] firebase test user deleted: ${del1.ok}`);
const del2 = await fetch(`https://api.mail.tm/accounts/${acc.id}`, {
  method: "DELETE",
  headers: { Authorization: `Bearer ${mailToken}` },
});
console.log(`[cleanup] mail.tm inbox deleted: ${del2.status === 204}`);
