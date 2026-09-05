import type { User } from "firebase/auth";

export async function getOrCreateStreamRoomId(user: User): Promise<string> {
  const response = await fetch("/api/streaming/room", {
    method: "POST",
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
  });
  const result = await response.json();
  if (!response.ok || typeof result.roomId !== "string") throw new Error(result.error || "Unable to load your stream room");
  return result.roomId;
}
