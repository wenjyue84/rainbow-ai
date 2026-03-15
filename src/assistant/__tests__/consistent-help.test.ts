/**
 * US-922: WCAG 2.2 SC 3.2.6 Consistent Help placement tests
 *
 * Validates that help mechanisms (launcher, in-widget help button, FAQ footer)
 * appear in consistent positions across all webchat widget screens.
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

describe('US-922: WCAG 2.2 SC 3.2.6 Consistent Help', () => {
  describe('Widget launcher (widget.js) — consistent position across pages', () => {
    it('uses position:fixed for the launcher button', () => {
      expect(widgetJs).toContain('position: fixed;');
    });

    it('uses consistent bottom offset (24px)', () => {
      expect(widgetJs).toContain('bottom: 24px;');
    });

    it('uses consistent horizontal offset (24px) for both left and right positions', () => {
      // The position is derived from data-position attribute
      expect(widgetJs).toContain("'left: 24px;'");
      expect(widgetJs).toContain("'right: 24px;'");
    });

    it('does not dynamically reposition based on scroll', () => {
      // SC 3.2.6 says position must not shift — no scroll-based repositioning
      expect(widgetJs).not.toMatch(/scroll.*position/i);
      expect(widgetJs).not.toContain('onscroll');
    });

    it('launcher has ARIA label indicating help availability', () => {
      expect(widgetJs).toContain('Help is available');
    });
  });

  describe('In-widget Help button — consistent header position', () => {
    it('has a Help button in the header', () => {
      expect(webchatHtml).toContain('id="helpBtn"');
      expect(webchatHtml).toContain('class="header-help-btn"');
    });

    it('Help button has accessible label', () => {
      expect(webchatHtml).toContain('aria-label="Help and contact information"');
    });

    it('Help button is inside the header div (consistent position)', () => {
      const headerStart = webchatHtml.indexOf('class="header"');
      const headerEnd = webchatHtml.indexOf('</div>', webchatHtml.indexOf('id="helpBtn"'));
      const helpBtnPos = webchatHtml.indexOf('id="helpBtn"');
      expect(helpBtnPos).toBeGreaterThan(headerStart);
      expect(helpBtnPos).toBeLessThan(headerEnd);
    });

    it('Help button appears before the messages area (never shifts)', () => {
      const helpBtnPos = webchatHtml.indexOf('id="helpBtn"');
      const messagesPos = webchatHtml.indexOf('id="messages"');
      expect(helpBtnPos).toBeLessThan(messagesPos);
    });
  });

  describe('Help footer — consistent FAQ/Contact position', () => {
    it('has a help footer nav element', () => {
      expect(webchatHtml).toContain('id="helpFooter"');
      expect(webchatHtml).toContain('class="help-footer"');
    });

    it('help footer has aria-label for navigation landmark', () => {
      expect(webchatHtml).toContain('aria-label="Help and support links"');
    });

    it('contains FAQ link', () => {
      expect(webchatHtml).toContain('id="helpFaqLink"');
    });

    it('contains Talk to Agent link', () => {
      expect(webchatHtml).toContain('id="helpAgentLink"');
    });

    it('contains Contact Us link', () => {
      expect(webchatHtml).toContain('id="helpContactLink"');
    });

    it('help footer appears after input area and before powered-by (consistent bottom position)', () => {
      const inputAreaPos = webchatHtml.indexOf('class="input-area"');
      const helpFooterPos = webchatHtml.indexOf('id="helpFooter"');
      const poweredByPos = webchatHtml.indexOf('class="powered-by"');
      expect(helpFooterPos).toBeGreaterThan(inputAreaPos);
      expect(helpFooterPos).toBeLessThan(poweredByPos);
    });
  });

  describe('Position consistency across widget screens', () => {
    it('header with Help button is NOT inside consent overlay (visible on all screens)', () => {
      const consentOverlayEnd = webchatHtml.indexOf('</div>', webchatHtml.indexOf('id="consentOverlay"'));
      // Find the closing of the consent overlay section (after the consent-buttons)
      const consentSectionEnd = webchatHtml.indexOf('id="declinedMsg"');
      const headerPos = webchatHtml.indexOf('id="chatHeader"');
      // Header is after consent overlay — it's always visible
      expect(headerPos).toBeGreaterThan(consentSectionEnd);
    });

    it('help footer is NOT inside consent overlay (visible on all screens)', () => {
      const consentOverlayPos = webchatHtml.indexOf('id="consentOverlay"');
      const helpFooterPos = webchatHtml.indexOf('id="helpFooter"');
      // Help footer is well after consent overlay
      expect(helpFooterPos).toBeGreaterThan(consentOverlayPos + 500);
    });

    it('help button uses CSS that does not shift position between desktop and mobile', () => {
      // The header-help-btn uses margin-left:auto for consistent right-alignment
      expect(webchatHtml).toContain('margin-left: auto');
      // No position:absolute/fixed on help button (stays in document flow within header)
      const helpBtnCssMatch = webchatHtml.match(/\.header-help-btn\s*\{[^}]+\}/);
      expect(helpBtnCssMatch).toBeTruthy();
      expect(helpBtnCssMatch![0]).not.toContain('position: absolute');
      expect(helpBtnCssMatch![0]).not.toContain('position: fixed');
    });
  });
});
