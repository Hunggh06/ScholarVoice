/**
 * AIEngine - Module gọi AI (hỗ trợ Gemini, NVIDIA, Ollama, OpenRouter)
 * Xử lý 2 chức năng: dạy học (voice only) và chat (voice + display)
 * Tự thích ứng prompt theo khả năng vision của model
 */
export class AIEngine {
  constructor() {
    const saved = JSON.parse(localStorage.getItem('ai_settings') || '{}');

    this.provider = saved.provider || 'gemini';

    // Gemini settings
    this.apiKey = saved.apiKey || '';
    this.geminiModel = saved.geminiModel || 'gemini-2.0-flash';
    this.geminiBaseUrl = 'https://generativelanguage.googleapis.com/v1beta';

    // Ollama settings
    this.ollamaUrl = saved.ollamaUrl || 'http://localhost:11434';
    this.ollamaModel = saved.ollamaModel || 'gemma4:e4b';
    this.ollamaVision = saved.ollamaVision !== undefined ? saved.ollamaVision : true;

    // NVIDIA settings
    this.nvidiaKey = saved.nvidiaKey || '';
    this.nvidiaModel = saved.nvidiaModel || 'deepseek-ai/deepseek-v4-flash';
    this.nvidiaVision = saved.nvidiaVision !== undefined ? saved.nvidiaVision : false;
    this.nvidiaBaseUrl = 'https://integrate.api.nvidia.com/v1';

    // OpenRouter settings
    this.openrouterKey = saved.openrouterKey || '';
    this.openrouterModel = saved.openrouterModel || 'google/gemini-2.0-flash-001';
    this.openrouterVision = saved.openrouterVision !== undefined ? saved.openrouterVision : true;

    this._abortController = null;
    this.pageCache = new Map();
    this.teachingStyle = saved.teachingStyle || 'medium';
    this.customStyle = saved.customStyle || '';

    // Bộ nhớ ngữ cảnh toàn bài: mỗi trang đã giảng lưu tóm tắt
    this.docContext = [];

    this.onDebug = null;
  }

  /** Lưu tất cả settings */
  saveSettings(settings) {
    const oldProvider = this.provider;
    if (settings.provider !== undefined) this.provider = settings.provider;
    if (settings.apiKey !== undefined) this.apiKey = settings.apiKey.trim();
    if (settings.geminiModel !== undefined) this.geminiModel = settings.geminiModel.trim();
    if (settings.ollamaUrl !== undefined) this.ollamaUrl = settings.ollamaUrl.trim();
    if (settings.ollamaModel !== undefined) this.ollamaModel = settings.ollamaModel.trim();
    if (settings.ollamaVision !== undefined) this.ollamaVision = settings.ollamaVision;
    if (settings.nvidiaKey !== undefined) this.nvidiaKey = settings.nvidiaKey.trim();
    if (settings.nvidiaModel !== undefined) this.nvidiaModel = settings.nvidiaModel.trim();
    if (settings.nvidiaVision !== undefined) this.nvidiaVision = settings.nvidiaVision;
    if (settings.openrouterKey !== undefined) this.openrouterKey = settings.openrouterKey.trim();
    if (settings.openrouterModel !== undefined) this.openrouterModel = settings.openrouterModel.trim();
    if (settings.openrouterVision !== undefined) this.openrouterVision = settings.openrouterVision;
    if (settings.teachingStyle !== undefined) this.teachingStyle = settings.teachingStyle;
    if (settings.customStyle !== undefined) this.customStyle = settings.customStyle;

    localStorage.setItem('ai_settings', JSON.stringify({
      provider: this.provider,
      apiKey: this.apiKey,
      geminiModel: this.geminiModel,
      ollamaUrl: this.ollamaUrl,
      ollamaModel: this.ollamaModel,
      ollamaVision: this.ollamaVision,
      nvidiaKey: this.nvidiaKey,
      nvidiaModel: this.nvidiaModel,
      nvidiaVision: this.nvidiaVision,
      openrouterKey: this.openrouterKey,
      openrouterModel: this.openrouterModel,
      openrouterVision: this.openrouterVision,
      teachingStyle: this.teachingStyle,
      customStyle: this.customStyle,
    }));

    // Chỉ xoá cache nếu đổi provider hoặc đổi style
    if (oldProvider !== this.provider) {
      this.pageCache.clear();
      this.docContext = [];
    }
  }

