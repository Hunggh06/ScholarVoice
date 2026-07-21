"""
Pure-HTTP DeepSeek chat client — adapted for ScholarVoice.

Speaks chat.deepseek.com's internal API directly using a captured signed-in
session. No browser automation needed — session is provided manually.

Based on sums001/Deepseek-API (MIT license).
"""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass, field
from typing import Dict, Iterator, Optional

import httpx

from .pow import DeepSeekPow

BASE = "https://chat.deepseek.com"
COMPLETION_PATH = "/api/v0/chat/completion"
DEFAULT_MODEL_TYPE = "default"
_CID_SEP = ":"


# ---------------------------------------------------------------------------
# Session — self-contained (no auth.py / Playwright dependency)
# ---------------------------------------------------------------------------

@dataclass
class Session:
    """A captured signed-in DeepSeek session."""

    token: str
    cookies: Dict[str, str] = field(default_factory=dict)
    user_agent: str = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    )

    @classmethod
    def from_env(cls) -> Optional["Session"]:
        """Load session from DEEPSEEK_SESSION env var (JSON)."""
        import os
        raw = os.environ.get("DEEPSEEK_SESSION", "").strip()
        if not raw:
            return None
        try:
            data = json.loads(raw)
            return cls(
                token=data["token"],
                cookies=data.get("cookies", {}),
                user_agent=data.get("user_agent", cls.user_agent),
            )
        except (json.JSONDecodeError, KeyError):
            return None


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

@dataclass
class Reply:
    """A completed chat reply plus the id to resume the conversation."""
    text: str
    conversation_id: str

    def __str__(self) -> str:
        return self.text


def _encode_cid(session_id: str, message_id: Optional[int]) -> str:
    if message_id is None:
        return session_id
    return f"{session_id}{_CID_SEP}{message_id}"


def _decode_cid(conversation_id: Optional[str]) -> tuple[Optional[str], Optional[int]]:
    if not conversation_id:
        return None, None
    session_id, _, msg = conversation_id.partition(_CID_SEP)
    parent = int(msg) if msg.isdigit() else None
    return (session_id or None), parent


def _biz(data: dict) -> dict:
    """Unwrap DeepSeek's `data.biz_data` envelope, raising on API-level errors."""
    if data.get("code") != 0:
        raise RuntimeError(f"DeepSeek API error: {data.get('msg') or data}")
    biz = data.get("data", {}).get("biz_data")
    if biz is None:
        raise RuntimeError(f"Unexpected response shape: {data}")
    return biz


# ---------------------------------------------------------------------------
# OpenAI format helpers
# ---------------------------------------------------------------------------

def messages_to_prompt(messages: list[dict]) -> str:
    """Flatten OpenAI-format messages into a single prompt string."""
    if len(messages) == 1 and messages[0].get("role") == "user":
        content = messages[0].get("content", "")
        if isinstance(content, str):
            return content
        return ""
    role_labels = {"system": "System", "user": "User", "assistant": "Assistant"}
    lines = []
    for m in messages:
        label = role_labels.get(m.get("role", ""), m.get("role", "").capitalize())
        content = m.get("content", "")
        if not isinstance(content, str):
            content = ""
        lines.append(f"{label}: {content}")
    lines.append("Assistant:")
    return "\n\n".join(lines)


