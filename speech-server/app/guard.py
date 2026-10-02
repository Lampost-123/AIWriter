"""Who the server answers: programs on this computer that mean to talk to it, never a web page.

The server listens on this computer only, but a page open in a browser here can still send it requests:
a "simple" cross-site request (a form post, or a fetch the browser sends without asking first), or a
request through a made-up name that points at this computer (DNS rebinding), which can read the reply.
So every request goes through `Guard`:

* The Host header must name this computer (localhost, 127.0.0.1 or ::1, any port). A page using a
  made-up name sends that name, so it can't read anything.
* A request that changes something (anything but GET or HEAD) must carry AI Write's header
  (`X-AIWrite: speech`, which speechFetch sends) or a body type a page can't send without asking first
  (JSON, audio). The server never says yes to a page asking, so a page can't drive it. MCreader's own
  requests, which are JSON, still work.

Pure ASGI and the standard library only, so it is tested without the server.
"""

import json

LOOPBACK = {"localhost", "127.0.0.1", "::1"}
# The header AI Write's main process sends with every request (src/main/speech/url.ts).
HEADER = "x-aiwrite"
# What a page can send without asking first (a CORS "simple" request); any other type needs its permission.
SIMPLE_TYPES = {"application/x-www-form-urlencoded", "multipart/form-data", "text/plain"}
# Requests that only read.
READING = {"GET", "HEAD"}


def host_name(host: str) -> str:
    """The name in a Host header, without its port ("127.0.0.1:8766" → "127.0.0.1", "[::1]:8766" → "::1")."""
    host = host.strip().lower()
    if host.startswith("["):
        end = host.find("]")
        return host[1:end] if end > 0 else ""
    if host.count(":") == 1:
        return host.split(":", 1)[0]
    return host


def host_ok(host: str) -> bool:
    return host_name(host) in LOOPBACK


def sent_on_purpose(headers: dict[str, str]) -> bool:
    """A request a page couldn't have sent without asking first: AI Write's header, or a body type that needs asking."""
    if headers.get(HEADER, "").strip():
        return True
    kind = headers.get("content-type", "").split(";", 1)[0].strip().lower()
    return bool(kind) and kind not in SIMPLE_TYPES


def refusal(method: str, headers: dict[str, str]) -> tuple[int, str] | None:
    """Why a request is refused (its status and plain words), or None when it may go ahead."""
    if not host_ok(headers.get("host", "")):
        return 400, "This speech server only answers programs on this computer."
    if method.upper() not in READING and not sent_on_purpose(headers):
        return 403, "This speech server only takes requests sent on purpose: as JSON or audio, or with AI Write’s header."
    return None


class Guard:
    """ASGI middleware: refuses what `refusal` refuses, before the request reaches a route."""

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers") or []}
        refused = refusal(scope.get("method", "GET"), headers)
        if refused is None:
            await self.app(scope, receive, send)
            return
        status, message = refused
        body = json.dumps({"detail": message}, ensure_ascii=False).encode("utf-8")
        await send({
            "type": "http.response.start",
            "status": status,
            "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode("ascii"))],
        })
        await send({"type": "http.response.body", "body": body})
