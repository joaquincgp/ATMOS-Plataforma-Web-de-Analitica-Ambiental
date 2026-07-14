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
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
import uvicorn
from fastapi import FastAPI, Request, Response
from starlette.responses import StreamingResponse

REMMAQ_BASE_URL = "https://datosambiente.quito.gob.ec"
DEFAULT_PORT = 8080

# Separate timeouts: allow up to 10 minutes to read large RAR files from
# REMMAQ (TMP/HUM/VEL archives can be slow), but fail fast on connection.
_TIMEOUT = httpx.Timeout(connect=30.0, read=600.0, write=30.0, pool=10.0)

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

# Persistent client so REMMAQ session cookies are retained across requests,
# preventing redirect loops that occur when each request starts cookieless.
_http_client: httpx.AsyncClient | None = None


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    global _http_client
    _http_client = httpx.AsyncClient(
        follow_redirects=True,
        timeout=_TIMEOUT,
        max_redirects=30,
    )
    try:
        yield
    finally:
        await _http_client.aclose()


app = FastAPI(title="REMMAQ reverse proxy", lifespan=lifespan)


@app.api_route("/{path:path}", methods=["GET", "HEAD"])
async def proxy(path: str, request: Request) -> Response:
    assert _http_client is not None
    target_url = f"{REMMAQ_BASE_URL}/{path}"
    try:
        req = _http_client.build_request(
            "GET", target_url, params=dict(request.query_params), headers=_BROWSER_HEADERS
        )
        upstream = await _http_client.send(req, stream=True)
    except httpx.HTTPError as exc:
        print(f"[REMMAQ-PROXY] {request.method} {path} -> error: {exc!r}", flush=True)
        return Response(
            content=f"No se pudo contactar a REMMAQ a traves de este proxy: {exc}",
            status_code=502,
            media_type="text/plain",
        )

    headers = {k: v for k, v in upstream.headers.items() if k.lower() not in _EXCLUDED_RESPONSE_HEADERS}
    status = upstream.status_code
    print(f"[REMMAQ-PROXY] {request.method} {path} -> {status} (streaming)", flush=True)

    async def _stream() -> AsyncIterator[bytes]:
        try:
            async for chunk in upstream.aiter_bytes(chunk_size=65536):
                yield chunk
        finally:
            await upstream.aclose()

    return StreamingResponse(
        _stream(),
        status_code=status,
        headers=headers,
        media_type=upstream.headers.get("content-type", "application/octet-stream"),
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args()
    uvicorn.run(app, host="0.0.0.0", port=args.port)
