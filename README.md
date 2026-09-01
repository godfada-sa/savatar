# AvatarLive — AI Live Streaming Platform

Savatar — AI-powered live streaming platform.

## What This Is

A browser-based AI live streaming platform where creators can:
- Transform their camera feed in real-time using AI
- Switch between different AI modes (character, style, background, VFX)
- Stream to Twitch/YouTube/TikTok via RTMP
- Share watch pages with viewers

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, TypeScript, Tailwind CSS |
| Backend | Next.js API routes + Node.js signaling |
| AI Engine | Decart AI (Lucy 2.5) |
| Streaming | WebRTC + RTMP |

## Setup

### 1. Get Your Decart API Key (Free)

1. Go to **https://platform.decart.ai**
2. Click **Sign Up** (no credit card needed)
3. Go to Dashboard → API Keys → Create New Key
4. Copy your key

### 2. Install & Run Frontend

```bash
cd frontend

# Install dependencies
npm install

# Run development server
npm run dev
```

Frontend runs at http://localhost:3000

### 3. Open and Test

1. Go to http://localhost:3000
2. Click "Start Streaming"
3. Enter your Decart API key in settings (gear icon)
4. Start Camera → Choose a mode → Go Live!

## AI Modes

| Mode | Model | Price | What It Does |
|------|-------|-------|-------------|
| Character | Lucy 2.5 | $0.02/sec | Become any character |
| Style Transfer | Lucy Restyle 2 | $0.01/sec | Anime, cyberpunk, etc. |
| Background | Lucy 2.5 | $0.02/sec | Swap backgrounds |
| Virtual Try-On | Lucy VTON 3.5 | $0.02/sec | Change clothes live |
| VFX Effects | Lucy 2.5 | $0.02/sec | Fire, water, neon |

## Cost Examples

| Stream Length | Cost |
|--------------|------|
| 30 seconds | $0.60 (free with trial credits) |
| 1 minute | $1.20 |
| 5 minutes | $6.00 |
| 1 hour | $72.00 |

## Project Structure

```
avatar/
├── frontend/          # Next.js app
│   └── src/app/
│       ├── page.tsx           # Landing page
│       ├── layout.tsx         # Root layout
│       ├── globals.css        # Dark theme styles
│       └── dashboard/
│           └── page.tsx       # Streaming dashboard
├── backend/           # Authenticated Node.js signaling service
│   └── signaling.js
└── README.md
```

## Next Steps

- [ ] Add user accounts (Supabase or NextAuth)
- [ ] Add credit system (Stripe integration)
- [ ] Add watch pages for viewers
- [ ] Add RTMP output via OBS integration
- [ ] Deploy to production
