"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import DashboardLayout from "@/components/DashboardLayout";

interface Post {
  id: string;
  user: string;
  avatar: string;
  content: string;
  timestamp: string;
  likes: number;
  comments: number;
  liked: boolean;
}

export default function FeedPage() {
  const { userData } = useAuth();
  const [postContent, setPostContent] = useState("");
  const [activeTab, setActiveTab] = useState<"home" | "explore" | "trending" | "messages" | "profile">("home");
  const [posts, setPosts] = useState<Post[]>([
    {
      id: "1",
      user: "StreamKing",
      avatar: "SK",
      content: "Just hit 100 followers! Thanks everyone for the support. Going live tonight with a new AI look!",
      timestamp: "2h ago",
      likes: 24,
      comments: 5,
      liked: false,
    },
    {
      id: "2",
      user: "AICreator",
      avatar: "AC",
      content: "The cyberpunk background is insane. Looks like I'm streaming from 2077.",
      timestamp: "4h ago",
      likes: 18,
      comments: 3,
      liked: true,
    },
    {
      id: "3",
      user: "GhanaTech",
      avatar: "GT",
      content: "Anyone else having issues with MoMo payments? My credits aren't showing up.",
      timestamp: "6h ago",
      likes: 8,
      comments: 12,
      liked: false,
    },
  ]);

  const trendingTopics = ["#AI", "#Streaming", "#Creators", "#Ghana", "#Tech", "#MoMo", "#Live"];

  const handlePost = () => {
    if (!postContent.trim()) return;
    const newPost: Post = {
      id: Date.now().toString(),
      user: userData?.displayName || "You",
      avatar: (userData?.displayName || "Y")[0].toUpperCase(),
      content: postContent,
      timestamp: "Just now",
      likes: 0,
      comments: 0,
      liked: false,
    };
    setPosts([newPost, ...posts]);
    setPostContent("");
  };

  const toggleLike = (postId: string) => {
    setPosts(
      posts.map((p) =>
        p.id === postId
          ? { ...p, liked: !p.liked, likes: p.liked ? p.likes - 1 : p.likes + 1 }
          : p
      )
    );
  };

  return (
    <DashboardLayout>
      <div className="p-3 sm:p-6">
        {/* Feed Tabs */}
        <div className="mb-5 flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-white/5 bg-[#111] p-1">
          {(["home", "explore", "trending", "messages", "profile"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`shrink-0 px-4 py-1.5 rounded-md text-xs font-medium transition capitalize ${
                activeTab === t ? "bg-indigo-500 text-white" : "text-neutral-400 hover:text-white"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Main Feed */}
          <div className="md:col-span-2 space-y-4">
            <h2 className="text-lg font-bold">Home</h2>
            <p className="text-xs text-neutral-500 -mt-2">Posts, likes, and comments from the community</p>

            {/* Post Composer */}
            <div className="p-4 rounded-xl bg-[#111] border border-white/5">
              <div className="flex gap-3">
                <div className="w-9 h-9 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-400 text-xs font-semibold flex-shrink-0">
                  {(userData?.displayName || "U")[0]}
                </div>
                <div className="flex-1">
                  <div className="text-xs text-neutral-500 mb-2">What&apos;s happening today?</div>
                  <textarea
                    value={postContent}
                    onChange={(e) => setPostContent(e.target.value)}
                    placeholder="What's on your mind?"
                    rows={3}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-indigo-500 transition resize-none"
                  />
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center gap-2">
                      <button className="px-3 py-1 rounded-lg bg-white/5 border border-white/10 text-[11px] text-neutral-400 hover:text-white transition">
                        Emoji
                      </button>
                      <button className="px-3 py-1 rounded-lg bg-white/5 border border-white/10 text-[11px] text-neutral-400 hover:text-white transition">
                        Everyone
                      </button>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] text-neutral-600">{postContent.length}/500</span>
                      <button
                        onClick={handlePost}
                        disabled={!postContent.trim()}
                        className="px-4 py-1.5 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 text-white text-xs font-medium rounded-lg transition"
                      >
                        Post
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Trending Topics */}
            <div className="p-4 rounded-xl bg-[#111] border border-white/5">
              <div className="text-[10px] text-neutral-500 uppercase tracking-wider font-semibold mb-3">
                Trending Topics
              </div>
              <div className="flex flex-wrap gap-2">
                {trendingTopics.map((topic) => (
                  <button
                    key={topic}
                    className="px-3 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-xs text-indigo-400 hover:bg-indigo-500/20 transition"
                  >
                    {topic}
                  </button>
                ))}
              </div>
            </div>

            {/* Posts */}
            {posts.map((post) => (
              <div key={post.id} className="p-4 rounded-xl bg-[#111] border border-white/5">
                <div className="flex gap-3">
                  <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-neutral-300 text-xs font-semibold flex-shrink-0">
                    {post.avatar}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white">{post.user}</span>
                      <span className="text-[11px] text-neutral-600">{post.timestamp}</span>
                    </div>
                    <p className="text-sm text-neutral-300 mt-1.5 leading-relaxed">{post.content}</p>
                    <div className="flex items-center gap-4 mt-3">
                      <button
                        onClick={() => toggleLike(post.id)}
                        className={`flex items-center gap-1 text-xs transition ${post.liked ? "text-indigo-400" : "text-neutral-500 hover:text-white"}`}
                      >
                        <svg className="w-3.5 h-3.5" fill={post.liked ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                        </svg>
                        {post.likes}
                      </button>
                      <button className="flex items-center gap-1 text-xs text-neutral-500 hover:text-white transition">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                        {post.comments}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Right Sidebar */}
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-[#111] border border-white/5">
              <h3 className="text-sm font-semibold mb-2">Community</h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="text-center p-2 rounded-lg bg-white/5">
                  <div className="text-neutral-500">Live creators</div>
                  <div className="font-bold text-white mt-0.5">0</div>
                </div>
                <div className="text-center p-2 rounded-lg bg-white/5">
                  <div className="text-neutral-500">Creators</div>
                  <div className="font-bold text-white mt-0.5">22,413</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