def _completion_response(model: str, content: str, prompt: str,
                         conversation_id: Optional[str] = None, stream: bool = False) -> dict:
    """Build an OpenAI-compatible chat completion response."""
    import time
    import uuid
    now = int(time.time())
    pt = max(1, len(prompt) // 4)
    ct = max(1, len(content) // 4)
    resp = {
        "id": "chatcmpl-" + uuid.uuid4().hex,
        "object": "chat.completion.chunk" if stream else "chat.completion",
        "created": now,
        "model": model,
        "choices": [{
            "index": 0,
            "delta" if stream else "message": (
                {"role": "assistant", "content": content}
                if stream else
                {"role": "assistant", "content": content}
            ),
            "finish_reason": "stop",
        }],
        "usage": {
            "prompt_tokens": pt,
            "completion_tokens": ct,
            "total_tokens": pt + ct,
        },
    }
    if conversation_id and not stream:
        resp["conversation_id"] = conversation_id
    return resp


# ---------------------------------------------------------------------------
# DeepSeekClient
# ---------------------------------------------------------------------------

class DeepSeekClient:
    def __init__(self, session: Session):
        self.session = session
        self._pow = DeepSeekPow()
        self._pow_lock = threading.Lock()
        self._http = httpx.Client(
            base_url=BASE,
            headers=self._base_headers(),
            cookies=self.session.cookies,
            timeout=httpx.Timeout(120.0, read=300.0),
        )

    def _base_headers(self) -> dict:
        return {
            "authorization": f"Bearer {self.session.token}",
            "accept": "*/*",
            "content-type": "application/json",
            "user-agent": self.session.user_agent,
            "origin": BASE,
            "referer": f"{BASE}/",
            "x-app-version": "2.0.0",
            "x-client-version": "2.0.0",
            "x-client-platform": "web",
            "x-client-locale": "en_US",
            "x-client-bundle-id": "com.deepseek.chat",
            "x-client-timezone-offset": "19800",
        }

    def create_chat_session(self) -> str:
        r = self._http.post("/api/v0/chat_session/create", json={})
        r.raise_for_status()
        return _biz(r.json())["chat_session"]["id"]

    def _pow_header(self, target_path: str = COMPLETION_PATH) -> str:
        r = self._http.post(
            "/api/v0/chat/create_pow_challenge", json={"target_path": target_path}
        )
        r.raise_for_status()
        challenge = _biz(r.json())["challenge"]
        with self._pow_lock:
            return self._pow.make_header(challenge)

    def stream(
        self,
        prompt: str,
        conversation_id: Optional[str] = None,
        model: Optional[str] = None,
        thinking: bool = False,
        search: bool = False,
    ) -> "_Stream":
        if conversation_id and model is not None:
            raise ValueError(
                "`model` cannot be set together with `conversation_id`"
            )
        session_id, parent_id = _decode_cid(conversation_id)
        if session_id is None:
            session_id = self.create_chat_session()
            model_type: Optional[str] = model or DEFAULT_MODEL_TYPE
        else:
            model_type = None
        return _Stream(self, prompt, session_id, parent_id, model_type, thinking, search)

    def chat(
        self,
        prompt: str,
        conversation_id: Optional[str] = None,
        model: Optional[str] = None,
        thinking: bool = False,
        search: bool = False,
    ) -> Reply:
        s = self.stream(prompt, conversation_id=conversation_id,
                        model=model, thinking=thinking, search=search)
        text = "".join(s)
        return Reply(text=text, conversation_id=s.conversation_id)

    def chat_openai(
        self,
        messages: list[dict],
        model: str = "deepseek-chat",
        conversation_id: Optional[str] = None,
        thinking: bool = False,
        search: bool = False,
        stream: bool = False,
    ) -> dict | Iterator[str]:
        """Handle an OpenAI-format chat completion request."""
        prompt = messages_to_prompt(messages)
        model_type = None if conversation_id else (
            "expert" if model == "deepseek-expert" else "default"
        )
        reply = self.chat(prompt, conversation_id=conversation_id,
                          model=model_type, thinking=thinking, search=search)
        if stream:
            return self._stream_generator(model, reply.text, prompt, reply.conversation_id)
        return _completion_response(model, reply.text, prompt, reply.conversation_id)

    def _stream_generator(self, model: str, text: str, prompt: str, cid: str) -> Iterator[str]:
        """Yield SSE chunks for streaming response."""
        import time
        import uuid
        cid_chunk = "chatcmpl-" + uuid.uuid4().hex
        now = int(time.time())
        def _chunk(content: str = "", finish: Optional[str] = None) -> str:
            obj = {
                "id": cid_chunk,
                "object": "chat.completion.chunk",
                "created": now,
                "model": model,
                "choices": [{"index": 0, "delta": {"content": content}, "finish_reason": finish}],
            }
            return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"
        # Simulate streaming: send characters in small chunks
        yield _chunk("", None)
        chunk_size = 5
        for i in range(0, len(text), chunk_size):
            yield _chunk(text[i:i+chunk_size])
        yield _chunk("", "stop")
        yield "data: [DONE]\n\n"

    def close(self) -> None:
        self._http.close()


class _Stream:
    def __init__(self, client: "DeepSeekClient", prompt: str, session_id: str,
                 parent_id: Optional[int], model: Optional[str],
                 thinking: bool, search: bool):
        self._client = client
        self._prompt = prompt
        self._session_id = session_id
        self._parent_id = parent_id
        self._model = model
        self._thinking = thinking
        self._search = search
        self._message_id: Optional[int] = None

    def __iter__(self) -> Iterator[str]:
        body = {
            "chat_session_id": self._session_id,
            "parent_message_id": self._parent_id,
            "prompt": self._prompt,
            "ref_file_ids": [],
            "thinking_enabled": self._thinking,
            "search_enabled": self._search,
            "action": None,
            "preempt": False,
        }
        if self._model is not None:
            body["model_type"] = self._model
        headers = {"x-ds-pow-response": self._client._pow_header()}
        meta: dict = {}
        with self._client._http.stream(
            "POST", COMPLETION_PATH, json=body, headers=headers
        ) as resp:
            resp.raise_for_status()
            yield from _parse_sse(resp.iter_lines(), meta)
        if meta.get("message_id") is not None:
            self._message_id = meta["message_id"]

    @property
    def conversation_id(self) -> str:
        return _encode_cid(self._session_id, self._message_id)


def _parse_sse(lines, meta: Optional[dict] = None) -> Iterator[str]:
    active_path: Optional[str] = None
    emitted_initial = False
    for line in lines:
        if not line or not line.startswith("data:"):
            continue
        payload = line[len("data:"):].strip()
        if not payload or payload == "[DONE]":
            continue
        try:
            obj = json.loads(payload)
        except json.JSONDecodeError:
            continue
        v = obj.get("v")
        if isinstance(v, dict) and "response" in v:
            if meta is not None:
                _capture_message_id(meta, v)
            for frag in v["response"].get("fragments", []):
                if frag.get("type") == "RESPONSE" and frag.get("content"):
                    active_path = "response/fragments/-1/content"
                    if not emitted_initial:
                        emitted_initial = True
                        yield frag["content"]
            continue
        if "p" in obj:
            active_path = obj["p"]
            if meta is not None and active_path.endswith("message_id") and isinstance(v, int):
                meta["message_id"] = v
            if obj.get("o") == "APPEND" and isinstance(v, str) and active_path.endswith("content"):
                yield v
            continue
        if isinstance(v, str) and active_path and active_path.endswith("content"):
            yield v


def _capture_message_id(meta: dict, snapshot: dict) -> None:
    for container in (snapshot.get("response"), snapshot):
        if isinstance(container, dict):
            mid = container.get("message_id", container.get("id"))
            if isinstance(mid, int):
                meta["message_id"] = mid
                return
