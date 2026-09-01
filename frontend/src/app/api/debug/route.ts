import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const debug: Record<string, unknown> = {};
  
  // Check env vars exist
  debug.has_FIREBASE_PROJECT_ID = !!process.env.FIREBASE_PROJECT_ID;
  debug.has_FIREBASE_CLIENT_EMAIL = !!process.env.FIREBASE_CLIENT_EMAIL;
  debug.has_FIREBASE_PRIVATE_KEY = !!process.env.FIREBASE_PRIVATE_KEY;
  debug.has_MOOLRE_API_USER = !!process.env.MOOLRE_API_USER;
  debug.has_MOOLRE_PUBLIC_KEY = !!process.env.MOOLRE_PUBLIC_KEY;
  debug.has_MOOLRE_ACCOUNT_NUMBER = !!process.env.MOOLRE_ACCOUNT_NUMBER;
  
  // Check private key format
  const pk = process.env.FIREBASE_PRIVATE_KEY || "";
  debug.privateKeyLength = pk.length;
  debug.startsWithBegin = pk.startsWith("-----BEGIN");
  debug.endsWithEnd = pk.includes("END PRIVATE KEY");
  debug.hasLiteralBackslashN = pk.includes("\\n");
  debug.hasRealNewlines = pk.includes("\n");
  debug.firstChars = pk.slice(0, 30);
  
  // Check origin headers
  debug.origin = req.headers.get("origin");
  debug.forwardedHost = req.headers.get("x-forwarded-host");
  debug.nextUrlOrigin = req.nextUrl.origin;
  
  // Try initializing Firebase Admin
  try {
    const { getAdminServices } = await import("@/lib/firebase-admin");
    const { auth, db } = getAdminServices();
    debug.firebaseAdmin = "initialized successfully";
    
    // Try a simple Firestore read
    const testDoc = await db.collection("_test").doc("ping").get();
    debug.firestoreRead = testDoc.exists ? "exists" : "empty (but accessible)";
  } catch (err) {
    debug.firebaseAdminError = err instanceof Error ? err.message : String(err);
  }
  
  return NextResponse.json(debug);
}
