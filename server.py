import http.server
import socketserver
import json
import urllib.request
import urllib.error


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
        if self.path == '/api/nvidia':
            self._proxy_nvidia()
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
