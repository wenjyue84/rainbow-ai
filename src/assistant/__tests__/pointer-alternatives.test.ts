/**
 * US-931: WCAG 2.2 SC 2.5.7 Pointer alternatives to drag operations
 *
 * Validates that every drag operation in the webchat widget has a
 * single-pointer (click/tap) alternative that achieves the same result.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const webchatHtml = readFileSync(
  resolve(__dirname, '../../public/webchat.html'),
  'utf-8',
);

const widgetJs = readFileSync(
  resolve(__dirname, '../../public/widget.js'),
  'utf-8',
);

describe('US-931: WCAG 2.2 SC 2.5.7 Pointer alternatives to drag operations', () => {
  describe('AC1: File upload has both drag-and-drop AND click-to-select', () => {
    it('has a hidden file input element for click-to-select', () => {
      expect(webchatHtml).toContain('id="fileInput"');
      expect(webchatHtml).toContain('type="file"');
    });

    it('has a visible attach button as pointer alternative', () => {
      expect(webchatHtml).toContain('id="attachBtn"');
      expect(webchatHtml).toContain('class="attach-btn"');
    });

    it('attach button has accessible label', () => {
      expect(webchatHtml).toContain('aria-label="Attach file"');
    });

    it('file input has accessible label', () => {
      expect(webchatHtml).toContain('aria-label="Select file to attach"');
    });

    it('attach button triggers hidden file input via click handler', () => {
      // The JS wires attachBtn click to fileInput.click()
      expect(webchatHtml).toContain("attachBtn.addEventListener('click'");
      expect(webchatHtml).toContain('fileInput.click()');
    });

    it('has a drag-and-drop overlay for visual feedback', () => {
      expect(webchatHtml).toContain('id="dropOverlay"');
      expect(webchatHtml).toContain('class="drop-overlay"');
    });

    it('drop overlay is hidden by default (aria-hidden)', () => {
      expect(webchatHtml).toMatch(/id="dropOverlay"[^>]*aria-hidden="true"/);
    });

    it('handles dragenter, dragleave, dragover, and drop events', () => {
      expect(webchatHtml).toContain("'dragenter'");
      expect(webchatHtml).toContain("'dragleave'");
      expect(webchatHtml).toContain("'dragover'");
      expect(webchatHtml).toContain("'drop'");
    });

    it('both drag-drop and click use the same setAttachedFile handler', () => {
      // Both paths call setAttachedFile()
      const setAttachedCount = (webchatHtml.match(/setAttachedFile\(/g) || []).length;
      // At least: function definition + fileInput change handler + drop handler
      expect(setAttachedCount).toBeGreaterThanOrEqual(3);
    });
  });

  describe('AC2: Widget panel is not resizable by dragging', () => {
    it('widget panel uses fixed dimensions (no drag resize)', () => {
      // Panel size is set via CSS, not draggable resize handles
      expect(widgetJs).toContain('width: 380px');
      expect(widgetJs).toContain('height: 580px');
      expect(widgetJs).not.toContain('resize');
    });

    it('textarea has resize: none (no drag resize)', () => {
      expect(webchatHtml).toContain('resize: none');
    });
  });

  describe('AC3: No swipe-to-dismiss or drag-to-scroll without alternatives', () => {
    it('no custom swipe handlers exist without click alternatives', () => {
      // No touchmove-based swipe-to-dismiss handlers
      expect(webchatHtml).not.toMatch(/swipe.*dismiss/i);
    });

    it('widget close uses click button, not drag gesture', () => {
      // Close is via button click or Escape key, not drag
      expect(widgetJs).toContain('closePanel');
      expect(widgetJs).toContain("'click'");
      expect(widgetJs).toContain("e.key === 'Escape'");
    });
  });

  describe('AC4: File preview with remove button (pointer action)', () => {
    it('has a file preview bar', () => {
      expect(webchatHtml).toContain('id="filePreview"');
    });

    it('file preview has a click-to-remove button', () => {
      expect(webchatHtml).toContain('id="filePreviewRemove"');
      expect(webchatHtml).toContain('aria-label="Remove attached file"');
    });

    it('remove button uses click handler (not drag to dismiss)', () => {
      expect(webchatHtml).toContain("filePreviewRemove.addEventListener('click'");
    });
  });
});
