import http.server
import socketserver
import json
import urllib.request
import urllib.error
import time
import os
import threading

# DeepSeek free API — no API key needed, uses chat.deepseek.com session
from deepseek import DeepSeekClient, Session

# ---------------------------------------------------------------------------
# Global DeepSeek client (shared across all request threads)
# ---------------------------------------------------------------------------
_deepseek_client: DeepSeekClient | None = None
_deepseek_client_lock = threading.Lock()


def get_deepseek_client() -> DeepSeekClient | None:
    """Lazy-init the shared DeepSeek client from DEEPSEEK_SESSION env var."""
    global _deepseek_client
    if _deepseek_client is not None:
        return _deepseek_client
    with _deepseek_client_lock:
        if _deepseek_client is not None:
            return _deepseek_client
        session = Session.from_env()
        if session is None:
            print("[deepseek] ⚠️  DEEPSEEK_SESSION env var not set — DeepSeek will be unavailable.")
            print("[deepseek]    Cách lấy session:")
            print("[deepseek]    1. Clone https://github.com/sums001/Deepseek-API")
            print("[deepseek]    2. Chạy 'python -m deepseek.auth' → đăng nhập DeepSeek")
            print("[deepseek]    3. Copy nội dung file session/session.json")
            print("[deepseek]    4. Dán vào Render env var DEEPSEEK_SESSION")
            return None
        try:
            _deepseek_client = DeepSeekClient(session)
            print("[deepseek] ✅ Session loaded — ready to serve.")
        except Exception as e:
            print(f"[deepseek] ❌ Failed to init client: {e}")
            return None
    return _deepseek_client


