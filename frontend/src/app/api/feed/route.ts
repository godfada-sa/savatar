import { NextRequest } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminServices } from "@/lib/firebase-admin";
import { assertSameOrigin, clientIp, enforceRateLimit, errorJson, privateJson, readJsonObject, requireAuthenticatedUser, RequestError } from "@/lib/server-security";

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await requireAuthenticatedUser(req, { requireVerifiedEmail: true });
    const body = await readJsonObject(req, 8192);
    const { db } = getAdminServices();
    await enforceRateLimit(db, "feed-user", user.uid, 20, 60_000);
    await enforceRateLimit(db, "feed-ip", clientIp(req), 60, 60_000);
    const action = body.action;
    const validId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id);
    if (action === "post" || action === "comment") {
      if (action === "post") await enforceRateLimit(db, "feed-post", user.uid, 5, 60_000);
      const content = typeof body.content === "string" ? body.content.trim() : "";
      if (!content || content.length > (action === "post" ? 1000 : 500)) throw new RequestError(400, "Invalid content length");
      const profile = (await db.collection("users").doc(user.uid).get()).data();
      if (!profile) throw new RequestError(409, "Account profile unavailable");
      const data = { authorId: user.uid, authorName: String(profile.displayName).slice(0, 80),
        authorPhoto: String(profile.photoURL ?? "").slice(0, 2048), content, createdAt: new Date().toISOString() };
      if (action === "post") {
        await db.collection("posts").add({ ...data, likedBy: {}, likeCount: 0, commentCount: 0 });
      } else {
        if (!validId(body.postId)) throw new RequestError(400, "Invalid post");
        const ref = db.collection("posts").doc(body.postId);
        await db.runTransaction(async (tx) => {
          if (!(await tx.get(ref)).exists) throw new RequestError(404, "Post not found");
          tx.set(ref.collection("comments").doc(), data);
          tx.update(ref, { commentCount: FieldValue.increment(1) });
        });
      }
    } else if (action === "deletePost" || action === "deleteComment") {
      if (!validId(body.postId)) throw new RequestError(400, "Invalid post");
      const postRef = db.collection("posts").doc(body.postId);
      if (action === "deletePost") {
        if ((await postRef.get()).data()?.authorId !== user.uid) throw new RequestError(403, "Not your post");
        // Hide first; the rules prevent new client comments during cleanup.
        await postRef.delete();
        await db.recursiveDelete(postRef.collection("comments"));
      } else {
        if (!validId(body.commentId)) throw new RequestError(400, "Invalid comment");
        const commentRef = postRef.collection("comments").doc(body.commentId);
        await db.runTransaction(async (tx) => {
          const [post, comment] = await Promise.all([tx.get(postRef), tx.get(commentRef)]);
          if (!comment.exists) return;
          if (comment.data()?.authorId !== user.uid) throw new RequestError(403, "Not your comment");
          tx.delete(commentRef);
          if (post.exists) tx.update(postRef, { commentCount: Math.max(0, Number(post.data()?.commentCount ?? 0) - 1) });
        });
      }
    } else if (action === "like") {
      if (!validId(body.postId)) throw new RequestError(400, "Invalid post");
      const postRef = db.collection("posts").doc(body.postId);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(postRef);
        if (!snap.exists) throw new RequestError(404, "Post not found");
        const likedBy = (snap.data()?.likedBy || {}) as Record<string, true>;
        const liked = likedBy[user.uid];
        if (liked) {
          tx.update(postRef, { [`likedBy.${user.uid}`]: FieldValue.delete(), likeCount: FieldValue.increment(-1) });
        } else {
          tx.update(postRef, { [`likedBy.${user.uid}`]: true, likeCount: FieldValue.increment(1) });
        }
      });
    } else throw new RequestError(400, "Invalid feed action");
    return privateJson({ success: true });
  } catch (error) { return errorJson(error); }
}
