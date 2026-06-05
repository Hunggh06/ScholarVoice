# ScholarVoice 🎓

**Biến PDF thành bài giảng có giọng đọc tiếng Việt bằng AI**

ScholarVoice là công cụ web giúp bạn tải file PDF lên và nghe AI giảng bài bằng giọng tiếng Việt. Hỗ trợ chat thông minh về nội dung từng trang.

## Tính năng

- 📄 **Đọc PDF** — Xem PDF trực tiếp trên trình duyệt
- 🎓 **Giảng bài bằng AI** — Chọn phong cách Lướt / Trung bình / Chi tiết
- 💬 **Hỏi đáp thông minh** — Chat với AI về nội dung trang đang xem
- 🎙️ **Text-to-Speech tiếng Việt** — Giọng Nam/Nữ, điều chỉnh tốc độ
- 🔄 **Tự động đọc** — Tự động chuyển trang và đọc liên tục
- 💾 **Lưu âm thanh** — Export/Import cache giọng đọc

## Hỗ trợ AI

- ☁️ Gemini API
- 🟢 NVIDIA API
- 🔗 OpenRouter
- ☁️ Cloudflare Workers AI
- 🖥️ Ollama (local)

## Cài đặt & Chạy

### Yêu cầu
- Python 3.9+
- `edge-tts` (cho giọng đọc)

### Chạy local

```bash
pip install edge-tts
python server.py
```

Mở trình duyệt tại `http://localhost:8080`

### Deploy với Cloudflare Worker

File `cloudflare-worker.js` có thể deploy lên Cloudflare Workers để chạy serverless.

## Cách dùng

1. ⚙️ Vào **Cài đặt**, chọn nguồn AI và nhập API key
2. 📄 Kéo thả file PDF vào khung
3. 🎓 Nhấn **"Đọc"** để AI giảng nội dung trang
4. 💬 Chat với AI để hỏi về công thức, định nghĩa, ví dụ

## ⚠️ Lưu ý

Nội dung do AI tạo ra, **không cam kết chính xác 100%**. Luôn kiểm chứng với tài liệu gốc.

---

ScholarVoice v2.0 — Powered by AI — Made with ❤️
