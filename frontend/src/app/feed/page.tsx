"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import DashboardLayout from "@/components/DashboardLayout";
import {
  addComment,
  createPost,
  deleteComment,
  deletePost,
  subscribeComments,
  subscribeFeed,
  timeAgo,
  toggleLike,
  type FeedComment,
  type FeedPost,
} from "@/lib/feed";

const POST_MAX = 1000;
const COMMENT_MAX = 500;

function Avatar({
  name,
  photoURL,
  sizeClass,
  className = "",
}: {
  name: string;
  photoURL: string;
  sizeClass: string;
  className?: string;
}) {
  const initial = (name || "?").trim()[0]?.toUpperCase() || "?";
  if (photoURL) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoURL}
        alt={name}
        className={`${sizeClass} flex-shrink-0 rounded-full object-cover ${className}`}
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <div
      className={`${sizeClass} grid flex-shrink-0 place-items-center rounded-full bg-[#ff4a1d]/10 font-semibold text-[#e84314] ${className}`}
      aria-hidden="true"
    >
      {initial}
    </div>
  );
}

function CommentRow({
  comment,
  mine,
  onDelete,
}: {
  comment: FeedComment;
  mine: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="flex gap-2.5">
      <Avatar name={comment.authorName} photoURL={comment.authorPhoto} sizeClass="h-7 w-7 text-[10px]" />
      <div className="min-w-0 flex-1 rounded-lg bg-stone-100 px-3 py-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs font-semibold text-stone-900">{comment.authorName}</span>
          <span className="text-[10px] text-stone-400">{timeAgo(comment.createdAt)}</span>
        </div>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-stone-700">
          {comment.content}
        </p>
      </div>
      {mine && (
        <button
          type="button"
          onClick={() => {
            if (window.confirm("Delete this reply?")) onDelete();
          }}
          className="self-start px-1 text-[10px] text-stone-400 transition hover:text-red-500"
          aria-label="Delete reply"
        >
          Delete
        </button>
      )}
    </div>
  );
}

function CommentThread({
  post,
  currentUid,
  authorInfo,
  onError,
}: {
  post: FeedPost;
  currentUid: string;
  authorInfo: { name: string; photoURL: string };
  onError: (message: string) => void;
}) {
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    return subscribeComments(post.id, setComments);
  }, [post.id]);

  const submit = async () => {
    if (!draft.trim() || sending) return;
    setSending(true);
    try {
      await addComment(post.id, { uid: currentUid, ...authorInfo }, draft);
      setDraft("");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to send reply");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-3 space-y-3 border-t border-stone-200 pt-3">
      {comments.map((comment) => (
        <CommentRow
          key={comment.id}
          comment={comment}
          mine={comment.authorId === currentUid}
          onDelete={async () => {
            try {
              await deleteComment(post.id, comment.id);
            } catch (err) {
              onError(err instanceof Error ? err.message : "Failed to delete reply");
            }
          }}
        />
      ))}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, COMMENT_MAX))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Write a reply…"
          maxLength={COMMENT_MAX}
          className="flex-1 bg-white border border-stone-300 rounded-lg px-3 py-2 text-xs text-stone-900 placeholder-stone-400 focus:outline-none focus:border-[#ff4a1d] focus:ring-1 focus:ring-[#ff4a1d]/30 transition"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!draft.trim() || sending}
          className="shrink-0 px-3 py-2 rounded-lg bg-[#ff4a1d] hover:bg-[#e84314] disabled:opacity-40 text-white text-xs font-medium transition"
        >
          Reply
        </button>
      </div>
    </div>
  );
}

