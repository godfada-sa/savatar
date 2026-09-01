const firebaseVariables = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const firebaseVariableNames = {
  apiKey: "NEXT_PUBLIC_FIREBASE_API_KEY",
  authDomain: "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  projectId: "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  storageBucket: "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  appId: "NEXT_PUBLIC_FIREBASE_APP_ID",
} as const;

const missingFirebaseVariables = Object.entries(firebaseVariables)
  .filter(([, value]) => !value)
  .map(([name]) => firebaseVariableNames[name as keyof typeof firebaseVariableNames]);

if (missingFirebaseVariables.length > 0) {
  throw new Error(
    `Missing Firebase configuration: ${missingFirebaseVariables.join(", ")}. ` +
      "Add these variables to the Vercel project and redeploy."
  );
}

export const firebaseConfig = firebaseVariables as {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
};

export const signalingUrl = process.env.NEXT_PUBLIC_SIGNALING_URL ?? "http://localhost:4000";

const turnUrl = process.env.NEXT_PUBLIC_TURN_URL;
const turnUsername = process.env.NEXT_PUBLIC_TURN_USERNAME;
const turnCredential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL;

export const iceServers: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  ...(turnUrl && turnUsername && turnCredential
    ? [{ urls: turnUrl, username: turnUsername, credential: turnCredential }]
    : []),
];
