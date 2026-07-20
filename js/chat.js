/**
 * ChatManager - Module quản lý ô chat hỏi đáp
 * Hiển thị tin nhắn user/AI, render KaTeX trong display_text
 */
export class ChatManager {
  constructor() {
    this.messagesContainer = document.getElementById('chat-messages');
    this.inputEl = document.getElementById('chat-input');
    this.sendBtn = document.getElementById('chat-send');
    this.contextIndicator = document.getElementById('chat-context-indicator');

    this.onSend = null;
    this.onClear = null;

    this._setupEvents();
  }

  /** Thiết lập sự kiện input và nút gửi */
  _setupEvents() {
    // Nhấn Enter để gửi
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this._handleSend();
      }
    });

    // Click nút gửi
    this.sendBtn.addEventListener('click', () => {
      this._handleSend();
    });
  }

  /** Xử lý gửi tin nhắn */
  _handleSend() {
    const text = this.inputEl.value.trim();
    if (!text || this.inputEl.disabled) return;

    this.inputEl.value = '';

    if (this.onSend) {
      this.onSend(text);
    }
  }

  /**
   * Thêm tin nhắn của user
   * @param {string} text
   */
  addUserMessage(text) {
    this._removeWelcome();

    const el = document.createElement('div');
    el.className = 'chat-message user-msg';
    el.innerHTML = `<div class="message-bubble user-bubble">${this._escapeHtml(text)}</div>`;
    this.messagesContainer.appendChild(el);
    this._scrollToBottom();
  }

  _aiAvatar() {
    return '<div class="ai-avatar">🤖</div>';
  }

  /**
   * Thêm tin nhắn AI (hiển thị display_text với KaTeX)
   * @param {string} displayText - Text vắn tắt có thể chứa LaTeX
   */
  addAIMessage(displayText) {
    this._removeWelcome();

    const el = document.createElement('div');
    el.className = 'chat-message ai-msg';

    // Xử lý display_text: convert newlines thành <br>, giữ LaTeX
    const htmlContent = this._processDisplayText(displayText);

    el.innerHTML = `${this._aiAvatar()}<div class="message-bubble ai-bubble">${htmlContent}</div>`;
    this.messagesContainer.appendChild(el);

    // Render KaTeX trong tin nhắn
    this._renderMath(el);

    this._scrollToBottom();
  }

  /**
   * Thêm tin nhắn lỗi
   * @param {string} errorText
   */
  addErrorMessage(errorText) {
    const el = document.createElement('div');
    el.className = 'chat-message ai-msg';
    el.innerHTML = `${this._aiAvatar()}<div class="message-bubble ai-bubble" style="border-color: rgba(248,113,113,0.3); color: var(--red);">⚠️ ${this._escapeHtml(errorText)}</div>`;
    this.messagesContainer.appendChild(el);
    this._scrollToBottom();
  }

  /** Hiển thị loading indicator */
  showLoading() {
    this._removeWelcome();

    const el = document.createElement('div');
    el.className = 'chat-message ai-msg loading-msg';
    el.innerHTML = `
      ${this._aiAvatar()}
      <div class="message-bubble ai-bubble">
        <div class="typing-indicator">
          <span></span><span></span><span></span>
        </div>
      </div>`;
    this.messagesContainer.appendChild(el);
    this._scrollToBottom();
  }

  /** Ẩn loading indicator */
  hideLoading() {
    const loading = this.messagesContainer.querySelector('.loading-msg');
    if (loading) loading.remove();
  }

  /** Bật/tắt input */
  setEnabled(enabled) {
    this.inputEl.disabled = !enabled;
    this.sendBtn.disabled = !enabled;
  }

  updateContextIndicator(count) {
    if (!this.contextIndicator) return;
    if (count > 0) {
      this.contextIndicator.style.display = '';
      this.contextIndicator.textContent = `🧠 Đang nhớ ${count} tin nhắn`;
    } else {
      this.contextIndicator.style.display = 'none';
      this.contextIndicator.textContent = '🧠 0 tin nhắn';
    }
    const clearBtn = document.getElementById('chat-clear-btn');
    if (clearBtn) clearBtn.style.display = count > 0 ? '' : 'none';
  }

  clearMessages() {
    this.messagesContainer.innerHTML = '';
    this.messagesContainer.innerHTML = `<div class="welcome-message">
      <div class="welcome-icon">🤖</div>
      <p>Tải PDF lên để bắt đầu học. Sau đó bạn có thể hỏi bất kỳ câu hỏi nào về nội dung!</p>
    </div>`;
    this.updateContextIndicator(0);
  }

  /** Xử lý display_text thành HTML an toàn (giữ LaTeX) */
  _processDisplayText(text) {
    // Tách các phần LaTeX ra, escape phần text thường
    const parts = [];
    let remaining = text;

    // Regex tìm các block LaTeX: $$...$$ hoặc $...$
    const latexRegex = /(\$\$[\s\S]*?\$\$|\$[^\$\n]+?\$)/g;
    let lastIndex = 0;
    let match;

    while ((match = latexRegex.exec(remaining)) !== null) {
      // Text trước LaTeX
      if (match.index > lastIndex) {
        const beforeText = remaining.substring(lastIndex, match.index);
        parts.push(this._escapeAndFormat(beforeText));
      }
      // LaTeX giữ nguyên
      parts.push(match[0]);
      lastIndex = match.index + match[0].length;
    }

    // Text sau cùng
    if (lastIndex < remaining.length) {
      parts.push(this._escapeAndFormat(remaining.substring(lastIndex)));
    }

    return parts.join('');
  }

  /** Escape HTML và format newlines */
  _escapeAndFormat(text) {
    const escaped = this._escapeHtml(text);
    return escaped
      .replace(/\n\n/g, '<br><br>')
      .replace(/\n/g, '<br>');
  }

  /** Escape HTML để tránh XSS */
  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /** Render KaTeX trong element */
  _renderMath(el) {
    if (window.renderMathInElement) {
      try {
        renderMathInElement(el, {
          delimiters: [
            { left: "$$", right: "$$", display: true },
            { left: "$", right: "$", display: false },
            { left: "\\(", right: "\\)", display: false },
            { left: "\\[", right: "\\]", display: true }
          ],
          throwOnError: false,
          strict: false
        });
      } catch (e) {
        console.warn('KaTeX render error:', e);
      }
    }
  }

  /** Xóa welcome message */
  _removeWelcome() {
    const welcome = this.messagesContainer.querySelector('.welcome-message');
    if (welcome) welcome.remove();
  }

  /** Scroll xuống cuối */
  _scrollToBottom() {
    requestAnimationFrame(() => {
      this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    });
  }
}
