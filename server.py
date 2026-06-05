import http.server
import socketserver
import json
import urllib.request
import urllib.error
import asyncio
import os
import hashlib
import edge_tts

class MyHandler(http.server.SimpleHTTPRequestHandler):
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
        # Proxy cho NVIDIA API
        if self.path == '/api/nvidia':
            self._proxy_nvidia()
        elif self.path == '/api/tts':
            self._handle_tts()
        elif self.path == '/api/openrouter':
            self._proxy_openrouter()
        elif self.path == '/api/cloudflare':
            self._proxy_cloudflare()
        else:
            self.send_error(404)

    def _proxy_cloudflare(self):
        try:
            # Doc body tu browser
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body)

            # Lay cac truong thong tin Cloudflare va xoa khoi body gui len Cloudflare
            account_id = data.pop('_account_id', '')
            api_token = data.pop('_api_token', '')
            model = data.pop('_model', '')

            # Target URL cua Cloudflare Workers AI
            target_url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model}"

            # Gui request den Cloudflare
            req = urllib.request.Request(
                target_url,
                data=json.dumps(data).encode('utf-8'),
                headers={
                    'Content-Type': 'application/json',
                    'Authorization': f'Bearer {api_token}',
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

    def _handle_tts(self):
        """Sinh MP3 giọng đọc tiếng Việt bằng Edge TTS, có cache + retry + atomic write"""
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body)

            text = data.get('text', '').strip()
            voice = data.get('voice', 'vi-VN-NamMinhNeural')

            if not text:
                self._send_json({'error': 'Thiếu text'}, 400)
                return

            cache_key = hashlib.md5((text + voice).encode()).hexdigest()
            cache_dir = os.path.join(os.path.dirname(__file__), 'tts_cache')
            os.makedirs(cache_dir, exist_ok=True)
            cache_path = os.path.join(cache_dir, cache_key + '.mp3')
            tmp_path = cache_path + '.tmp'

            # Nếu file cache tồn tại và kích thước >= 1KB → dùng luôn
            if os.path.exists(cache_path) and os.path.getsize(cache_path) >= 1024:
                pass  # dùng cache
            else:
                # Ghi vào temp trước, rename atomic sau
                async def gen():
                    for attempt in range(3):
                        try:
                            comm = edge_tts.Communicate(text, voice)
                            await comm.save(tmp_path)
                            # Validate file
                            if not os.path.exists(tmp_path) or os.path.getsize(tmp_path) < 1024:
                                raise ValueError(f'MP3 quá nhỏ ({os.path.getsize(tmp_path)} bytes)')
                            os.replace(tmp_path, cache_path)
                            return
                        except Exception:
                            # Dọn temp nếu lỗi
                            try:
                                if os.path.exists(tmp_path):
                                    os.unlink(tmp_path)
                            except Exception:
                                pass
                            if attempt < 2:
                                await asyncio.sleep(1)
                            else:
                                raise
                asyncio.run(gen())

            with open(cache_path, 'rb') as f:
                mp3_data = f.read()

            self.send_response(200)
            self.send_header('Content-Type', 'audio/mpeg')
            self.send_header('Content-Length', len(mp3_data))
            self.send_header('Cache-Control', 'public, max-age=86400')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(mp3_data)

        except Exception as e:
            self._send_json({'error': str(e)}, 500)

    def _send_json(self, data, status=200):
        body = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', len(body))
        self.end_headers()
        self.wfile.write(body)

    def _proxy_openrouter(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body)

            api_key = self.headers.get('X-Api-Key', '')
            target_url = 'https://openrouter.ai/api/v1/chat/completions'

            req = urllib.request.Request(
                target_url,
                data=json.dumps(data).encode('utf-8'),
                headers={
                    'Content-Type': 'application/json',
                    'Authorization': f'Bearer {api_key}',
                    'HTTP-Referer': 'http://localhost:8080',
                    'X-Title': 'AI Giang Vien',
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

    def do_OPTIONS(self):
        # CORS preflight
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key')
        self.end_headers()

PORT = 8080
# Dung ThreadingHTTPServer de chay da luong, tranh nghen server khi goi API AI
with http.server.ThreadingHTTPServer(("0.0.0.0", PORT), MyHandler) as httpd:
    print(f"Server chay tai http://localhost:{PORT}")
    print(f"Truy cap tu may that: http://192.168.1.25:{PORT}")
    httpd.serve_forever()
