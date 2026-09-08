import { privateJson } from "@/lib/server-security";

export const runtime = "nodejs";

// Browser-driven per-second debits were replaced by atomic reservations.
export async function POST() {
  return privateJson({ error: "This metering endpoint has been retired." }, { status: 410 });
}