class MyHandler(http.server.SimpleHTTPRequestHandler):
    _last_deepseek_request = 0
    _deepseek_min_interval = 2.0
    extensions_map = {
        '': 'application/octet-stream',
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.mjs': 'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
        '.ttf': 'font/ttf',
        '.pdf': 'application/pdf',
        '.vrm': 'model/vrm',
        '.glb': 'model/gltf-binary',
    }

    def do_POST(self):
        if self.path == '/api/nvidia':
            self._proxy_nvidia()
        elif self.path == '/api/deepseek':
            self._handle_deepseek()
        elif self.path == '/api/tts':
            self._proxy_tts()
        else:
            self.send_error(404)

    def do_GET(self):
        if self.path == '/api/deepseek/status':
            self._deepseek_status()
        else:
            super().do_GET()

    def _send_json(self, data, status=200):
        body = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _handle_deepseek(self):
        elapsed = time.time() - MyHandler._last_deepseek_request
        if elapsed < MyHandler._deepseek_min_interval:
            time.sleep(MyHandler._deepseek_min_interval - elapsed)

        client = get_deepseek_client()
        if client is None:
            MyHandler._last_deepseek_request = time.time()
            self._send_json({
                "error": {
                    "message": "DeepSeek chưa được cấu hình. Thêm DEEPSEEK_SESSION vào biến môi trường Render.",
                    "type": "deepseek_not_configured",
                }
            }, status=503)
            return

        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body)

            data.pop('_target_url', None)

            model = data.get('model', 'deepseek-chat')
            messages = data.get('messages', [])
            stream = data.get('stream', False)
            conversation_id = data.get('conversation_id')
            thinking = data.get('thinking', False)
            search = data.get('search', False)

            if not messages:
                self._send_json({"error": {"message": "Thiếu messages"}}, status=400)
                return

            result = client.chat_openai(
                messages=messages,
                model=model,
                conversation_id=conversation_id,
                thinking=thinking,
                search=search,
                stream=stream,
            )

            MyHandler._last_deepseek_request = time.time()

            if stream:
                self.send_response(200)
                self.send_header('Content-Type', 'text/event-stream')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Cache-Control', 'no-cache')
                self.end_headers()
                for chunk in result:
                    self.wfile.write(chunk.encode('utf-8'))
                    self.wfile.flush()
            else:
                self._send_json(result)

        except Exception as e:
            MyHandler._last_deepseek_request = time.time()
            err_msg = str(e)
            status = 503
            if '401' in err_msg or 'Unauthorized' in err_msg or 'token' in err_msg.lower():
                err_msg = "DeepSeek session đã hết hạn. Cần cập nhật DEEPSEEK_SESSION env var."
            self._send_json({"error": {"message": err_msg}}, status=status)

    def _deepseek_status(self):
        client = get_deepseek_client()
        self._send_json({
            "configured": client is not None,
            "status": "ready" if client else "not_configured",
            "hint": None if client else (
                "Thêm DEEPSEEK_SESSION env var. "
                "Chạy 'python -m deepseek.auth' local rồi copy session/session.json."
            ),
        })

    def _proxy_nvidia(self):
        try:
            # Doc body tu browser
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body)

            # Lay API key tu header
            api_key = self.headers.get('X-Api-Key', '')
            target_url = data.pop('_target_url', 'https://integrate.api.nvidia.com/v1/chat/completions')

            # Gui request den NVIDIA
            req = urllib.request.Request(
                target_url,
                data=json.dumps(data).encode('utf-8'),
                headers={
                    'Content-Type': 'application/json',
                    'Authorization': f'Bearer {api_key}',
                },
                method='POST'
            )

            with urllib.request.urlopen(req, timeout=120) as resp:
                result = resp.read()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(result)

        except urllib.error.HTTPError as e:
            error_body = e.read().decode('utf-8', errors='replace')
            self.send_response(e.code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(error_body.encode('utf-8'))

        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': {'message': str(e)}}).encode('utf-8'))

    def _proxy_tts(self):
        # Google Cloud TTS: key tu env (khong lo len trinh duyet), chay tot tren Render (khac edge-tts bi chan IP)
        try:
            api_key = os.environ.get('GOOGLE_TTS_KEY', '')
            if not api_key:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps(
                    {'error': {'message': 'Thieu GOOGLE_TTS_KEY trong bien moi truong'}}).encode('utf-8'))
                return

            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body)

            text = (data.get('text') or '').strip()
            if not text:
                self.send_error(400, 'Thieu text')
                return

            voice = data.get('voice') or 'vi-VN-Wavenet-A'
            rate = float(data.get('rate', 1.0))
            rate = max(0.25, min(4.0, rate))
            lang_code = '-'.join(voice.split('-')[:2]) if voice.count('-') >= 1 else 'vi-VN'

            payload = {
                'input': {'text': text},
                'voice': {'languageCode': lang_code, 'name': voice},
                'audioConfig': {'audioEncoding': 'MP3', 'speakingRate': rate},
            }
            req = urllib.request.Request(
                'https://texttospeech.googleapis.com/v1/text:synthesize?key=' + api_key,
                data=json.dumps(payload).encode('utf-8'),
                headers={'Content-Type': 'application/json'},
                method='POST',
            )
            with urllib.request.urlopen(req, timeout=60) as resp:
                result = json.loads(resp.read())
            audio_b64 = result.get('audioContent', '')
            import base64
            audio_bytes = base64.b64decode(audio_b64)

            self.send_response(200)
            self.send_header('Content-Type', 'audio/mpeg')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Length', str(len(audio_bytes)))
            self.end_headers()
            self.wfile.write(audio_bytes)

        except urllib.error.HTTPError as e:
            err = e.read().decode('utf-8', errors='replace')
            self.send_response(e.code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': {'message': err}}).encode('utf-8'))
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': {'message': str(e)}}).encode('utf-8'))

    def do_OPTIONS(self):
        # CORS preflight
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key')
        self.end_headers()

PORT = int(os.environ.get("PORT", 8080))
# Dung ThreadingHTTPServer de chay da luong, tranh nghen server khi goi API AI
with http.server.ThreadingHTTPServer(("0.0.0.0", PORT), MyHandler) as httpd:
    print(f"Server chay tai http://localhost:{PORT}")
    print(f"Truy cap tu may that: http://192.168.1.25:{PORT}")
    httpd.serve_forever()
