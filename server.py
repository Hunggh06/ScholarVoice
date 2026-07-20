import http.server
import socketserver
import json
import urllib.request
import urllib.error
import time
import os


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
    }

    def do_POST(self):
        if self.path == '/api/nvidia':
            self._proxy_nvidia()
        elif self.path == '/api/deepseek':
            self._proxy_deepseek()
        elif self.path == '/api/tts':
            self._proxy_tts()
        else:
            self.send_error(404)

    def _send_json(self, data, status=200):
        body = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _proxy_deepseek(self):
        # Throttle: đảm bảo cách nhau ít nhất 2 giây giữa các request
        elapsed = time.time() - MyHandler._last_deepseek_request
        if elapsed < MyHandler._deepseek_min_interval:
            time.sleep(MyHandler._deepseek_min_interval - elapsed)

        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body)

            base_url = data.pop('_target_url', 'http://localhost:18000')
            target_url = f'{base_url}/v1/chat/completions'

            req = urllib.request.Request(
                target_url,
                data=json.dumps(data).encode('utf-8'),
                headers={
                    'Content-Type': 'application/json',
                },
                method='POST'
            )

            with urllib.request.urlopen(req, timeout=180) as resp:
                result = resp.read()
                MyHandler._last_deepseek_request = time.time()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(result)

        except urllib.error.HTTPError as e:
            MyHandler._last_deepseek_request = time.time()
            error_body = e.read().decode('utf-8', errors='replace')
            self.send_response(e.code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(error_body.encode('utf-8'))

        except Exception as e:
            MyHandler._last_deepseek_request = time.time()
            self.send_response(503)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': {'message': str(e)}}).encode('utf-8'))

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
        # Sinh giong doc tu nhien qua edge-tts (Microsoft Neural TTS) - mien phi, khong can key
        # Tra ve audio mp3 (hoac audio/mpeg) de frontend phat bang <audio>
        try:
            import asyncio
            import io
            import edge_tts

            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body)

            text = (data.get('text') or '').strip()
            if not text:
                self.send_error(400, 'Thieu text')
                return

            voice = data.get('voice') or 'vi-VN-HoaiMyNeural'
            # edge-tts rate: dinh dang "+20%" / "-10%" / "0%"
            rate_pct = int(round(float(data.get('rate', 1.0)) * 100 - 100))
            rate = f"{rate_pct:+d}%"

            async def _gen():
                buf = io.BytesIO()
                communicate = edge_tts.Communicate(text, voice, rate=rate)
                async for chunk in communicate.stream():
                    if chunk["type"] == "audio":
                        buf.write(chunk["data"])
                return buf.getvalue()

            audio = asyncio.run(_gen())
            self.send_response(200)
            self.send_header('Content-Type', 'audio/mpeg')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Length', str(len(audio)))
            self.end_headers()
            self.wfile.write(audio)

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