function PostCard({
  post,
  currentUid,
  onError,
}: {
  post: FeedPost;
  currentUid: string;
  onError: (message: string) => void;
}) {
  const { user, userData } = useAuth();
  const [commentsOpen, setCommentsOpen] = useState(false);

  const like = async () => {
    try {
      await toggleLike(post.id, currentUid);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to update like");
    }
  };

  const remove = async () => {
    if (!window.confirm("Delete this post? This can't be undone.")) return;
    try {
      await deletePost(post.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to delete post");
    }
  };

  return (
    <article className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="flex gap-3">
        <Avatar name={post.authorName} photoURL={post.authorPhoto} sizeClass="h-9 w-9 text-xs" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-stone-900">{post.authorName}</span>
            <span className="text-[11px] text-stone-400">{timeAgo(post.createdAt)}</span>
            {post.authorId === currentUid && (
              <button
                type="button"
                onClick={remove}
                className="ml-auto text-[10px] text-stone-400 transition hover:text-red-500"
              >
                Delete
              </button>
            )}
          </div>
          <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-stone-700">
            {post.content}
          </p>
          <div className="mt-3 flex items-center gap-4">
            <button
              type="button"
              onClick={like}
              aria-pressed={post.liked}
              className={`flex items-center gap-1.5 text-xs transition ${
                post.liked ? "font-semibold text-[#e84314]" : "text-stone-500 hover:text-stone-900"
              }`}
            >
              <svg
                className="h-4 w-4"
                fill={post.liked ? "currentColor" : "none"}
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.8}
                  d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                />
              </svg>
              {post.likeCount}
            </button>
            <button
              type="button"
              onClick={() => setCommentsOpen((open) => !open)}
              aria-expanded={commentsOpen}
              className={`flex items-center gap-1.5 text-xs transition ${
                commentsOpen ? "font-semibold text-[#e84314]" : "text-stone-500 hover:text-stone-900"
              }`}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.8}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
              {post.commentCount}
            </button>
          </div>
          {commentsOpen && (
            <CommentThread
              post={post}
              currentUid={currentUid}
              onError={onError}
              authorInfo={{
                name: userData?.displayName || user?.email?.split("@")[0] || "Creator",
                photoURL: userData?.photoURL || "",
              }}
            />
          )}
        </div>
      </div>
    </article>
  );
}

function FeedContent() {
  const { user, userData } = useAuth();
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    const unsub = subscribeFeed(
      user.uid,
      (next) => setPosts(next),
    );
    return unsub;
  }, [user]);

  const authorName =
    userData?.displayName || user?.email?.split("@")[0] || "Creator";

  const submitPost = async () => {
    if (!draft.trim() || posting || !user) return;
    setPosting(true);
    setError("");
    try {
      await createPost(
        { uid: user.uid, name: authorName, photoURL: userData?.photoURL || "" },
        draft,
      );
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post. Please try again.");
    } finally {
      setPosting(false);
    }
  };

  const showError = (message: string) => setError(message);

  return (
    <div className="p-3 sm:p-6">
      <div className="mx-auto w-full max-w-2xl">
        {/* Header */}
        <div className="rounded-xl border border-[#ff4a1d]/15 bg-[#ff4a1d]/6 p-5 sm:p-6">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#e84314]">
            Community
          </div>
          <h1 className="mt-1 text-xl font-bold text-stone-900">See what everyone&apos;s sharing</h1>
          <p className="mt-1 text-xs leading-5 text-stone-500">
            Post a message, reply, or like — everything here is shared publicly across every Savatar account.
          </p>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-600">
            {error}
          </div>
        )}

        {/* Composer */}
        <div className="mt-4 rounded-xl border border-stone-200 bg-white p-4">
          <div className="flex gap-3">
            <Avatar name={authorName} photoURL={userData?.photoURL || ""} sizeClass="h-9 w-9 text-xs" />
            <div className="flex-1">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, POST_MAX))}
                placeholder="What's on your mind?"
                rows={3}
                maxLength={POST_MAX}
                className="w-full resize-none bg-white px-3 py-2 text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:border-[#ff4a1d] focus:ring-1 focus:ring-[#ff4a1d]/30 rounded-lg border border-stone-300 transition"
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[11px] text-stone-400">
                  {draft.length}/{POST_MAX}
                </span>
                <button
                  type="button"
                  onClick={submitPost}
                  disabled={!draft.trim() || posting}
                  className="rounded-lg bg-[#ff4a1d] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#e84314] disabled:opacity-40"
                >
                  {posting ? "Posting…" : "Post"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Posts */}
        <div className="mt-4 space-y-3">
          {posts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-stone-300 bg-white px-6 py-12 text-center">
              <p className="text-sm font-semibold text-stone-900">No posts yet</p>
              <p className="mt-1 text-xs text-stone-500">
                Be the first to say something — your message appears for every creator on Savatar.
              </p>
            </div>
          ) : (
            posts.map((post) => (
              <PostCard key={post.id} post={post} currentUid={user!.uid} onError={showError} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default function FeedPage() {
  return (
    <DashboardLayout>
      <FeedContent />
    </DashboardLayout>
  );
}
