# Savatar frontend

Next.js frontend and server API routes for Savatar.

## Local setup

1. Copy `.env.example` to `.env.local` and fill in the values.
2. Run `npm install`.
3. Run `npm run dev`.

The frontend uses `http://localhost:4000` for signaling by default. Start the signaling service with `npm start` from `../backend`.

## Production deployment

### 1. Deploy signaling

The Socket.IO process is stateful and long-running, so it must run separately from Vercel. The repository includes `render.yaml` and `backend/Dockerfile` for a Node/WebSocket host such as Render, Railway, Fly.io, or Cloud Run.

Set the signaling service's `ALLOWED_ORIGINS` to the comma-separated frontend origins, for example:

```text
https://savatar.example.com,https://your-project.vercel.app
```

### 2. Configure Vercel

Set the Vercel Root Directory to `frontend`. Copy every applicable variable from `.env.example` into Vercel Project Settings > Environment Variables. At minimum, configure:

- All six `NEXT_PUBLIC_FIREBASE_*` variables
- `NEXT_PUBLIC_DECART_API_KEY`
- `NEXT_PUBLIC_SIGNALING_URL` using the signaling service's HTTPS URL
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`
- `MOOLRE_API_USER`, `MOOLRE_PUBLIC_KEY`, and `MOOLRE_ACCOUNT_NUMBER`

Apply the values to Production and Preview as needed, then redeploy. `NEXT_PUBLIC_*` values are embedded during the build, so changing one requires a new deployment.

For reliable WebRTC across carrier and corporate networks, configure the optional `NEXT_PUBLIC_TURN_*` variables with credentials from a TURN provider.

### 3. Configure external consoles

- In Firebase Authentication, add the Vercel/custom domains to Authorized domains.
- In Moolre, set the account payment callback to `https://YOUR_FRONTEND_DOMAIN/api/payment/callback`.
- Restrict public API keys to the intended domains and APIs where the providers support restrictions.

The payment API derives prices and credits on the server, verifies the Firebase ID token, and confirms final transaction status with Moolre before updating a wallet.
