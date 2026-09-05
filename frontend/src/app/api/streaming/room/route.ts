import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { getAdminServices } from "@/lib/firebase-admin";
import { assertSameOrigin, errorJson, privateJson, requireAuthenticatedUser } from "@/lib/server-security";

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await requireAuthenticatedUser(req);
    const { db } = getAdminServices();
    const ref = db.collection("users").doc(user.uid);
    const roomId = await db.runTransaction(async (tx) => {
      const profile = await tx.get(ref);
      if (!profile.exists) throw new Error("Profile unavailable");
      const existing = profile.data()?.streamRoomId;
      if (typeof existing === "string" && /^stream-[0-9a-f-]{36}$/.test(existing)) return existing;
      const id = `stream-${randomUUID()}`;
      tx.update(ref, { streamRoomId: id });
      return id;
    });
    return privateJson({ roomId });
  } catch (error) { return errorJson(error); }
}
