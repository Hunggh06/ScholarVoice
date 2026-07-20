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