  getSettings() {
    return {
      provider: this.provider,
      apiKey: this.apiKey,
      geminiModel: this.geminiModel,
      ollamaUrl: this.ollamaUrl,
      ollamaModel: this.ollamaModel,
      ollamaVision: this.ollamaVision,
      nvidiaKey: this.nvidiaKey,
      nvidiaModel: this.nvidiaModel,
      nvidiaVision: this.nvidiaVision,
      openrouterKey: this.openrouterKey,
      openrouterModel: this.openrouterModel,
      openrouterVision: this.openrouterVision,
      teachingStyle: this.teachingStyle,
      customStyle: this.customStyle,
    };
  }

  /** Kiểm tra model hiện tại có hỗ trợ đọc ảnh không */
  hasVision() {
    if (this.provider === 'gemini') return true;
    if (this.provider === 'nvidia') return this.nvidiaVision === true;
    if (this.provider === 'openrouter') return this.openrouterVision === true;
    if (this.provider === 'ollama') return this.ollamaVision === true;
    return false;
  }

  get isConfigured() {
    if (this.provider === 'gemini') return this.apiKey.length > 0;
    if (this.provider === 'nvidia') return this.nvidiaKey.length > 0;
    if (this.provider === 'openrouter') return this.openrouterKey.length > 0;
    return this.ollamaUrl.length > 0 && this.ollamaModel.length > 0;
  }

  get hasApiKey() { return this.isConfigured; }
  getApiKey() { return this.apiKey; }
  setApiKey(key) {
    this.saveSettings({ apiKey: key, provider: 'gemini' });
  }

  abort() {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
  }

  _debug(type, data) {
    if (this.onDebug) this.onDebug({ time: Date.now(), type, ...data });
  }

  /**
   * Dạy học một trang PDF - tự động chọn prompt phù hợp với loại input
   * @param {string|null} imageBase64 - ảnh trang (null nếu model không có vision)
   * @param {number} pageNum - số trang
   * @param {string} pageText - text đã trích xuất có cấu trúc
   */
  async teachPage(imageBase64, pageNum, pageText, onStream) {
    const cached = this._getPageCache(pageNum);
    if (cached) return cached;

    const hasImage = imageBase64 && imageBase64.length > 100;
    const hasVision = this.hasVision();

    // Xây dựng ngữ cảnh từ các trang trước
    const contextText = this._buildContext(pageNum);

    const styleGuides = {
      brief: 'STYLE BRIEF: Extremely concise. Only mention 2-3 key points of the page. No deep explanation. Maximum 3-4 sentences.',
      medium: 'STYLE MEDIUM: Cover the full page content with brief explanations of important parts. Maximum 8-10 sentences.',
      detailed: 'STYLE DETAILED: Explain every part thoroughly. Elaborate on all formulas, definitions, concepts. Provide illustrative examples. Go deep into technical details.'
    };
    const styleGuide = styleGuides[this.teachingStyle] || styleGuides.medium;
    const customGuide = this.customStyle ? `\nCUSTOM STYLE: ${this.customStyle}` : '';

    const systemPrompt = `You are a SINGLE lecturer giving a continuous lecture across the entire document. This is page ${pageNum}.

${contextText}${styleGuide}${customGuide}

IMPORTANT - CONTINUITY:
- You have already lectured on previous pages, continue naturally as part of the same lesson.
- Start concisely like "Next we come to..." or "On this page..." or go straight into the content.
- Do not reintroduce yourself or greet again.

LANGUAGE RULE:
- Respond in the EXACT SAME LANGUAGE as the document content. If the document is in Vietnamese, lecture in Vietnamese. If it is in English, lecture in English. Match the language of the content automatically.

RULES:
- SINGLE continuous paragraph, no line breaks, no bullet points, no markdown, no asterisks.
- Verbalize formulas and equations in words in the same language as the content (e.g., in English: "P equals U times I", "x squared", "square root of x", "P prime", "f prime of x"; in Vietnamese: "p bằng u nhân i", "x bình phương", "căn x", "p phẩy", "ép phẩy x").
- Greek letters: pronounce them naturally in the content's language (e.g., α → "alpha", β → "beta", ε → "epsilon", ω → "omega").
- Abbreviations: spell out letter by letter in the content's language.
- Do not use symbols like = + - × $ ^ _ { }, replace them with words in the document's language.`;

    let userPrompt;
    let expectJson = false;
    if (hasImage && hasVision) {
      expectJson = true;
      userPrompt = `Lecture on the full content of the document page in the attached image.

IMPORTANT: Return the result as JSON with this structure:
{
  "segments": [
    {
      "explanation_text": "lecture content for this region, written as a SINGLE continuous paragraph, following all lecture rules from the system prompt",
      "region_vert": [0, 0.35]
    },
    {
      "explanation_text": "lecture content for the next region",
      "region_vert": [0.35, 0.65]
    }
  ]
}
region_vert is [top, bottom] as percentage of page height (values 0-1).
Split the page into vertical regions corresponding to each content section.
Do NOT add any text outside the JSON.`;
    } else {
      userPrompt = pageText
        ? `Lecture on the document page content below (lines starting with ## are headings, blank lines separate sections):\n\n${pageText}`
        : `Lecture on the document page content.`;
    }

    const effectiveImage = (hasImage && hasVision) ? imageBase64 : null;
    const rawResponse = await this._callAPI(userPrompt, effectiveImage, systemPrompt, false, pageText, onStream);

    // Parse response: vision mode → JSON segments, text mode → plain text
    let voiceText = rawResponse;
    let segments = null;

    if (expectJson) {
      const parsed = this._parseSegmentsJSON(rawResponse);
      if (parsed && parsed.segments && parsed.segments.length > 0) {
        segments = parsed.segments.map(s => ({
          text: s.explanation_text || s.text || s.content || '',
          regionVert: s.region_vert || [0, 1]
        }));
        voiceText = segments.map(s => s.text).join(' ');
      }
    }

    // Lưu tóm tắt vào bộ nhớ ngữ cảnh
    this._updateContext(pageNum, voiceText);

    const result = { voice_text: voiceText, segments };
    const cacheKey = `page_${pageNum}_${this.provider}_${this.teachingStyle}`;
    this.pageCache.set(cacheKey, result);
    return result;
  }

