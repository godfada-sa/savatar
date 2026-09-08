// Rebuilds frontend/.env.local from environment variables for CI runs.
// Usage: node scripts/restore-test-env.mjs   (all four vars must be set)
import { writeFileSync } from "node:fs";

const required = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "NEXT_PUBLIC_FIREBASE_API_KEY",
];

const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

const lines = required
  .map((key) => {
    const value = process.env[key];
    // Multiline secrets (private keys) are stored with literal \n like dotenv.
    return `${key}=${value.includes("\n") ? JSON.stringify(value) : value}`;
  });
writeFileSync(new URL("../.env.local", import.meta.url), `${lines.join("\n")}\n`);
console.log("frontend/.env.local restored for CI");
