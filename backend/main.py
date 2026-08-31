"""
Savatar Backend — Decart AI API Integration
Proxies requests to Decart's Lucy 2.5 API and handles credit tracking.
"""

import os
import httpx
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Savatar Backend", version="1.0.0")

# CORS — allow frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DECART_API_BASE = "https://api.platform.decart.ai/v1"


# ─── Models ──────────────────────────────────────────────
class SessionRequest(BaseModel):
    model: str = "lucy-2.5"
    prompt: str
    reference_image: str | None = None  # base64 or URL


class PromptUpdate(BaseModel):
    prompt: str


# ─── Health ──────────────────────────────────────────────
@app.get("/")
async def root():
    return {"status": "ok", "service": "Savatar Backend", "version": "1.0.0"}


@app.get("/health")
async def health():
    return {"status": "healthy"}


# ─── Models List ─────────────────────────────────────────
@app.get("/api/models")
async def list_models():
    """Return available Decart models and their pricing."""
    return {
        "realtime": [
            {"id": "lucy-2.5", "name": "Lucy 2.5", "price_per_sec": 0.02, "resolution": "720p", "fps": 30,
             "modes": ["character", "background", "object", "vfx"]},
            {"id": "lucy-restyle-2", "name": "Lucy Restyle 2", "price_per_sec": 0.01, "resolution": "720p", "fps": 30,
             "modes": ["style_transfer"]},
            {"id": "lucy-vton-3.5", "name": "Lucy VTON 3.5", "price_per_sec": 0.02, "resolution": "720p", "fps": 30,
             "modes": ["virtual_tryon"]},
        ],
        "video": [
            {"id": "lucy-2.5", "name": "Lucy 2.5 (Offline)", "price_per_sec": 0.04, "resolution": "720p"},
            {"id": "lucy-restyle-2", "name": "Lucy Restyle 2 (Offline)", "price_per_sec": 0.01, "resolution": "720p"},
        ],
        "image": [
            {"id": "lucy-image-2", "name": "Lucy Image 2", "price": 0.02, "resolution": "720p"},
        ],
    }


# ─── Pricing ─────────────────────────────────────────────
@app.get("/api/pricing")
async def pricing():
    """Return pricing information."""
    return {
        "currency": "USD",
        "realtime_per_sec": 0.02,
        "video_per_sec": 0.04,
        "image_per_generation": 0.02,
        "examples": {
            "30_sec_stream": 0.60,
            "1_min_stream": 1.20,
            "5_min_stream": 6.00,
            "1_hour_stream": 72.00,
        },
    }


# ─── Proxy: Create Realtime Session ──────────────────────
@app.post("/api/session/create")
async def create_session(req: SessionRequest, x_api_key: str = Header(...)):
    """Proxy session creation to Decart API."""
    async with httpx.AsyncClient(timeout=30) as client:
        payload = {
            "model": req.model,
            "prompt": {"text": req.prompt, "enhance": True},
        }
        if req.reference_image:
            payload["image"] = req.reference_image

        resp = await client.post(
            f"{DECART_API_BASE}/realtime/sessions",
            json=payload,
            headers={"Authorization": f"Bearer {x_api_key}"},
        )

        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)

        return resp.json()


# ─── Proxy: Update Prompt ────────────────────────────────
@app.post("/api/session/{session_id}/prompt")
async def update_prompt(session_id: str, req: PromptUpdate, x_api_key: str = Header(...)):
    """Update the active prompt on a running session."""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{DECART_API_BASE}/realtime/sessions/{session_id}/prompt",
            json={"text": req.prompt, "enhance": True},
            headers={"Authorization": f"Bearer {x_api_key}"},
        )

        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)

        return resp.json()


# ─── Proxy: End Session ──────────────────────────────────
@app.post("/api/session/{session_id}/end")
async def end_session(session_id: str, x_api_key: str = Header(...)):
    """End a running realtime session."""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{DECART_API_BASE}/realtime/sessions/{session_id}/end",
            headers={"Authorization": f"Bearer {x_api_key}"},
        )

        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)

        return resp.json()


# ─── Proxy: Submit Video Job ─────────────────────────────
@app.post("/api/video/submit")
async def submit_video(req: SessionRequest, x_api_key: str = Header(...)):
    """Submit an offline video processing job."""
    async with httpx.AsyncClient(timeout=30) as client:
        payload = {
            "model": req.model,
            "prompt": req.prompt,
        }
        if req.reference_image:
            payload["image"] = req.reference_image

        resp = await client.post(
            f"{DECART_API_BASE}/queue/submit",
            json=payload,
            headers={"Authorization": f"Bearer {x_api_key}"},
        )

        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)

        return resp.json()


# ─── Proxy: Edit Image ───────────────────────────────────
@app.post("/api/image/edit")
async def edit_image(req: SessionRequest, x_api_key: str = Header(...)):
    """Synchronous image edit."""
    async with httpx.AsyncClient(timeout=60) as client:
        payload = {
            "model": "lucy-image-2",
            "prompt": req.prompt,
            "resolution": "720p",
        }
        if req.reference_image:
            payload["image"] = req.reference_image

        resp = await client.post(
            f"{DECART_API_BASE}/process",
            json=payload,
            headers={"Authorization": f"Bearer {x_api_key}"},
        )

        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)

        return resp.json()


# ─── Run ─────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
