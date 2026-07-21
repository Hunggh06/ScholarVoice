"""DeepSeek free API client — no API key needed.

Uses a signed-in chat.deepseek.com session (token + cookies).
Session is provided via DEEPSEEK_SESSION env var on Render.
"""

from .client import DeepSeekClient, Reply, Session

__all__ = ["DeepSeekClient", "Reply", "Session"]