  /**
   * Trả lời câu hỏi trong chat
   */
  async askQuestion(question, imageBase64, pageText) {
    const systemPrompt = `You are a lecturer answering a student's question. Answer based on the document page content.

You MUST return valid JSON with exactly 2 fields:
{
  "voice_text": "...",
  "display_text": "..."
}

LANGUAGE RULE: Respond in the EXACT SAME LANGUAGE as the question and document content. If the student asks in Vietnamese, answer in Vietnamese. If in English, answer in English. Match the language automatically.`;

    const userPrompt = `Current page text content (for reference): ${pageText}

Student's question: ${question}

Answer in JSON with 2 fields:

1. "voice_text": Detailed explanation in a SINGLE continuous paragraph, NO line breaks, NO bullet points, NO numbering. Verbalize all formulas in words matching the content's language (e.g., in English: "P equals U times I", "P prime"; in Vietnamese: "p bằng u nhân i", "p phẩy"). Do NOT use math symbols or LaTeX. Spell out abbreviations letter by letter. Natural lecturer-like tone.

2. "display_text": CONCISE summary. Use LaTeX for formulas (e.g., $P'$ or $f'(x)$, do NOT write out formula words). Clear structure. Only key points, NO lengthy explanation.`;

    const hasImage = imageBase64 && imageBase64.length > 100;
    const hasVision = this.hasVision();
    const effectiveImage = (hasImage && hasVision) ? imageBase64 : null;

    const rawResponse = await this._callAPI(userPrompt, effectiveImage, systemPrompt, true, pageText);

    try {
      const parsed = JSON.parse(rawResponse);
      const voiceText = parsed.voice_text || parsed.voiceText || parsed.voice || parsed.speech || '';
      const displayText = parsed.display_text || parsed.displayText || parsed.display || parsed.text || '';
      return { voice_text: voiceText, display_text: displayText };
    } catch (e) {
      const jsonMatch = rawResponse.match(/\{[\s\S]*?(voice_text|voiceText|voice|displayText|display_text|display)[\s\S]*?\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          const voiceText = parsed.voice_text || parsed.voiceText || parsed.voice || parsed.speech || '';
          const displayText = parsed.display_text || parsed.displayText || parsed.display || parsed.text || '';
          return { voice_text: voiceText, display_text: displayText };
        } catch (e2) { /* fallback */ }
      }
      return { voice_text: rawResponse, display_text: rawResponse };
    }
  }

