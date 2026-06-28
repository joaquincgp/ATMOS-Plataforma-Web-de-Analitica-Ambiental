"""Standalone REMMAQ reverse proxy.

Run this on a machine that can reach `datosambiente.quito.gob.ec` without IP
restrictions, then expose it publicly (e.g. `ngrok http 8080`) and point
`REMMAQ_PROXY_BASE_URL` at the public URL on whichever backend instance needs
it (see apps/backend/README.md). The main backend rewrites every REMMAQ
request to go through that URL instead, keeping the same path and query
string, so this proxy only has to mirror REMMAQ's own responses 1:1.

Run with:
    cd apps/backend
    python scripts/remmaq_proxy.py [--port 8080]

Deliberately defaults to a different port than the main app (8000) so both
can run on the same machine during testing without colliding.
"""
from __future__ import annotations

import argparse

import httpx
import uvicorn
from fastapi import FastAPI, Request, Response

REMMAQ_BASE_URL = "https://datosambiente.quito.gob.ec"
DEFAULT_PORT = 8080
REQUEST_TIMEOUT_SECONDS = 60

_BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-EC,es;q=0.9,en-US;q=0.8",
    "Accept-Encoding": "gzip, deflate",
}

_EXCLUDED_RESPONSE_HEADERS = {"content-encoding", "transfer-encoding", "connection"}

app = FastAPI(title="REMMAQ reverse proxy")


@app.api_route("/{path:path}", methods=["GET", "HEAD"])
async def proxy(path: str, request: Request) -> Response:
    target_url = f"{REMMAQ_BASE_URL}/{path}"
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=REQUEST_TIMEOUT_SECONDS) as client:
            upstream = await client.get(target_url, params=request.query_params, headers=_BROWSER_HEADERS)
    except httpx.HTTPError as exc:
        print(f"[REMMAQ-PROXY] {request.method} {path} -> error: {exc!r}", flush=True)
        return Response(
            content=f"No se pudo contactar a REMMAQ a traves de este proxy: {exc}",
            status_code=502,
            media_type="text/plain",
        )

    print(
        f"[REMMAQ-PROXY] {request.method} {path} -> {upstream.status_code} ({len(upstream.content)} bytes)",
        flush=True,
    )
    headers = {k: v for k, v in upstream.headers.items() if k.lower() not in _EXCLUDED_RESPONSE_HEADERS}
    return Response(content=upstream.content, status_code=upstream.status_code, headers=headers)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args()
    uvicorn.run(app, host="0.0.0.0", port=args.port)
