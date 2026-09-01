import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing server environment variable: ${name}`);
  }
  return value;
}

function getAdminApp() {
  if (getApps().length > 0) {
    return getApps()[0];
  }

  const projectId = required("FIREBASE_PROJECT_ID", process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID);
  const clientEmail = required("FIREBASE_CLIENT_EMAIL");
  
  // Handle all possible newline formats from Vercel env vars
  let privateKey = required("FIREBASE_PRIVATE_KEY");
  // Vercel may store newlines as literal \n (backslash + n)
  privateKey = privateKey.replace(/\\n/g, "\n");
  // Also handle double-escaped \\n
  privateKey = privateKey.replace(/\\\\n/g, "\n");
  // Clean up any extra whitespace around BEGIN/END markers
  privateKey = privateKey.replace(/\n\s+/g, "\n");

  return initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    projectId,
  });
}

export function getAdminServices() {
  const app = getAdminApp();
  return {
    auth: getAuth(app),
    db: getFirestore(app),
  };
}
