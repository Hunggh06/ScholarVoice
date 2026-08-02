/**
 * PDFViewer - Module quản lý hiển thị và điều hướng PDF
 * Sử dụng PDF.js (global pdfjsLib)
 * Trích xuất text thông minh dựa trên tọa độ để giữ cấu trúc trang
 */
export class PDFViewer {
  constructor() {
    if (typeof pdfjsLib !== 'undefined') {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdfjs/pdf.worker.min.js';
    }

    this.pdfDoc = null;
    this.currentPage = 1;
    this.totalPages = 0;
    this.canvas = document.getElementById('pdf-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.canvasContainer = document.getElementById('canvas-container');
    this.rendering = false;
    this.pendingPage = null;
    this.zoom = 1;
    this._fitScale = 1;

    // Overlay canvas cho highlight vùng đang giảng (gray mask)
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.id = 'pdf-overlay';
    this.overlayCanvas.style.position = 'absolute';
    this.overlayCanvas.style.top = '0';
    this.overlayCanvas.style.left = '0';
    this.overlayCanvas.style.pointerEvents = 'none';
    this.canvasContainer.appendChild(this.overlayCanvas);
    this.overlayCtx = this.overlayCanvas.getContext('2d');
    this._highlightRegion = null;

    this._resizeObserver = new ResizeObserver(() => {
      if (this.pdfDoc && !this.rendering) {
        this.renderPage(this.currentPage);
      }
    });
    this._resizeObserver.observe(this.canvasContainer);

    this._panX = 0;
    this._panY = 0;
    this._isPanning = false;
    this._panStartX = 0;
    this._panStartY = 0;
    this._panStartCX = 0;
    this._panStartCY = 0;
    this._bindPanEvents();
  }

  _bindPanEvents() {
    const c = this.canvasContainer;
    c.addEventListener('mousedown', e => this._onPanStart(e));
    c.addEventListener('mousemove', e => this._onPanMove(e));
    c.addEventListener('mouseup', e => this._onPanEnd(e));
    c.addEventListener('mouseleave', e => this._onPanEnd(e));
    c.addEventListener('touchstart', e => this._onPanStart(e), { passive: false });
    c.addEventListener('touchmove', e => this._onPanMove(e), { passive: false });
    c.addEventListener('touchend', e => this._onPanEnd(e));
    c.addEventListener('touchcancel', e => this._onPanEnd(e));
  }

  _onPanStart(e) {
    if (this.zoom <= 1) return;
    const p = e.touches ? e.touches[0] : e;
    this._isPanning = true;
    this._panStartX = p.clientX;
    this._panStartY = p.clientY;
    this._panStartCX = this._panX;
    this._panStartCY = this._panY;
    this.canvasContainer.style.cursor = 'grabbing';
    if (e.cancelable) e.preventDefault();
  }

  _onPanMove(e) {
    if (!this._isPanning) return;
    const p = e.touches ? e.touches[0] : e;
    const dx = p.clientX - this._panStartX;
    const dy = p.clientY - this._panStartY;
    this._panX = this._panStartCX + dx;
    this._panY = this._panStartCY + dy;
    this._applyPan();
    if (e.cancelable) e.preventDefault();
  }

  _onPanEnd(e) {
    if (!this._isPanning) return;
    this._isPanning = false;
    this.canvasContainer.style.cursor = this.zoom > 1 ? 'grab' : '';
  }

  _applyPan() {
    this.canvas.style.transform = `translate(${this._panX}px, ${this._panY}px)`;
    this.overlayCanvas.style.transform = `translate(${this._panX}px, ${this._panY}px)`;
  }

  _resetPan() {
    this._panX = 0;
    this._panY = 0;
    this._applyPan();
    this.canvasContainer.style.cursor = this.zoom > 1 ? 'grab' : '';
  }

  /**
   * Tải file PDF từ File object
   */
  async loadPDF(file) {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    this.pdfDoc = await loadingTask.promise;
    this.totalPages = this.pdfDoc.numPages;
    this.currentPage = 1;
    await this.renderPage(1);
    return this.totalPages;
  }

  /**
   * Render một trang lên canvas
   */
  async renderPage(num) {
    if (!this.pdfDoc) return;

    if (this.rendering) {
      this.pendingPage = num;
      return;
    }

    this.rendering = true;
    this.currentPage = num;
    this._resetPan();

    try {
      const page = await this.pdfDoc.getPage(num);

      const containerWidth = this.canvasContainer.clientWidth;
      const containerHeight = this.canvasContainer.clientHeight;

      if (containerWidth <= 0 || containerHeight <= 0) {
        this.rendering = false;
        return;
      }

      const originalViewport = page.getViewport({ scale: 1 });

      const scaleW = (containerWidth - 8) / originalViewport.width;
      const scaleH = (containerHeight - 8) / originalViewport.height;
      this._fitScale = Math.min(scaleW, scaleH);
      const zoomScale = this._fitScale * this.zoom;

      const displayWidth = Math.floor(originalViewport.width * zoomScale);
      const displayHeight = Math.floor(originalViewport.height * zoomScale);

      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = Math.floor(displayWidth * dpr);
      this.canvas.height = Math.floor(displayHeight * dpr);

      this.canvas.style.width = displayWidth + 'px';
      this.canvas.style.height = displayHeight + 'px';

      const renderScale = zoomScale * dpr;
      const viewport = page.getViewport({ scale: renderScale });

      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      await page.render({
        canvasContext: this.ctx,
        viewport: viewport
      }).promise;
    } catch (err) {
      console.error('Lỗi render trang PDF:', err);
    }

    this._syncOverlaySize();
    this._highlightRegion = null; // clear highlight on page change

    this.rendering = false;

    this._drawOverlay();

    if (this.pendingPage !== null) {
      const pending = this.pendingPage;
      this.pendingPage = null;
      await this.renderPage(pending);
    }
  }

  _syncOverlaySize() {
    this.overlayCanvas.width = this.canvas.width;
    this.overlayCanvas.height = this.canvas.height;
    this.overlayCanvas.style.width = this.canvas.style.width;
    this.overlayCanvas.style.height = this.canvas.style.height;
  }

  setHighlightRegion(regionVert) {
    this._highlightRegion = regionVert;
    this._drawOverlay();
  }

  clearHighlight() {
    this._highlightRegion = null;
    this._drawOverlay();
  }

  _drawOverlay() {
    const ctx = this.overlayCtx;
    ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
    if (!this._highlightRegion) return;

    const [topPct, bottomPct] = this._highlightRegion;
    const w = this.overlayCanvas.width;
    const h = this.overlayCanvas.height;
    const topY = Math.round(topPct * h);
    const bottomY = Math.round(bottomPct * h);

    ctx.fillStyle = 'rgba(200, 200, 200, 0.25)';
    ctx.fillRect(0, topY, w, bottomY - topY);
  }

  /**
   * Lấy ảnh của BẤT KỲ trang nào (dùng cho pre-fetch)
   * Render ra canvas ẩn (offscreen), trả về base64
   */
  async getPageImageForPage(pageNum, maxWidth = 800) {
    if (!this.pdfDoc) return '';
    try {
      const page = await this.pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1 });
      const scale = maxWidth / viewport.width;
      const w = Math.round(viewport.width * scale);
      const h = Math.round(viewport.height * scale);

      const offscreen = document.createElement('canvas');
      offscreen.width = w;
      offscreen.height = h;
      const ctx = offscreen.getContext('2d');

      await page.render({
        canvasContext: ctx,
        viewport: page.getViewport({ scale })
      }).promise;

      return offscreen.toDataURL('image/jpeg', 0.6).split(',')[1];
    } catch (err) {
      console.error('Lỗi render ảnh trang', pageNum, err);
      return '';
    }
  }

  /**
   * Lấy ảnh trang hiện tại dưới dạng base64 (JPEG)
   */
  getPageImageBase64(maxWidth = 800) {
    if (!this.canvas.width || !this.canvas.height) return '';

    const srcW = this.canvas.width;
    const srcH = this.canvas.height;

    if (srcW <= maxWidth) {
      return this.canvas.toDataURL('image/jpeg', 0.6).split(',')[1];
    }

    const scale = maxWidth / srcW;
    const offscreen = document.createElement('canvas');
    offscreen.width = Math.round(srcW * scale);
    offscreen.height = Math.round(srcH * scale);

    const ctx = offscreen.getContext('2d');
    ctx.drawImage(this.canvas, 0, 0, offscreen.width, offscreen.height);

    return offscreen.toDataURL('image/jpeg', 0.6).split(',')[1];
  }

  /**
   * Trích xuất text thông minh từ 1 trang
   * Sắp xếp theo tọa độ, phát hiện cột, dòng mới, heading
   */
  async getTextForPage(pageNum) {
    if (!this.pdfDoc || pageNum < 1 || pageNum > this.totalPages) return '';
    try {
      const page = await this.pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });
      const pageHeight = viewport.height;
      const pageWidth = viewport.width;

      const items = textContent.items.map(item => ({
        str: item.str,
        x: Math.round(item.transform[4] * 10) / 10,
        y: Math.round(item.transform[5] * 10) / 10,
        width: item.width || 0,
        height: item.height || 0,
        fontSize: item.transform[0] || 12
      }));

      if (items.length === 0) return '';

      // Loại bỏ trùng lặp: cùng vị trí + cùng text + cùng font size = trùng
      const deduped = [];
      const seen = new Set();
      for (const item of items) {
        const key = `${item.str}|${item.x}|${item.y}|${Math.round(item.fontSize)}`;
        if (!seen.has(key)) {
          seen.add(key);
          deduped.push(item);
        }
      }

      return this._formatSmartText(deduped, pageHeight, pageWidth);
    } catch (err) {
      console.error('Lỗi trích xuất text trang', pageNum, err);
      return '';
    }
  }

  /**
   * Trích xuất text từ trang hiện tại
   */
  async getPageText() {
    if (!this.pdfDoc) return '';
    return this.getTextForPage(this.currentPage);
  }

  /**
   * Xử lý text thông minh: sắp xếp theo tọa độ, phát hiện cấu trúc
   */
  _formatSmartText(items, pageHeight, pageWidth) {
    // Sắp xếp: trên -> dưới (y giảm dần trong PDF), trái -> phải (x tăng dần)
    items.sort((a, b) => {
      const yDiff = b.y - a.y;
      if (Math.abs(yDiff) < 4) return a.x - b.x;
      return yDiff;
    });

    // Gom nhóm theo dòng (cùng y ± độ cao font)
    const LINE_TOLERANCE = 3;
    const lines = [];
    let currentLine = { items: [], y: items[0].y, fontSize: items[0].fontSize };

    for (const item of items) {
      if (Math.abs(item.y - currentLine.y) <= LINE_TOLERANCE) {
        currentLine.items.push(item);
        currentLine.fontSize = Math.max(currentLine.fontSize, item.fontSize);
      } else {
        if (currentLine.items.length > 0) {
          currentLine.items.sort((a, b) => a.x - b.x);
          currentLine.text = currentLine.items.map(i => i.str).join(' ').trim();
          lines.push(currentLine);
        }
        currentLine = { items: [item], y: item.y, fontSize: item.fontSize };
      }
    }
    if (currentLine.items.length > 0) {
      currentLine.items.sort((a, b) => a.x - b.x);
      currentLine.text = currentLine.items.map(i => i.str).join(' ').trim();
      lines.push(currentLine);
    }

    // Phát hiện cột: nếu các dòng có 2+ cluster x-position cách xa nhau
    const xPositions = lines.map(l => l.items[0].x);
    const COLUMN_GAP = pageWidth * 0.12;
    const columns = this._detectColumns(xPositions, COLUMN_GAP);

    // Phát hiện heading: font size > trung bình * 1.15
    const fontSizes = lines.map(l => l.fontSize).sort((a, b) => a - b);
    const avgFontSize = fontSizes.length > 0
      ? fontSizes[Math.floor(fontSizes.length * 0.7)] // percentile 70
      : 12;
    const HEADING_THRESHOLD = avgFontSize * 1.12;

    // Phát hiện paragraph break: khoảng cách y > bình thường
    const yGaps = [];
    for (let i = 1; i < lines.length; i++) {
      yGaps.push(Math.abs(lines[i].y - lines[i - 1].y));
    }
    let avgYGap = 16;
    if (yGaps.length > 0) {
      const sorted = yGaps.sort((a, b) => a - b);
      avgYGap = sorted[Math.floor(sorted.length * 0.6)];
    }
    const PARAGRAPH_GAP = Math.max(avgYGap * 1.6, 14);

    // Tạo mô tả layout
    let layoutDesc = '';
    if (columns > 1) {
      layoutDesc = `Trang có ${columns} cột. `;
    }

    // Xây dựng text có cấu trúc
    const linesOut = [];
    let prevWasEmpty = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let text = line.text;
      if (!text) continue;

      const isHeading = line.fontSize > HEADING_THRESHOLD;
      let isParagraphBreak = false;
      if (i > 0 && Math.abs(line.y - lines[i - 1].y) > PARAGRAPH_GAP) {
        isParagraphBreak = true;
      }

      // Thêm dòng trống giữa các đoạn
      if (isParagraphBreak && !prevWasEmpty) {
        linesOut.push('');
        prevWasEmpty = true;
      }

      // Đánh dấu heading
      if (isHeading) {
        text = `## ${text}`;
        if (!prevWasEmpty) {
          linesOut.push('');
        }
      }

      linesOut.push(text);
      prevWasEmpty = text === '';
    }

    const bodyText = linesOut.join('\n').trim();

    return layoutDesc + bodyText;
  }

  /**
   * Phát hiện số cột trong trang bằng cách cluster x-positions
   */
  _detectColumns(xPositions, gapThreshold) {
    if (xPositions.length < 2) return 1;

    const sorted = [...xPositions].sort((a, b) => a - b);
    const clusters = [];
    let cluster = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - cluster[cluster.length - 1] > gapThreshold) {
        clusters.push(cluster);
        cluster = [sorted[i]];
      } else {
        cluster.push(sorted[i]);
      }
    }
    clusters.push(cluster);

    // Chỉ tính cluster có ít nhất 3 dòng
    return clusters.filter(c => c.length >= 3).length || 1;
  }

  /**
   * Zoom in
   */
  zoomIn() {
    this.zoom = Math.min(this.zoom * 1.25, 5);
    this._resetPan();
    this.renderPage(this.currentPage);
  }

  /**
   * Zoom out
   */
  zoomOut() {
    this.zoom = Math.max(this.zoom / 1.25, 0.2);
    this._resetPan();
    this.renderPage(this.currentPage);
  }

  /**
   * Reset zoom về fit trang
   */
  resetZoom() {
    this.zoom = 1;
    this._resetPan();
    this.renderPage(this.currentPage);
  }

  /**
   * Chuyển sang trang tiếp theo
   */
  async nextPage() {
    if (this.currentPage < this.totalPages) {
      await this.renderPage(this.currentPage + 1);
      return true;
    }
    return false;
  }

  /**
   * Quay lại trang trước
   */
  async prevPage() {
    if (this.currentPage > 1) {
      await this.renderPage(this.currentPage - 1);
      return true;
    }
    return false;
  }

  get isLoaded() {
    return this.pdfDoc !== null;
  }
}