  /**
   * Router: gọi đúng provider
   */
  async _callAPI(prompt, imageBase64, systemPrompt, jsonMode, pageText) {
    const t0 = Date.now();
    this._debug('request', {
      provider: this.provider,
      model: this._getModelName(),
      vision: this.hasVision(),
      hasImage: !!(imageBase64 && imageBase64.length > 100),
      jsonMode,
      promptPreview: prompt.substring(0, 200),
    });

    let result;
    try {
      if (this.provider === 'ollama') {
        result = await this._callOllamaAPI(prompt, imageBase64, systemPrompt, jsonMode, pageText);
      } else if (this.provider === 'nvidia') {
        result = await this._callNvidiaAPI(prompt, imageBase64, systemPrompt, jsonMode, pageText);
      } else if (this.provider === 'openrouter') {
      } else {
        result = await this._callGeminiAPI(prompt, imageBase64, systemPrompt, jsonMode, pageText);
      }

      this._debug('response', {
        provider: this.provider,
        model: this._getModelName(),
        duration: `${Date.now() - t0}ms`,
        length: result?.length || 0,
        preview: (result || '').substring(0, 250),
      });
      return result;
    } catch (err) {
      this._debug('error', {
        provider: this.provider,
        model: this._getModelName(),
        duration: `${Date.now() - t0}ms`,
        message: err.message,
      });
      throw err;
    }
  }

  _getModelName() {
    if (this.provider === 'gemini') return this.geminiModel;
    if (this.provider === 'nvidia') return this.nvidiaModel;
    if (this.provider === 'openrouter') return this.openrouterModel;
    if (this.provider === 'ollama') return this.ollamaModel;
    return 'unknown';
  }

  /** Số token tối đa tuỳ theo phong cách dạy — giúp response nhanh hơn */
  _getMaxTokens() {
    switch (this.teachingStyle) {
      case 'brief': return 4096;
      case 'medium': return 8192;
      case 'detailed': return 8192;
      default: return 8192;
    }
  }

  /**
   * Lưu tóm tắt trang vào bộ nhớ ngữ cảnh
   */
  _updateContext(pageNum, voiceText) {
    // Xoá bản ghi cũ của trang này nếu có
    this.docContext = this.docContext.filter(c => c.page !== pageNum);
    // Lấy ~250 ký tự đầu làm tóm tắt
    const summary = (voiceText || '').substring(0, 250).trim();
    this.docContext.push({ page: pageNum, summary });
    // Sắp xếp theo số trang
    this.docContext.sort((a, b) => a.page - b.page);
  }

  /**
   * Xây dựng ngữ cảnh từ các trang trước để đưa vào prompt
   */
  _buildContext(currentPage) {
    const prev = this.docContext.filter(c => c.page < currentPage);
    if (prev.length === 0) return 'Đây là trang đầu tiên của tài liệu. Hãy giới thiệu và bắt đầu giảng.\n\n';

    let ctx = 'TÓM TẮT CÁC TRANG TRƯỚC BẠN ĐÃ GIẢNG:\n';
    for (const c of prev) {
      ctx += `- Trang ${c.page}: ${c.summary}\n`;
    }
    ctx += '\nHãy tiếp tục giảng trang hiện tại một cách tự nhiên, liên kết với những gì đã nói trước đó.\n\n';
    return ctx;
  }

  _parseSegmentsJSON(raw) {
    if (!raw || typeof raw !== 'string') return null;
    try {
      return JSON.parse(raw);
    } catch {
      // Try to extract JSON block from markdown
      const m = raw.match(/\{[\s\S]*"segments"[\s\S]*\}/);
      if (m) {
        try { return JSON.parse(m[0]); } catch {}
      }
    }
    return null;
  }

  /** Lấy kết quả từ cache (hỗ trợ cả format cũ và mới) */
  _getPageCache(pageNum) {
    const key = `page_${pageNum}_${this.provider}_${this.teachingStyle}`;
    const entry = this.pageCache.get(key);
    if (!entry) return null;
    if (typeof entry === 'string') {
      return { voice_text: entry, segments: null };
    }
    return entry;
  }

  clearCache() {
    this.pageCache.clear();
    this.docContext = [];
  }

