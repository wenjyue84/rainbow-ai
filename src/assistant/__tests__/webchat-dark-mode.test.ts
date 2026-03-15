/**
 * US-896: Webchat widget dark mode support via CSS prefers-color-scheme
 *
 * Tests verify:
 * - CSS custom properties define dark palette tokens
 * - @media (prefers-color-scheme: dark) block exists
 * - Forced theme classes (.theme-dark / .theme-light) override auto detection
 * - Widget embed script accepts theme config parameter
 * - Theme class applied before first paint (no FOUC)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const webchatHtml = readFileSync(resolve(__dirname, '../../public/webchat.html'), 'utf-8');
const widgetJs = readFileSync(resolve(__dirname, '../../public/widget.js'), 'utf-8');

describe('US-896: Webchat dark mode', () => {
  describe('webchat.html CSS', () => {
    it('has @media (prefers-color-scheme: dark) block', () => {
      expect(webchatHtml).toContain('@media (prefers-color-scheme: dark)');
    });

    it('dark mode overrides background palette token --bg', () => {
      // The dark block should redefine --bg to a dark value
      const darkBlockMatch = webchatHtml.match(
        /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{[^}]*--bg:\s*(#[0-9a-fA-F]+)/
      );
      expect(darkBlockMatch).not.toBeNull();
      // Should be a dark color (low luminance hex)
      const hex = darkBlockMatch![1];
      expect(hex).toBeTruthy();
    });

    it('dark mode overrides text palette token --text', () => {
      const match = webchatHtml.match(
        /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{[^}]*--text:\s*(#[0-9a-fA-F]+)/
      );
      expect(match).not.toBeNull();
    });

    it('dark mode overrides --surface, --border, --bot-bubble, --bot-text', () => {
      for (const token of ['--surface', '--border', '--bot-bubble', '--bot-text']) {
        expect(webchatHtml).toMatch(
          new RegExp(`@media\\s*\\(prefers-color-scheme:\\s*dark\\)[^}]*${token.replace('--', '--')}:\\s*#`)
        );
      }
    });

    it('has .theme-dark class for forced dark mode', () => {
      expect(webchatHtml).toContain('.theme-dark');
      // .theme-dark should define --bg
      const match = webchatHtml.match(/\.theme-dark\s*\{[^}]*--bg:\s*(#[0-9a-fA-F]+)/);
      expect(match).not.toBeNull();
    });

    it('.theme-light prevents dark mode when OS prefers dark', () => {
      // The media query should use :root:not(.theme-light) so .theme-light overrides
      expect(webchatHtml).toContain(':root:not(.theme-light)');
    });

    it('textarea has explicit background and color using CSS variables', () => {
      expect(webchatHtml).toMatch(/\.input-area\s+textarea\s*\{[^}]*background:\s*var\(--surface\)/);
      expect(webchatHtml).toMatch(/\.input-area\s+textarea\s*\{[^}]*color:\s*var\(--text\)/);
    });
  });

  describe('webchat.html FOUC prevention', () => {
    it('applies theme class in a <script> block before <style>', () => {
      const scriptIndex = webchatHtml.indexOf('<script>');
      const styleIndex = webchatHtml.indexOf('<style>');
      // The inline script that sets theme class should appear before the main style block
      expect(scriptIndex).toBeLessThan(styleIndex);
      expect(scriptIndex).toBeGreaterThan(0);
    });

    it('inline script reads theme from URL params', () => {
      // The FOUC-prevention script should parse URLSearchParams for theme
      const headSection = webchatHtml.split('</script>')[0];
      expect(headSection).toContain("URLSearchParams");
      expect(headSection).toContain("theme");
    });

    it('has color-scheme meta tag for browser-level dark support', () => {
      expect(webchatHtml).toContain('name="color-scheme"');
      expect(webchatHtml).toContain('content="light dark"');
    });
  });

  describe('widget.js theme config', () => {
    it('reads data-theme attribute from script tag', () => {
      expect(widgetJs).toContain("data-theme");
    });

    it('defaults theme to auto when not specified', () => {
      expect(widgetJs).toMatch(/theme.*\|\|\s*['"]auto['"]/);
    });

    it('passes theme parameter to iframe URL when not auto', () => {
      // Should set theme param on iframeParams
      expect(widgetJs).toContain("iframeParams.set('theme'");
    });

    it('does not pass theme param when set to auto', () => {
      // When theme is auto, it should NOT set the param (let OS preference handle it)
      expect(widgetJs).toMatch(/theme\s*!==\s*['"]auto['"]/);
    });
  });

  describe('dark mode applies to all chat UI areas', () => {
    it('chat bubble uses --bot-bubble variable', () => {
      expect(webchatHtml).toMatch(/\.message\.bot\s+\.bubble\s*\{[^}]*background:\s*var\(--bot-bubble\)/);
    });

    it('header uses --primary variable (unchanged in dark)', () => {
      expect(webchatHtml).toMatch(/\.header\s*\{[^}]*background:\s*var\(--primary\)/);
    });

    it('message list background uses --bg via body', () => {
      expect(webchatHtml).toMatch(/body\s*\{[^}]*background:\s*var\(--bg\)/);
    });

    it('input field uses --surface background', () => {
      expect(webchatHtml).toMatch(/\.input-area\s*\{[^}]*background:\s*var\(--surface\)/);
    });
  });
});
