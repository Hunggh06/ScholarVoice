# ScholarVoice 🎓

**Turn PDFs into AI-powered lecture audio in any language**

ScholarVoice is a web tool that lets you upload PDF files and have AI lecture on their content with voice in any language. It also supports intelligent Q&A about each page's content.

## Features

- 📄 **PDF Viewer** — View PDFs directly in your browser
- 🎓 **AI Lecture** — Choose from Brief / Medium / Detailed styles
- 💬 **Smart Q&A** — Chat with AI about the content of the current page
- 🎙️ **Multi-language TTS** — Supports any language voice on your system, adjustable speed
- 🔄 **Auto-read** — Auto-advance pages with continuous playback
- 💾 **Audio Cache** — Export/Import voice cache
- 🎭 **Custom Teacher Personality** — Add custom instructions like "speak slowly like an old professor", "add funny examples", "use Southern accent"...

## 📺 Demo

📥 [Download demo video](scholarvoice-demo.mp4)

## AI Providers

- ☁️ Gemini API
- 🟢 NVIDIA API
- 🔗 OpenRouter
- ☁️ Cloudflare Workers AI
- 🖥️ Ollama (local)

## Installation & Usage

### Requirements
- Python 3.9+

### Run locally

```bash
python server.py
```

Open your browser at `http://localhost:8080`

## How to use

1. ⚙️ Go to **Settings**, pick an AI provider and enter your API key
2. 📄 Drag & drop a PDF file into the upload area
3. 🎓 Click **"Teach"** to have AI lecture on the current page
4. 💬 Chat with AI to ask about formulas, definitions, examples

## ⚠️ Disclaimer

AI-generated content may contain inaccuracies. **Always verify** information against the original source before using it for study or research purposes.

---

ScholarVoice v2.0 — Powered by AI — Made with ❤️