  // ============================================================
  //  OPENROUTER API (OpenAI Compatible)
  // ============================================================

  async _callOpenRouterAPI(prompt, imageBase64, systemPrompt, jsonMode, pageText) {
    if (!this.openrouterKey) {
      throw new Error('Chưa nhập OpenRouter API key.');
    }

    const abortController = new AbortController();

    const isVisionModel = this.openrouterVision;
    let userContent;
    if (isVisionModel && imageBase64) {
      let textWithPrompt = prompt;
      if (pageText) {
        textWithPrompt = `${prompt}\n\nNội dung văn bản trong trang (tham khảo chính xác):\n${pageText}`;
      }
      userContent = [
        { type: 'text', text: textWithPrompt },
        {
          type: 'image_url',
          image_url: {
            url: `data:image/jpeg;base64,${imageBase64}`
          }
        }
      ];
    } else {
      userContent = prompt;
      if (pageText) {
        userContent = `${prompt}\n\nNội dung trang:\n${pageText}`;
      }
    }

    const body = {
      model: this.openrouterModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      max_tokens: this._getMaxTokens(),
      temperature: 0.7,
      top_p: 0.95,
    };

    if (jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    try {
      const response = await fetch('/api/openrouter', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': this.openrouterKey
        },
        body: JSON.stringify(body),
        signal: abortController.signal
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const errMsg = errData?.error?.message || `HTTP ${response.status}`;
        if (response.status === 401 || response.status === 403) {
          throw new Error('OpenRouter API key không hợp lệ. Kiểm tra lại.');
        }
        if (response.status === 429) {
          throw new Error('Vượt quá giới hạn OpenRouter API. Chờ một lát rồi thử lại.');
        }
        if (response.status === 402) {
          throw new Error('Tài khoản OpenRouter hết credit. Nạp thêm tại openrouter.ai.');
        }
        throw new Error(`Lỗi OpenRouter API: ${errMsg}`);
      }

      const data = await response.json();

      if (!data.choices?.length) {
        throw new Error('OpenRouter API không trả về kết quả.');
      }

      return data.choices[0].message.content;

    } catch (err) {
      if (err.name === 'AbortError') throw new Error('Đã hủy yêu cầu.');
      if (err.message.includes('Failed to fetch')) {
        throw new Error('Không kết nối được server proxy. Hãy đảm bảo server.py đang chạy.');
      }
      throw err;
    }
  }

  // ============================================================
  //  NVIDIA API (OpenAI Compatible)
  // ============================================================

  async _callNvidiaAPI(prompt, imageBase64, systemPrompt, jsonMode, pageText) {
    if (!this.nvidiaKey) {
      throw new Error('Chưa nhập NVIDIA API key.');
    }

    const abortController = new AbortController();

    const isVisionModel = this.nvidiaVision;
    let userContent;
    if (isVisionModel && imageBase64) {
      let textWithPrompt = prompt;
      if (pageText) {
        textWithPrompt = `${prompt}\n\nNội dung văn bản trong trang (tham khảo chính xác):\n${pageText}`;
      }
      userContent = [
        { type: 'text', text: textWithPrompt },
        {
          type: 'image_url',
          image_url: {
            url: `data:image/jpeg;base64,${imageBase64}`
          }
        }
      ];
    } else {
      userContent = prompt;
      if (pageText) {
        userContent = `${prompt}\n\nNội dung trang:\n${pageText}`;
      }
    }

    const body = {
      _target_url: `${this.nvidiaBaseUrl}/chat/completions`,
      model: this.nvidiaModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      max_tokens: this._getMaxTokens(),
      temperature: 0.7,
      top_p: 0.95,
    };

    if (jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    try {
      const response = await fetch('/api/nvidia', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': this.nvidiaKey
        },
        body: JSON.stringify(body),
        signal: abortController.signal
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const errMsg = errData?.error?.message || `HTTP ${response.status}`;
        if (response.status === 401 || response.status === 403) {
          throw new Error('NVIDIA API key không hợp lệ. Kiểm tra lại.');
        }
        if (response.status === 429) {
          throw new Error('Vượt quá giới hạn NVIDIA API. Chờ một lát rồi thử lại.');
        }
        throw new Error(`Lỗi NVIDIA API: ${errMsg}`);
      }

      const data = await response.json();

      if (!data.choices?.length) {
        throw new Error('NVIDIA API không trả về kết quả.');
      }

      return data.choices[0].message.content;

    } catch (err) {
      if (err.name === 'AbortError') throw new Error('Đã hủy yêu cầu.');
      throw err;
    }
  }

