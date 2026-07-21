"""
Auth script: Open browser → you log into DeepSeek → session saved.

Usage:
    pip install playwright && playwright install chromium
    python setup_deepseek.py

Then copy session.json content to Render env var DEEPSEEK_SESSION.
"""
import json
import os
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SESSION_FILE = ROOT / "session" / "session.json"
PROFILE_DIR = ROOT / "session" / "profile"
CHAT_URL = "https://chat.deepseek.com/"

READ_TOKEN_JS = """
() => {
  try {
    const raw = window.localStorage.getItem('userToken');
    if (!raw) return null;
    const o = JSON.parse(raw);
    return (o && o.value) ? o.value : null;
  } catch (e) { return null; }
}
"""

def main():
    print("=" * 60)
    print("  ScholarVoice — DeepSeek Session Setup")
    print("=" * 60)
    print()
    print("Chrome sẽ mở ra → bạn đăng nhập DeepSeek bằng tay")
    print("(email + mật khẩu hoặc Google, làm CAPTCHA nếu có)")
    print("Đăng nhập xong thì đóng Chrome lại.")
    print()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("❌ Chưa cài playwright. Chạy lệnh này trước:")
        print("   pip install playwright && playwright install chromium")
        return

    PROFILE_DIR.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        try:
            context = p.chromium.launch_persistent_context(
                str(PROFILE_DIR),
                headless=False,
                channel="chrome",
                args=["--disable-blink-features=AutomationControlled"],
            )
        except Exception:
            context = p.chromium.launch_persistent_context(
                str(PROFILE_DIR),
                headless=False,
                args=["--disable-blink-features=AutomationControlled"],
            )

        page = context.pages[0] if context.pages else context.new_page()
        page.goto(CHAT_URL, wait_until="commit", timeout=60000)
        page.wait_for_timeout(2000)

        print("⏳ Đợi bạn đăng nhập... (tối đa 5 phút)")
        deadline = time.time() + 300
        token = None
        while time.time() < deadline:
            try:
                token = page.evaluate(READ_TOKEN_JS)
            except Exception:
                pass
            if token:
                break
            page.wait_for_timeout(1000)

        if not token:
            print("❌ Hết thời gian — không thấy token.")
            context.close()
            return

        cookies = {c["name"]: c["value"] for c in context.cookies()}
        ua = page.evaluate("() => navigator.userAgent") or ""
        context.close()

        session = {
            "token": token,
            "cookies": cookies,
            "user_agent": ua,
            "captured_at": time.time(),
        }

        SESSION_FILE.parent.mkdir(parents=True, exist_ok=True)
        SESSION_FILE.write_text(json.dumps(session, indent=2), encoding="utf-8")

        print()
        print("=" * 60)
        print("  ✅ ĐĂNG NHẬP THÀNH CÔNG!")
        print("=" * 60)
        print()
        print("📋 Nội dung DEEPSEEK_SESSION (copy đoạn dưới đây):")
        print("-" * 60)
        print(json.dumps(session, ensure_ascii=False))
        print("-" * 60)
        print()
        print("👉 Vào Render Dashboard → scholarvoice → Environment")
        print('👉 Thêm biến: Key = DEEPSEEK_SESSION')
        print('👉 Value = dán toàn bộ đoạn JSON phía trên')
        print("👉 Save → Render tự restart → XONG!")
        print()
        print(f"💾 File cũng đã lưu ở: {SESSION_FILE}")


if __name__ == "__main__":
    main()
