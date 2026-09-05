import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { getDb } from "./firebase";

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

export async function createPost(author: AuthorInfo, content: string): Promise<void> {
  const trimmed = content.trim();
  if (!trimmed) return;
  await setDoc(doc(collection(getDb(), "posts")), {
    authorId: author.uid,
    authorName: author.name,
    authorPhoto: author.photoURL,
    content: trimmed,
    createdAt: new Date().toISOString(),
    likedBy: {},
    likeCount: 0,
    commentCount: 0,
  });
}

/** Toggle the current user's like on a post. Resolves to the new liked state. */
export async function toggleLike(postId: string, uid: string): Promise<boolean> {
  const postRef = doc(getDb(), "posts", postId);
  return runTransaction(getDb(), async (tx) => {
    const snap = await tx.get(postRef);
    if (!snap.exists()) throw new Error("This post no longer exists.");
    const likedBy = (snap.data().likedBy || {}) as Record<string, true>;
    const liked = uid in likedBy;
    if (liked) {
      tx.update(postRef, {
        [`likedBy.${uid}`]: deleteField(),
        likeCount: increment(-1),
      });
    } else {
      tx.update(postRef, {
        [`likedBy.${uid}`]: true,
        likeCount: increment(1),
      });
    }
    return !liked;
  });
}

export async function addComment(
  postId: string,
  author: AuthorInfo,
  content: string,
): Promise<void> {
  const trimmed = content.trim();
  if (!trimmed) return;
  const postRef = doc(getDb(), "posts", postId);
  const commentRef = doc(collection(getDb(), "posts", postId, "comments"));
  await runTransaction(getDb(), async (tx) => {
    const snap = await tx.get(postRef);
    if (!snap.exists()) throw new Error("This post no longer exists.");
    tx.set(commentRef, {
      authorId: author.uid,
      authorName: author.name,
      authorPhoto: author.photoURL,
      content: trimmed,
      createdAt: new Date().toISOString(),
    });
    tx.update(postRef, { commentCount: increment(1) });
  });
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
  await deleteDoc(doc(getDb(), "posts", postId, "comments", commentId));
}

/**
 * Delete a post. The post doc goes first (allowed by rules for its author),
 * then any remaining comments are removed best-effort — the rules allow
 * clearing comments once their parent post is gone.
 */
export async function deletePost(postId: string): Promise<void> {
  await deleteDoc(doc(getDb(), "posts", postId));
  try {
    const commentsRef = collection(getDb(), "posts", postId, "comments");
    const snap = await getDocs(commentsRef);
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
  } catch {
    // Post is gone; orphan cleanup is best-effort.
  }
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