  // ============================================================
  //  OLLAMA API
  // ============================================================

  async _callOllamaAPI(prompt, imageBase64, systemPrompt, jsonMode, pageText) {
    const abortController = new AbortController();

    const url = `${this.ollamaUrl}/api/chat`;

    let userContent = prompt;
    if (pageText) {
      userContent = `${prompt}\n\nNội dung văn bản trong trang (tham khảo chính xác):\n${pageText}`;
    }

    const userMessage = { role: 'user', content: userContent };
    if (this.ollamaVision && imageBase64) {
      userMessage.images = [imageBase64];
    }

    const body = {
      model: this.ollamaModel,
      messages: [
        { role: 'system', content: systemPrompt },
        userMessage
      ],
      stream: false,
    };

    if (jsonMode) {
      body.format = 'json';
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortController.signal
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        if (response.status === 404) {
          throw new Error(`Model "${this.ollamaModel}" chưa được tải. Chạy: ollama pull ${this.ollamaModel}`);
        }
        throw new Error(`Lỗi Ollama (${response.status}): ${errText.substring(0, 100)}`);
      }

      const data = await response.json();

      if (!data.message || !data.message.content) {
        throw new Error('Ollama không trả về kết quả.');
      }

      return data.message.content;

    } catch (err) {
      if (err.name === 'AbortError') throw new Error('Đã hủy yêu cầu.');
      if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
        throw new Error('Không kết nối được Ollama. Kiểm tra Ollama đã chạy chưa (ollama serve).');
      }
      throw err;
    }
  }

  // ============================================================
  //  GEMINI API
  // ============================================================

  async _callGeminiAPI(prompt, imageBase64, systemPrompt, jsonMode, pageText) {
    if (!this.apiKey) {
      throw new Error('Chưa cài đặt API key. Vui lòng nhập Gemini API key.');
    }

    const maxRetries = 1;
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      this.abort();
      this._abortController = new AbortController();

      const url = `${this.geminiBaseUrl}/models/${this.geminiModel}:generateContent?key=${this.apiKey}`;

      let textWithPrompt = prompt;
      if (pageText) {
        textWithPrompt = `${prompt}\n\nNội dung văn bản trong trang (tham khảo chính xác):\n${pageText}`;
      }

      const parts = [{ text: textWithPrompt }];
      if (imageBase64) {
        parts.push({ inlineData: { mimeType: 'image/jpeg', data: imageBase64 } });
      }

      const body = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts }],
        generationConfig: { temperature: 0.7, topP: 0.9, maxOutputTokens: this._getMaxTokens() }
      };

      if (jsonMode) {
        body.generationConfig.responseMimeType = 'application/json';
      }

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: this._abortController.signal
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errorMsg = errorData?.error?.message || `HTTP ${response.status}`;

          if (response.status === 429) {
            lastError = new Error('Vượt quá giới hạn API. Đang thử lại...');
            if (attempt < maxRetries) {
              const delay = 15000;
              await new Promise(r => setTimeout(r, delay));
              continue;
            }
            throw new Error('Vượt quá giới hạn API. Chờ 1 phút rồi thử lại, hoặc chuyển sang Ollama local.');
          } else if (response.status === 401 || response.status === 403) {
            throw new Error('API key không hợp lệ. Vui lòng kiểm tra lại.');
          } else {
            throw new Error(`Lỗi API: ${errorMsg}`);
          }
        }

        const data = await response.json();
        if (!data.candidates?.length) throw new Error('AI không trả về kết quả.');

        const candidate = data.candidates[0];
        if (candidate.finishReason === 'SAFETY') throw new Error('Nội dung bị chặn bởi bộ lọc an toàn.');

        return candidate.content.parts[0].text;

      } catch (err) {
        if (err.name === 'AbortError') throw new Error('Đã hủy yêu cầu.');
        if (!err.message.includes('thử lại')) throw err;
        lastError = err;
      } finally {
        this._abortController = null;
      }
    }

    throw lastError || new Error('Lỗi không xác định');
  }

}
