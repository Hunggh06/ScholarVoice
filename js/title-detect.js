/**
 * title-detect.js - Phát hiện slide "chỉ có tiêu đề" (trang bìa, trang mở đầu chương)
 * Dựa trên số lượng từ sau khi làm sạch ký tự markdown/đặc biệt.
 * Thuần (pure) — không dùng DOM/localStorage, test được bằng Node.
 */

export const TITLE_SLIDE_WORD_THRESHOLD = 20;

/**
 * @param {string|null|undefined} pageText - text đã trích xuất từ PDF (getPageText)
 * @returns {boolean} true nếu slide chỉ có tiêu đề (<= threshold từ)
 */
export function detectTitleSlide(pageText) {
  if (!pageText || typeof pageText !== 'string') return false;
  const clean = pageText
    .replace(/[#*`\-_=~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return false;
  return clean.split(' ').length <= TITLE_SLIDE_WORD_THRESHOLD;
}
