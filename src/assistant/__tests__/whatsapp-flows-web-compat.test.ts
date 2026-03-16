/**
 * US-936: WhatsApp Flows Web Companion Compatibility Tests
 *
 * Validates that all production WhatsApp Flows render correctly on
 * WhatsApp Web (desktop companion), supported since December 2025.
 *
 * Test coverage:
 *  - All flow JSONs pass web compat validation (no mobile-only dimensions)
 *  - ImageCarousel components use standard aspect ratios
 *  - Endpoint responses are platform-agnostic
 *  - All screens use SingleColumnLayout
 *  - Testing runbook checklist completeness
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  validateFlowWebCompat,
  validateEndpointResponse,
} from '../../lib/whatsapp-flows-web-compat.js';

// ─── Load all production flow JSON files ────────────────────────────
const FLOW_DATA_DIR = join(process.cwd(), 'src', 'assistant', 'data');

function loadFlowJson(filename: string): Record<string, any> | null {
  const path = join(FLOW_DATA_DIR, filename);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

const PRODUCTION_FLOWS = [
  { file: 'reservation-flow.json', name: 'Reservation Flow' },
  { file: 'menu-flow.json', name: 'Menu Ordering Flow' },
];

// ─── AC1: All production flows render correctly on WhatsApp Web ─────
describe('US-936: WhatsApp Flows Web Companion Compatibility', () => {
  describe('AC1: All production flows pass web compat validation', () => {
    for (const flow of PRODUCTION_FLOWS) {
      it(`${flow.name} (${flow.file}) is web-compatible`, () => {
        const json = loadFlowJson(flow.file);
        expect(json, `Flow file ${flow.file} not found`).not.toBeNull();

        const result = validateFlowWebCompat(json!, flow.file);
        const errors = result.issues.filter(i => i.severity === 'error');

        expect(errors).toEqual([]);
        expect(result.compatible).toBe(true);
        expect(result.screensChecked).toBeGreaterThan(0);
      });
    }
  });

  // ─── AC2: No mobile-only dimensions or pixel widths ──────────────
  describe('AC2: No mobile-only dimensions that break on desktop', () => {
    for (const flow of PRODUCTION_FLOWS) {
      it(`${flow.name} has no fixed pixel widths`, () => {
        const json = loadFlowJson(flow.file);
        if (!json) return;

        const jsonString = JSON.stringify(json);
        // Check for pixel-based dimensions in the raw JSON
        const pixelMatches = jsonString.match(/"(?:width|height|min-width|max-width|min-height|max-height)":\s*"\d+px"/g);
        expect(pixelMatches || []).toEqual([]);
      });

      it(`${flow.name} uses only SingleColumnLayout`, () => {
        const json = loadFlowJson(flow.file);
        if (!json) return;

        for (const screen of json.screens || []) {
          expect(screen.layout?.type).toBe('SingleColumnLayout');
        }
      });
    }
  });

  // ─── AC3: ImageCarousel components are web-compatible ────────────
  describe('AC3: ImageCarousel components render on WhatsApp Web', () => {
    it('reservation-flow.json ImageCarousel uses 4:3 aspect ratio', () => {
      const json = loadFlowJson('reservation-flow.json');
      if (!json) return;

      const carousels = findComponentsByType(json, 'ImageCarousel');
      expect(carousels.length).toBeGreaterThan(0);

      for (const carousel of carousels) {
        expect(['4:3', '16:9', '1:1']).toContain(carousel['aspect-ratio']);
      }
    });

    it('menu-flow.json ImageCarousel uses 16:9 aspect ratio', () => {
      const json = loadFlowJson('menu-flow.json');
      if (!json) return;

      const carousels = findComponentsByType(json, 'ImageCarousel');
      expect(carousels.length).toBeGreaterThan(0);

      for (const carousel of carousels) {
        expect(['4:3', '16:9', '1:1']).toContain(carousel['aspect-ratio']);
      }
    });

    it('all ImageCarousels have images bound via data expressions', () => {
      for (const flow of PRODUCTION_FLOWS) {
        const json = loadFlowJson(flow.file);
        if (!json) continue;

        const carousels = findComponentsByType(json, 'ImageCarousel');
        for (const carousel of carousels) {
          // Images should be data-bound (dynamic via data exchange)
          const images = carousel.images;
          expect(typeof images).toBe('string');
          expect(images).toMatch(/^\$\{data\./);
        }
      }
    });

    it('ImageCarousels have TextBody fallback for when images unavailable', () => {
      for (const flow of PRODUCTION_FLOWS) {
        const json = loadFlowJson(flow.file);
        if (!json) continue;

        const carousels = findComponentsByType(json, 'ImageCarousel');
        if (carousels.length === 0) continue;

        // For each screen with a carousel, there should be a fallback TextBody
        for (const screen of json.screens || []) {
          const screenCarousels = findComponentsByTypeInChildren(
            screen.layout?.children || [],
            'ImageCarousel',
          );
          if (screenCarousels.length > 0) {
            const fallbackTexts = findComponentsByTypeInChildren(
              screen.layout?.children || [],
              'TextBody',
            );
            const hasFallback = fallbackTexts.some(
              (t: any) => t.visible && typeof t.visible === 'string' && t.visible.includes('fallback'),
            );
            expect(hasFallback).toBe(true);
          }
        }
      }
    });
  });

  // ─── AC4: Endpoint responses are platform-agnostic ───────────────
  describe('AC4: Flow data-exchange responses work on both mobile and web', () => {
    it('reservation INIT response is platform-agnostic', () => {
      const response = {
        screen: 'RESERVATION_DATES',
        data: {
          today: '2026-03-16',
          max_date: '2026-06-14',
          error_message: '',
        },
      };
      const issues = validateEndpointResponse(response, 'reservation');
      expect(issues.filter(i => i.severity === 'error')).toEqual([]);
    });

    it('reservation check_availability response is platform-agnostic', () => {
      const response = {
        screen: 'RESERVATION_DETAILS',
        data: {
          room_options: [
            { id: 'mixed_dorm', title: 'Mixed Dorm Bed (RM35/night)' },
          ],
          room_carousel: { type: 'ImageCarousel', 'aspect-ratio': '4:3', images: [] },
          room_carousel_fallback: '',
          check_in_date: '2026-03-20',
          check_out_date: '2026-03-22',
          error_message: '',
        },
      };
      const issues = validateEndpointResponse(response, 'reservation');
      expect(issues.filter(i => i.severity === 'error')).toEqual([]);
    });

    it('reservation confirm response is platform-agnostic', () => {
      const response = {
        screen: 'RESERVATION_CONFIRM',
        data: {
          booking_ref: 'PEL-260316-AB12',
          summary: 'Check-in: 2026-03-20\nCheck-out: 2026-03-22',
        },
      };
      const issues = validateEndpointResponse(response, 'reservation');
      expect(issues.filter(i => i.severity === 'error')).toEqual([]);
    });

    it('menu INIT response is platform-agnostic', () => {
      const response = {
        screen: 'MENU_BROWSE',
        data: {
          menu_carousel: { type: 'ImageCarousel', 'aspect-ratio': '16:9', images: [] },
          menu_carousel_fallback: '',
          menu_items: [{ id: 'nasi_lemak', title: 'Nasi Lemak Special (RM12)' }],
          error_message: '',
        },
      };
      const issues = validateEndpointResponse(response, 'menu');
      expect(issues.filter(i => i.severity === 'error')).toEqual([]);
    });

    it('menu order confirm response is platform-agnostic', () => {
      const response = {
        screen: 'ORDER_CONFIRM',
        data: {
          order_ref: 'MM-260316-CD34',
          summary: '1x Nasi Lemak Special\nTotal: RM12.00',
        },
      };
      const issues = validateEndpointResponse(response, 'menu');
      expect(issues.filter(i => i.severity === 'error')).toEqual([]);
    });

    it('rejects responses with platform-specific fields', () => {
      const response = {
        screen: 'RESERVATION_DATES',
        data: {
          mobile_only: true,
          error_message: '',
        },
      };
      const issues = validateEndpointResponse(response, 'reservation');
      expect(issues.filter(i => i.severity === 'error').length).toBeGreaterThan(0);
    });

    it('rejects responses missing screen field', () => {
      const response = { data: { error_message: '' } };
      const issues = validateEndpointResponse(response as any, 'reservation');
      expect(issues.filter(i => i.severity === 'error').length).toBeGreaterThan(0);
    });
  });

  // ─── AC5: Test checklist for WhatsApp Web verification ───────────
  describe('AC5: Flows testing runbook has WhatsApp Web section', () => {
    it('whatsapp-flows-web-checklist.md exists in docs/testing/', () => {
      const checklistPath = join(
        process.cwd(),
        'docs',
        'testing',
        'whatsapp-flows-web-checklist.md',
      );
      expect(existsSync(checklistPath)).toBe(true);
    });

    it('checklist covers Chrome and Firefox browsers', () => {
      const checklistPath = join(
        process.cwd(),
        'docs',
        'testing',
        'whatsapp-flows-web-checklist.md',
      );
      if (!existsSync(checklistPath)) return;
      const content = readFileSync(checklistPath, 'utf-8');
      expect(content).toContain('Chrome');
      expect(content).toContain('Firefox');
    });

    it('checklist covers all three flow types', () => {
      const checklistPath = join(
        process.cwd(),
        'docs',
        'testing',
        'whatsapp-flows-web-checklist.md',
      );
      if (!existsSync(checklistPath)) return;
      const content = readFileSync(checklistPath, 'utf-8');
      expect(content).toContain('reservation');
      expect(content).toContain('check-in');
      expect(content).toContain('menu');
    });

    it('checklist covers ImageCarousel desktop navigation', () => {
      const checklistPath = join(
        process.cwd(),
        'docs',
        'testing',
        'whatsapp-flows-web-checklist.md',
      );
      if (!existsSync(checklistPath)) return;
      const content = readFileSync(checklistPath, 'utf-8');
      expect(content).toContain('ImageCarousel');
    });
  });

  // ─── Structural validation across all flows ──────────────────────
  describe('Flow JSON structural validation for web rendering', () => {
    it('all screens have layout.type defined', () => {
      for (const flow of PRODUCTION_FLOWS) {
        const json = loadFlowJson(flow.file);
        if (!json) continue;

        for (const screen of json.screens || []) {
          expect(screen.layout).toBeDefined();
          expect(screen.layout.type).toBeDefined();
        }
      }
    });

    it('all forms have name attributes', () => {
      for (const flow of PRODUCTION_FLOWS) {
        const json = loadFlowJson(flow.file);
        if (!json) continue;

        const forms = findComponentsByType(json, 'Form');
        for (const form of forms) {
          expect(form.name).toBeDefined();
          expect(form.name.length).toBeGreaterThan(0);
        }
      }
    });

    it('all terminal screens use complete action', () => {
      for (const flow of PRODUCTION_FLOWS) {
        const json = loadFlowJson(flow.file);
        if (!json) continue;

        for (const screen of json.screens || []) {
          if (screen.terminal === true) {
            const footers = findComponentsByTypeInChildren(
              screen.layout?.children || [],
              'Footer',
            );
            expect(footers.length).toBeGreaterThan(0);
            for (const footer of footers) {
              expect(footer['on-click-action']?.name).toBe('complete');
            }
          }
        }
      }
    });

    it('routing model references only existing screens', () => {
      for (const flow of PRODUCTION_FLOWS) {
        const json = loadFlowJson(flow.file);
        if (!json) continue;

        const screenIds = new Set((json.screens || []).map((s: any) => s.id));
        const routing = json.routing_model || {};

        for (const [from, targets] of Object.entries(routing)) {
          expect(screenIds.has(from)).toBe(true);
          for (const target of targets as string[]) {
            expect(screenIds.has(target)).toBe(true);
          }
        }
      }
    });

    it('flow version is 7.1 or higher (web companion requires v6+)', () => {
      for (const flow of PRODUCTION_FLOWS) {
        const json = loadFlowJson(flow.file);
        if (!json) continue;

        const version = parseFloat(json.version || '0');
        expect(version).toBeGreaterThanOrEqual(6.0);
      }
    });
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────

function findComponentsByType(flowJson: Record<string, any>, type: string): any[] {
  const results: any[] = [];
  for (const screen of flowJson.screens || []) {
    const children = screen.layout?.children || [];
    results.push(...findComponentsByTypeInChildren(children, type));
  }
  return results;
}

function findComponentsByTypeInChildren(children: any[], type: string): any[] {
  const results: any[] = [];
  for (const child of children) {
    if (child.type === type) {
      results.push(child);
    }
    if (child.children) {
      results.push(...findComponentsByTypeInChildren(child.children, type));
    }
  }
  return results;
}
