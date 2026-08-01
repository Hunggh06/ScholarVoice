/**
 * AIEngine - Module gọi AI (hỗ trợ Gemini, NVIDIA, Ollama)
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

    this.deepseekModel = saved.deepseekModel || 'deepseek-chat';

    this._abortController = null;
    this.pageCache = new Map();
    // Cache quiz theo trang: key `quiz_<page>_<provider>`
    this.quizCache = new Map();
    this.flashcardCache = new Map();
    this.teachingStyle = saved.teachingStyle || 'medium';
    this.customStyle = saved.customStyle || '';
    this.teachThenQuiz = saved.teachThenQuiz !== undefined ? saved.teachThenQuiz : true;

    // Bộ nhớ ngữ cảnh toàn bài: mỗi trang đã giảng lưu tóm tắt
    this.docContext = [];
    this.chatHistory = [];
    this._pdfName = '';
    this._deepseekConvId = null;

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
    if (settings.deepseekModel !== undefined) this.deepseekModel = settings.deepseekModel;
    if (settings.teachingStyle !== undefined) this.teachingStyle = settings.teachingStyle;
    if (settings.customStyle !== undefined) this.customStyle = settings.customStyle;
    if (settings.teachThenQuiz !== undefined) this.teachThenQuiz = settings.teachThenQuiz;

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
      deepseekModel: this.deepseekModel,
      teachingStyle: this.teachingStyle,
      customStyle: this.customStyle,
      teachThenQuiz: this.teachThenQuiz,
    }));
    // Chỉ xoá cache nếu đổi provider hoặc đổi style
    if (oldProvider !== this.provider) {
      this.pageCache.clear();
      this.quizCache.clear();
      this.flashcardCache.clear();
      this.docContext = [];
      this.clearChatHistory();
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
      deepseekModel: this.deepseekModel,
      teachingStyle: this.teachingStyle,
      customStyle: this.customStyle,
      teachThenQuiz: this.teachThenQuiz,
    };
  }

  hasVision() {
    if (this.provider === 'gemini') return true;
    if (this.provider === 'nvidia') return this.nvidiaVision === true;
    if (this.provider === 'deepseek') return false;
    if (this.provider === 'ollama') return this.ollamaVision === true;
    return false;
  }

  get isConfigured() {
    if (this.provider === 'gemini') return this.apiKey.length > 0;
    if (this.provider === 'nvidia') return this.nvidiaKey.length > 0;
    if (this.provider === 'deepseek') return true;
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
  async teachPage(imageBase64, pageNum, pageText, onStream, opts = {}) {
    const isTitleSlide = !!opts.isTitleSlide;
    const cached = this._getPageCache(pageNum);
    if (cached) return cached;

    const hasImage = imageBase64 && imageBase64.length > 100;
    const hasVision = this.hasVision();

    // Xây dựng ngữ cảnh từ các trang trước
    const contextText = this._buildContext(pageNum);

    const styleGuides = {
      brief: 'PHONG CÁCH LƯỚT: Cực kỳ ngắn gọn. Chỉ nêu 2-3 ý chính của trang. Không giải thích sâu. Tối đa 3-4 câu.',
      medium: 'PHONG CÁCH TRUNG BÌNH: Giảng đầy đủ nội dung trang kèm giải thích ngắn các phần quan trọng. Tối đa 8-10 câu.',
      detailed: 'PHONG CÁCH CHI TIẾT: Giảng kỹ từng phần. Giải thích cặn kẽ mọi công thức, định nghĩa, khái niệm. Cho ví dụ minh họa. Đào sâu chi tiết kỹ thuật.'
    };
    const styleGuide = styleGuides[this.teachingStyle] || styleGuides.medium;
    const customGuide = this.customStyle ? `\nYÊU CẦU RIÊNG: ${this.customStyle}` : '';

    let systemPrompt;
    if (isTitleSlide) {
      systemPrompt = `Bạn là giảng viên đang giảng liên tục toàn bộ tài liệu. Trang ${pageNum} này CHỈ CÓ TIÊU ĐỀ (trang bìa, trang mở đầu chương, trang chia mục).

${contextText}
HÀNH VI BẮT BUỘC:
- Nói NGẮN GỌN 1-2 câu giới thiệu nội dung sắp học, nối mạch tự nhiên với bài giảng trước đó.
- KHÔNG phân tích, KHÔNG bịa nội dung, KHÔNG lặp lại tiêu đề dài dòng.
- Giọng điệu tự nhiên như giảng viên thật.

NGÔN NGỮ: Luôn giảng bằng TIẾNG VIỆT.
KHÔNG dùng markdown hay ký tự đặc biệt nào. Chỉ dùng chữ cái, số, dấu câu cơ bản (. , ? ! : ;).`;
    } else {
      systemPrompt = `Bạn là giảng viên đang giảng liên tục toàn bộ tài liệu. Đây là trang ${pageNum}.

${contextText}${styleGuide}${customGuide}

LIÊN KẾT BÀI GIẢNG:
- Bạn đã giảng các trang trước, hãy tiếp tục tự nhiên như một phần của cùng bài học.
- Mở đầu ngắn gọn kiểu "Tiếp theo chúng ta đến với..." hoặc "Trang này nói về..." hoặc đi thẳng vào nội dung.
- Không giới thiệu lại bản thân, không chào hỏi lại.
- Giọng điệu tự nhiên như giảng viên thật — ngắt nghỉ nhẹ giữa các ý, nhấn mạnh thuật ngữ quan trọng.

NGÔN NGỮ: Luôn giảng bằng TIẾNG VIỆT.

CÁCH ĐỌC SLIDE:
- Đọc tiêu đề trước, sau đó giảng nội dung bên dưới.
- Với danh sách gạch đầu dòng: "Thứ nhất là...", "Tiếp theo...", "Ngoài ra...", "Cuối cùng...".
- Với bảng biểu: "Bảng này gồm... Hàng đầu tiên... Hàng thứ hai...".
- Với hình ảnh, sơ đồ: mô tả ngắn gọn nội dung.
- Công thức toán: "p bằng u nhân i", "x bình phương", "căn bậc hai của x", "đạo hàm của f tại x", "tích phân từ a đến b".
- Ký hiệu toán: "lớn hơn", "nhỏ hơn", "bằng", "cộng", "trừ", "nhân", "chia", "mũ", "căn", "phần trăm".
- Chữ Hy Lạp: alpha, beta, gamma, delta, epsilon, theta, lambda, mu, pi, sigma, omega.
- Công thức hóa: H2O đọc "H hai O", CO2 đọc "C O hai", NaCl đọc "Na Cl".
- Chữ viết tắt: đánh vần từng chữ (CPU → "xê pê u", PDF → "pê đê ép", AI → "a i").
- TUYỆT ĐỐI KHÔNG dùng ký hiệu = + - × $ ^ _ { } — luôn thay bằng lời.
- KHÔNG dùng markdown hay ký tự đặc biệt (**bold**, *italic*, code, ## heading, - bullet).
- KHÔNG dùng ký tự đặc biệt nào cả. Chỉ dùng chữ cái, số, dấu câu cơ bản (. , ? ! : ;).`;
    }


    let userPrompt;
    let expectJson = false;
    if (!isTitleSlide && hasImage && hasVision) {
      expectJson = true;
      userPrompt = `Giảng nội dung đầy đủ của trang tài liệu trong ảnh đính kèm.

QUAN TRỌNG: Trả về kết quả dạng JSON với cấu trúc sau:
{
  "segments": [
    {
      "explanation_text": "nội dung giảng cho vùng này, viết thành MỘT đoạn văn liên tục, tuân theo mọi luật giảng từ system prompt",
      "region_vert": [0, 0.35]
    },
    {
      "explanation_text": "nội dung giảng cho vùng tiếp theo",
      "region_vert": [0.35, 0.65]
    }
  ]
}
region_vert là [trên, dưới] tính theo phần trăm chiều cao trang (giá trị 0-1).
Chia trang thành các vùng dọc tương ứng với mỗi phần nội dung.
KHÔNG thêm bất kỳ text nào ngoài JSON.`;
    } else {
      userPrompt = pageText
        ? `Giảng nội dung trang tài liệu bên dưới (dòng bắt đầu bằng ## là tiêu đề, dòng trống ngăn cách các phần):\n\n${pageText}`
        : `Giảng nội dung trang tài liệu.`;
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
    } else if (voiceText && voiceText.length > 0) {
      const parts = voiceText.split(/[.!?]\s+/).filter(s => s.trim().length > 10);
      if (parts.length >= 2) {
        segments = parts.map((s, i) => ({
          text: s,
          regionVert: [i / parts.length, (i + 1) / parts.length]
        }));
      }
    }

    // Lưu tóm tắt vào bộ nhớ ngữ cảnh
    this._updateContext(pageNum, voiceText);

    const result = { voice_text: voiceText, segments, isTitleSlide };
    const cacheKey = `page_${pageNum}_${this.provider}_${this.teachingStyle}`;
    this.pageCache.set(cacheKey, result);
    return result;
  }

  /**
   * Trả lời câu hỏi trong chat
   */
  async askQuestion(question, imageBase64, pageText) {
    const systemPrompt = `Bạn là giảng viên đang trả lời câu hỏi của sinh viên. Trả lời dựa trên nội dung trang tài liệu và lịch sử trò chuyện.

Bạn PHẢI trả về JSON hợp lệ với đúng 2 trường:
{
  "voice_text": "...",
  "display_text": "..."
}

NGỮ CẢNH HỘI THOẠI: Khi có lịch sử trò chuyện ở phần "LỊCH SỬ TRÒ CHUYỆN" bên dưới, hãy sử dụng nó để trả lời mạch lạc, có ngữ cảnh. Tham chiếu tự nhiên đến các câu trước (vd: "Như tôi đã nói...", "Quay lại câu hỏi trước của bạn...").

LUẬT NGÔN NGỮ: Luôn trả lời bằng TIẾNG VIỆT.`;

    let historyBlock = '';
    if (this.provider !== 'deepseek') {
      const history = this.chatHistory;
      if (history.length > 0) {
        historyBlock = '\nLỊCH SỬ TRÒ CHUYỆN:\n';
        for (const h of history) {
          const label = h.role === 'user' ? 'Người dùng' : 'AI';
          const shortText = (h.text || '').substring(0, 150);
          historyBlock += `- ${label}: ${shortText}\n`;
        }
        if (historyBlock.length > 4000) {
          historyBlock = this._summarizeOldHistory();
        }
      }
    }

    let docBlock = '';
    if (this.docContext.length > 0) {
      docBlock = '\nTÓM TẮT TÀI LIỆU ĐÃ GIẢNG:\n';
      for (const c of this.docContext) {
        docBlock += `- Trang ${c.page}: ${c.summary}\n`;
      }
    }

    const userPrompt = `Nội dung trang hiện tại (để tham khảo): ${pageText}
${docBlock}${historyBlock}
Câu hỏi của sinh viên: ${question}

Trả lời bằng JSON với 2 trường:

1. "voice_text": Giải thích chi tiết bằng MỘT đoạn văn liên tục, KHÔNG xuống dòng, KHÔNG gạch đầu dòng, KHÔNG đánh số. Diễn đạt mọi công thức bằng lời (vd: "p bằng u nhân i", "x bình phương", "đạo hàm của f tại x"). KHÔNG dùng ký hiệu toán học hay LaTeX. Đánh vần từng chữ cái với các chữ viết tắt. Giọng điệu tự nhiên như giảng viên.

2. "display_text": Tóm tắt NGẮN GỌN. Dùng LaTeX cho công thức (vd: $P'$ hoặc $f'(x)$). Cấu trúc rõ ràng. Chỉ ý chính, KHÔNG giải thích dài dòng.`;

    const hasImage = imageBase64 && imageBase64.length > 100;
    const hasVision = this.hasVision();
    const effectiveImage = (hasImage && hasVision) ? imageBase64 : null;

    const rawResponse = await this._callAPI(userPrompt, effectiveImage, systemPrompt, true, pageText);

    const parseResult = () => {
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
    };

    const result = parseResult();

    this.addChatTurn('user', question);
    this.addChatTurn('ai', result.voice_text);

    return result;
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
      } else if (this.provider === 'deepseek') {
        result = await this._callDeepseekAPI(prompt, imageBase64, systemPrompt, jsonMode, pageText);
      } else if (this.provider === 'nvidia') {
        result = await this._callNvidiaAPI(prompt, imageBase64, systemPrompt, jsonMode, pageText);
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
    if (this.provider === 'deepseek') return this.deepseekModel;
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

  setPdfName(name) {
    if (name !== this._pdfName) {
      this._pdfName = name;
      this.chatHistory = [];
      this._deepseekConvId = null;
      this._loadChatHistory();
    }
  }

  addChatTurn(role, text) {
    this.chatHistory.push({
      role,
      text,
      pageNum: 0,
      timestamp: Date.now()
    });
    if (this.chatHistory.length > 20) {
      this.chatHistory.shift();
    }
    this._saveChatHistory();
  }

  getChatHistory() {
    return this.chatHistory;
  }

  clearChatHistory() {
    this.chatHistory = [];
    this._deepseekConvId = null;
    try {
      localStorage.removeItem('chat_history_' + this._pdfName);
    } catch (e) { /* ignore */ }
  }

  _saveChatHistory() {
    if (!this._pdfName) return;
    try {
      localStorage.setItem('chat_history_' + this._pdfName, JSON.stringify(this.chatHistory));
    } catch (e) {
      console.warn('[ScholarVoice] Cannot save chat history:', e.message);
    }
  }

  _loadChatHistory() {
    if (!this._pdfName) return;
    try {
      const saved = localStorage.getItem('chat_history_' + this._pdfName);
      if (saved) {
        this.chatHistory = JSON.parse(saved);
      }
    } catch (e) {
      this.chatHistory = [];
    }
  }

  _summarizeOldHistory() {
    const recent = this.chatHistory.slice(-10);
    let summary = 'TÓM TẮT ĐOẠN TRƯỚC: ';
    const oldTurns = this.chatHistory.slice(0, -10);
    for (const h of oldTurns) {
      const label = h.role === 'user' ? 'Người dùng' : 'AI';
      summary += `[${label}: ${(h.text || '').substring(0, 60)}] `;
    }
    summary += '\nCÁC CÂU HỎI GẦN ĐÂY:\n';
    for (const h of recent) {
      const label = h.role === 'user' ? 'Người dùng' : 'AI';
      summary += `- ${label}: ${(h.text || '').substring(0, 100)}\n`;
    }
    return summary;
  }

  /**
   * Tạo quiz câu hỏi cho một trang. Cache theo trang + provider + số câu.
   * @param {number} pageNum
   * @param {string} pageText - text đã trích xuất của trang
   * @param {string|null} imageBase64 - ảnh trang (provider có vision thì dùng)
   * @param {number} [count=3] - số câu hỏi (3/5/10)
   * @returns {Promise<Array>} mảng câu hỏi đã validate
   */
  async generateQuiz(pageNum, pageText, imageBase64, count = 3) {
    const n = [3, 5, 10].includes(count) ? count : 3;
    const cacheKey = `quiz_${pageNum}_${this.provider}_${n}`;
    const cached = this.quizCache.get(cacheKey);
    if (cached) return cached;

    if (!pageText || !pageText.trim()) {
      throw new Error('Trang này không có nội dung chữ để tạo câu hỏi.');
    }

    const systemPrompt = `Bạn là giảng viên tạo câu hỏi trắc nghiệm để kiểm tra hiểu bài.
Tạo CHÍNH XÁC ${n} câu hỏi từ nội dung trang tài liệu. Độ khó tăng dần.
Câu hỏi PHẢI về kiến thức môn học có trong nội dung trang (khái niệm, công thức, định nghĩa, số liệu, ví dụ).
TUYỆT ĐỐI KHÔNG hỏi về số trang, layout, định dạng, tiêu đề, hoặc kiến thức không có trong nội dung trang.
Ví dụ: ❌ Sai: "Trang này là trang số mấy?" / ✅ Đúng: "Theo công thức trong trang, giá trị của X là bao nhiêu?"
Mỗi câu hỏi gồm: type "mcq" (có options 4 đáp án + correct_index từ 0 đến 3) hoặc "tf" (có correct true/false), question, explanation (1-2 câu giải thích vì sao đúng).
Trả về JSON duy nhất, không thêm bất kỳ text nào ngoài JSON:
{
  "questions": [
    {"type":"mcq","question":"...","options":["A","B","C","D"],"correct_index":0,"explanation":"..."},
    {"type":"tf","question":"...","correct":true,"explanation":"..."}
  ]
}
NGÔN NGỮ: Luôn dùng TIẾNG VIỆT.
explanation phải đọc được bằng giọng: KHÔNG ký hiệu toán học, KHÔNG markdown, KHÔNG ký tự đặc biệt.`;

    const userPrompt = `Nội dung trang tài liệu (dòng bắt đầu bằng ## là tiêu đề, dòng trống ngăn cách các phần):

${pageText}

Hãy tạo quiz theo đúng định dạng JSON yêu cầu ở trên.`;

    const hasImage = imageBase64 && imageBase64.length > 100;
    const hasVision = this.hasVision();
    const effectiveImage = (hasImage && hasVision) ? imageBase64 : null;

    const rawResponse = await this._callAPI(userPrompt, effectiveImage, systemPrompt, true, pageText);

    const questions = validateQuizQuestions(rawResponse);
    if (questions.length === 0) {
      throw new Error('AI không tạo được câu hỏi hợp lệ. Bấm 🔁 để thử lại.');
    }

    this.quizCache.set(cacheKey, questions);
    return questions;
  }

  /**
   * Tạo flashcards cho trang hiện tại
   * @param {number} pageNum
   * @param {string} pageText - text đã trích xuất của trang
   * @param {string|null} imageBase64 - ảnh trang (provider có vision thì dùng)
   * @param {number} [count=5] - số thẻ (3/5/10)
   * @returns {Promise<Array>} mảng [{term, definition}]
   */
  async generateFlashcards(pageNum, pageText, imageBase64, count = 5) {
    const n = [3, 5, 10].includes(count) ? count : 5;
    const cacheKey = `flash_${pageNum}_${this.provider}_${n}`;
    const cached = this.flashcardCache.get(cacheKey);
    if (cached) return cached;

    if (!pageText || !pageText.trim()) {
      throw new Error('Trang này không có nội dung chữ để tạo thẻ học.');
    }

    const systemPrompt = `Bạn là giảng viên tạo thẻ học (flashcards) để giúp sinh viên ôn tập.
Trích CHÍNH XÁC ${n} thuật ngữ hoặc khái niệm quan trọng từ nội dung trang tài liệu.
Với mỗi thuật ngữ, viết định nghĩa ngắn gọn (1-2 câu), dễ hiểu.
TUYỆT ĐỐI CHỈ dùng kiến thức có trong nội dung trang, không bịa thêm.
Trả về JSON duy nhất, không thêm bất kỳ text nào ngoài JSON:
{
  "cards": [
    {"term": "Thuật ngữ 1", "definition": "Định nghĩa ngắn gọn bằng tiếng Việt."},
    {"term": "Thuật ngữ 2", "definition": "Định nghĩa ngắn gọn bằng tiếng Việt."}
  ]
}
NGÔN NGỮ: Luôn dùng TIẾNG VIỆT.
definition phải đọc được bằng giọng: KHÔNG ký hiệu toán học, KHÔNG markdown, KHÔNG ký tự đặc biệt.`;

    const userPrompt = `Nội dung trang tài liệu (dòng bắt đầu bằng ## là tiêu đề, dòng trống ngăn cách các phần):

${pageText}

Hãy tạo flashcards theo đúng định dạng JSON yêu cầu ở trên.`;

    const hasImage = imageBase64 && imageBase64.length > 100;
    const hasVision = this.hasVision();
    const effectiveImage = (hasImage && hasVision) ? imageBase64 : null;

    const rawResponse = await this._callAPI(userPrompt, effectiveImage, systemPrompt, true, pageText);

    const cards = validateFlashcards(rawResponse);
    if (cards.length === 0) {
      throw new Error('AI không tạo được thẻ học hợp lệ. Bấm 🔄 để thử lại.');
    }

    this.flashcardCache.set(cacheKey, cards);
    return cards;
  }

  /** Xoá quiz cache của một trang theo prefix (mọi số câu) — dùng cho nút "Làm lại" */
  clearQuizForPage(pageNum) {
    const prefix = `quiz_${pageNum}_${this.provider}_`;
    for (const key of this.quizCache.keys()) {
      if (key.startsWith(prefix)) this.quizCache.delete(key);
    }
  }

  /** Xoá flashcard cache của một trang theo prefix (mọi số thẻ) — dùng cho nút "Làm mới" */
  clearFlashcardsForPage(pageNum) {
    const prefix = `flash_${pageNum}_${this.provider}_`;
    for (const key of this.flashcardCache.keys()) {
      if (key.startsWith(prefix)) this.flashcardCache.delete(key);
    }
  }

  clearCache() {
    this.pageCache.clear();
    this.quizCache.clear();
    this.flashcardCache.clear();
    this.docContext = [];
    this.clearChatHistory();
  }

  // ============================================================
  //  DEEPSEEK API (Free via local deepseek-api server)
  // ============================================================

  async _callDeepseekAPI(prompt, imageBase64, systemPrompt, jsonMode, pageText) {
    this.abort();
    this._abortController = new AbortController();

    let userContent = prompt;
    if (pageText) {
      userContent = `${prompt}\n\nNội dung trang:\n${pageText}`;
    }

    const body = {
      model: this.deepseekModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      max_tokens: this._getMaxTokens(),
      temperature: 0.7,
    };

    if (this._deepseekConvId) {
      body.conversation_id = this._deepseekConvId;
    }

    if (jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch('/api/deepseek', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: this._abortController.signal
        });

        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get('Retry-After') || '5');
          if (attempt < maxRetries) {
            const delay = Math.min(retryAfter * 1000, 30000);
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
          throw new Error('DeepSeek quá tải. Đợi 30 giây rồi thử lại.');
        }

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          const errMsg = errData?.error?.message || `HTTP ${response.status}`;
          if (response.status === 503) {
            throw new Error('Không kết nối được DeepSeek server. Đảm bảo server đang chạy và URL đúng.');
          }
          throw new Error(`Lỗi DeepSeek API: ${errMsg}`);
        }

        const data = await response.json();
        if (!data.choices?.length) {
          throw new Error('DeepSeek API không trả về kết quả.');
        }
        if (data.conversation_id) {
          this._deepseekConvId = data.conversation_id;
        }
        return data.choices[0].message.content;

      } catch (err) {
        if (err.name === 'AbortError') throw new Error('Đã hủy yêu cầu.');
        if (err.message.includes('Failed to fetch')) {
          throw new Error('Không kết nối được DeepSeek server.');
        }
        if (!err.message.includes('429') && !err.message.includes('quá tải')) throw err;
        lastError = err;
      }
    }

    throw lastError || new Error('DeepSeek không phản hồi sau 3 lần thử.');
  }

  // ============================================================
  //  NVIDIA API (OpenAI Compatible)
  // ============================================================

  async _callNvidiaAPI(prompt, imageBase64, systemPrompt, jsonMode, pageText) {
    if (!this.nvidiaKey) {
      throw new Error('Chưa nhập NVIDIA API key.');
    }

    this.abort();
    this._abortController = new AbortController();

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
        signal: this._abortController.signal
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
    this.abort();
    this._abortController = new AbortController();

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
        signal: this._abortController.signal
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

/**
 * Parse + validate phản hồi quiz từ AI (JSON). Thuần — test được bằng Node.
 * @param {string|null|undefined} raw - text thô từ AI
 * @returns {Array} mảng câu hỏi hợp lệ [{type, question, options?, correct_index?, correct?, explanation}]
 */
export function validateQuizQuestions(raw) {
  if (!raw || typeof raw !== 'string') return [];

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Thử lấy block JSON từ markdown ```json ... ```
    const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) {
      try { parsed = JSON.parse(m[1]); } catch { /* fallback */ }
    }
  }
  if (!parsed) {
    // Fallback cuối: tìm object có "questions"
    const m2 = raw.match(/\{[\s\S]*"questions"[\s\S]*\}/);
    if (m2) {
      try { parsed = JSON.parse(m2[0]); } catch { /* fallback */ }
    }
  }

  const list = parsed && Array.isArray(parsed.questions) ? parsed.questions : [];
  const out = [];
  for (const q of list) {
    if (!q || typeof q !== 'object') continue;
    const question = typeof q.question === 'string' ? q.question.trim() : '';
    const explanation = typeof q.explanation === 'string' ? q.explanation.trim() : '';
    if (!question) continue;

    if (q.type === 'mcq') {
      if (!Array.isArray(q.options) || q.options.length !== 4) continue;
      if (!q.options.every(o => typeof o === 'string' && o.trim())) continue;
      const ci = Number(q.correct_index);
      if (!Number.isInteger(ci) || ci < 0 || ci > 3) continue;
      out.push({ type: 'mcq', question, options: q.options.map(o => o.trim()), correct_index: ci, explanation });
    } else if (q.type === 'tf') {
      if (typeof q.correct !== 'boolean') continue;
      out.push({ type: 'tf', question, correct: q.correct, explanation });
    }
    // type khác → bỏ qua câu đó
  }
  return out;
}

/**
 * Validate JSON response từ AI → mảng [{term, definition}]
 * Pattern theo validateQuizQuestions
 */
export function validateFlashcards(raw) {
  if (!raw || typeof raw !== 'string') return [];

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Thử lấy block JSON từ markdown ```json ... ```
    const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) {
      try { parsed = JSON.parse(m[1]); } catch { /* fallback */ }
    }
  }
  if (!parsed) {
    // Fallback cuối: tìm object có "cards"
    const m2 = raw.match(/\{[\s\S]*"cards"[\s\S]*\}/);
    if (m2) {
      try { parsed = JSON.parse(m2[0]); } catch { /* fallback */ }
    }
  }

  const list = parsed && Array.isArray(parsed.cards) ? parsed.cards : [];
  const out = [];
  for (const c of list) {
    if (!c || typeof c !== 'object') continue;
    const term = typeof c.term === 'string' ? c.term.trim() : '';
    const definition = typeof c.definition === 'string' ? c.definition.trim() : '';
    if (!term || !definition) continue;
    out.push({
      term,
      definition: definition.length > 200 ? definition.substring(0, 200) : definition
    });
  }
  return out;
}
