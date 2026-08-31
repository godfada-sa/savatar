# Savatar Dev Server

## How to reproduce artifacts
1. Copy `.env.local` from the main checkout: `copy ..\.env.local .` (inside `frontend/`)
2. Install dependencies: `cd frontend && npm install`

## How to run the server
1. `cd frontend && npm run dev`
2. Server starts on port 3000 by default. If another Next.js instance is already running, it picks a random port (check terminal output).
3. Existing dev servers: PID 936 on port 51594, PID 1432 attempted on port 49670.

## Existing servers
- **Port 51594** (PID 936) — main working dev server, healthy
- Kill with: `taskkill /PID 936 /F` to restart fresh
