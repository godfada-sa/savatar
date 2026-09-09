import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  type Unsubscribe,
} from "firebase/firestore";
import { getAuthInstance, getDb } from "./firebase";

async function mutateFeed(body: Record<string, unknown>) {
  const user = getAuthInstance().currentUser;
  if (!user) throw new Error("Sign in to continue");
  const response = await fetch("/api/feed", { method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
    body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Unable to update the feed");
}


export interface FeedPost {
  id: string;
  authorId: string;
  authorName: string;
  authorPhoto: string;
  content: string;
  createdAt: string;
  likedBy: Record<string, true>;
  likeCount: number;
  commentCount: number;
  liked: boolean;
}

export interface FeedComment {
  id: string;
  authorId: string;
  authorName: string;
  authorPhoto: string;
  content: string;
  createdAt: string;
}

const POST_LIMIT = 30;
const COMMENT_LIMIT = 200;

/** Subscribe to the latest posts, newest first. Returns an unsubscribe fn. */
export function subscribeFeed(uid: string, onPosts: (posts: FeedPost[]) => void): Unsubscribe {
  const q = query(collection(getDb(), "posts"), orderBy("createdAt", "desc"), limit(POST_LIMIT));
  return onSnapshot(q, (snap) => {
    const posts = snap.docs.map((d) => {
      const data = d.data() as Omit<FeedPost, "id" | "liked">;
      const likedBy = (data.likedBy || {}) as Record<string, true>;
      return {
        ...data,
        id: d.id,
        likedBy,
        likeCount: data.likeCount ?? 0,
        commentCount: data.commentCount ?? 0,
        liked: uid in likedBy,
      };
    });
    onPosts(posts);
  });
}

export interface AuthorInfo {
  uid: string;
  name: string;
  photoURL: string;
}

export async function createPost(_author: AuthorInfo, content: string): Promise<void> {
  await mutateFeed({ action: "post", content });
}

/** Toggle the current user's like on a post. Resolves to the new liked state. */
export async function toggleLike(postId: string, _uid: string): Promise<boolean> {
  void _uid;
  const user = getAuthInstance().currentUser;
  if (!user) throw new Error("Sign in to continue");
  const token = await user.getIdToken();
  const response = await fetch("/api/feed", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: "like", postId }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Failed to update like");

  // The real liked state snaps in via the onSnapshot subscription
  // immediately after the server write completes.
  return true;
}

export async function addComment(postId: string, _author: AuthorInfo, content: string): Promise<void> {
  await mutateFeed({ action: "comment", postId, content });
}

export function subscribeComments(
  postId: string,
  onComments: (comments: FeedComment[]) => void,
): Unsubscribe {
  const q = query(
    collection(getDb(), "posts", postId, "comments"),
    orderBy("createdAt", "asc"),
    limit(COMMENT_LIMIT),
  );
  return onSnapshot(q, (snap) => {
    onComments(
      snap.docs.map((d) => ({ ...(d.data() as FeedComment), id: d.id })),
    );
  });
}

export async function deleteComment(postId: string, commentId: string): Promise<void> {
  await mutateFeed({ action: "deleteComment", postId, commentId });
}

export async function deletePost(postId: string): Promise<void> {
  await mutateFeed({ action: "deletePost", postId });
}

/** Compact relative time for feed timestamps. */
export function timeAgo(createdAt: string): string {
  const then = new Date(createdAt).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
