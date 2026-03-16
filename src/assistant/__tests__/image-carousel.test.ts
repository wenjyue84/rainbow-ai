/**
 * US-932: WhatsApp Flows Image Carousel tests
 *
 * Validates ImageCarousel component building, size validation,
 * fallback text, and flow JSON structure for room and menu carousels.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  buildImageCarousel,
  estimateBase64Size,
  buildRoomCarousel,
  buildMenuCarousel,
  type CarouselConfig,
} from '../../lib/flow-image-carousel.js';

// ─── Flow JSON validation ─────────────────────────────────────────────
const reservationFlowJson = JSON.parse(
  readFileSync(resolve(__dirname, '../data/reservation-flow.json'), 'utf-8'),
);

const menuFlowJson = JSON.parse(
  readFileSync(resolve(__dirname, '../data/menu-flow.json'), 'utf-8'),
);

const roomImagesJson = JSON.parse(
  readFileSync(resolve(__dirname, '../data/room-images.json'), 'utf-8'),
);

const menuImagesJson = JSON.parse(
  readFileSync(resolve(__dirname, '../data/menu-images.json'), 'utf-8'),
);

describe('US-932: WhatsApp Flows Image Carousel', () => {
  describe('Flow JSON structure', () => {
    it('reservation flow uses version 7.1 (required for ImageCarousel)', () => {
      expect(reservationFlowJson.version).toBe('7.1');
    });

    it('menu flow uses version 7.1', () => {
      expect(menuFlowJson.version).toBe('7.1');
    });

    it('reservation flow RESERVATION_DETAILS screen has ImageCarousel component', () => {
      const detailsScreen = reservationFlowJson.screens.find(
        (s: any) => s.id === 'RESERVATION_DETAILS',
      );
      expect(detailsScreen).toBeDefined();

      const formChildren = detailsScreen.layout.children[0].children;
      const carousel = formChildren.find((c: any) => c.type === 'ImageCarousel');
      expect(carousel).toBeDefined();
      expect(carousel['aspect-ratio']).toBe('4:3');
    });

    it('menu flow MENU_BROWSE screen has ImageCarousel component', () => {
      const browseScreen = menuFlowJson.screens.find(
        (s: any) => s.id === 'MENU_BROWSE',
      );
      expect(browseScreen).toBeDefined();

      const formChildren = browseScreen.layout.children[0].children;
      const carousel = formChildren.find((c: any) => c.type === 'ImageCarousel');
      expect(carousel).toBeDefined();
      expect(carousel['aspect-ratio']).toBe('16:9');
    });

    it('reservation flow has fallback text element for when images fail', () => {
      const detailsScreen = reservationFlowJson.screens.find(
        (s: any) => s.id === 'RESERVATION_DETAILS',
      );
      const formChildren = detailsScreen.layout.children[0].children;
      const fallback = formChildren.find(
        (c: any) => c.type === 'TextBody' && c.text?.includes('room_carousel_fallback'),
      );
      expect(fallback).toBeDefined();
      expect(fallback.visible).toContain('room_carousel_fallback');
    });

    it('menu flow has fallback text element for when images fail', () => {
      const browseScreen = menuFlowJson.screens.find(
        (s: any) => s.id === 'MENU_BROWSE',
      );
      const formChildren = browseScreen.layout.children[0].children;
      const fallback = formChildren.find(
        (c: any) => c.type === 'TextBody' && c.text?.includes('menu_carousel_fallback'),
      );
      expect(fallback).toBeDefined();
      expect(fallback.visible).toContain('menu_carousel_fallback');
    });
  });

  describe('Image config files', () => {
    it('room-images.json has up to 3 images with alt-text', () => {
      expect(roomImagesJson.images.length).toBeLessThanOrEqual(3);
      expect(roomImagesJson.images.length).toBeGreaterThan(0);
      for (const img of roomImagesJson.images) {
        expect(img.altText).toBeTruthy();
        expect(img.src).toMatch(/^data:image\/(png|jpeg);base64,/);
      }
    });

    it('menu-images.json has up to 3 images with alt-text', () => {
      expect(menuImagesJson.images.length).toBeLessThanOrEqual(3);
      expect(menuImagesJson.images.length).toBeGreaterThan(0);
      for (const img of menuImagesJson.images) {
        expect(img.altText).toBeTruthy();
        expect(img.src).toMatch(/^data:image\/(png|jpeg);base64,/);
      }
    });

    it('all images are under 100KB', () => {
      const allImages = [...roomImagesJson.images, ...menuImagesJson.images];
      for (const img of allImages) {
        const size = estimateBase64Size(img.src);
        expect(size).toBeLessThan(100 * 1024);
      }
    });

    it('room images use 4:3 aspect ratio', () => {
      expect(roomImagesJson.aspectRatio).toBe('4:3');
    });

    it('menu images use 16:9 aspect ratio', () => {
      expect(menuImagesJson.aspectRatio).toBe('16:9');
    });
  });

  describe('buildImageCarousel()', () => {
    const testConfig: CarouselConfig = {
      aspectRatio: '4:3',
      images: [
        { id: 'a', src: 'data:image/png;base64,AAAA', altText: 'Image A', label: 'A' },
        { id: 'b', src: 'data:image/png;base64,BBBB', altText: 'Image B', label: 'B' },
        { id: 'c', src: 'data:image/png;base64,CCCC', altText: 'Image C', label: 'C' },
      ],
    };

    it('builds an ImageCarousel component with correct type', () => {
      const result = buildImageCarousel(testConfig);
      expect(result.type).toBe('ImageCarousel');
    });

    it('limits to max 3 images', () => {
      const fourImages: CarouselConfig = {
        aspectRatio: '4:3',
        images: [
          { id: 'a', src: 'data:image/png;base64,AAAA', altText: 'A' },
          { id: 'b', src: 'data:image/png;base64,BBBB', altText: 'B' },
          { id: 'c', src: 'data:image/png;base64,CCCC', altText: 'C' },
          { id: 'd', src: 'data:image/png;base64,DDDD', altText: 'D' },
        ],
      };
      const result = buildImageCarousel(fourImages);
      expect(result.type).toBe('ImageCarousel');
      if (result.type === 'ImageCarousel') {
        expect(result.images.length).toBe(3);
      }
    });

    it('filters by IDs when specified', () => {
      const result = buildImageCarousel(testConfig, ['a', 'c']);
      expect(result.type).toBe('ImageCarousel');
      if (result.type === 'ImageCarousel') {
        expect(result.images.length).toBe(2);
      }
    });

    it('populates alt-text from config', () => {
      const result = buildImageCarousel(testConfig);
      if (result.type === 'ImageCarousel') {
        expect(result.images[0]['alt-text']).toBe('Image A');
      }
    });

    it('returns fallback TextBody when no valid images', () => {
      const emptyConfig: CarouselConfig = { aspectRatio: '4:3', images: [] };
      const result = buildImageCarousel(emptyConfig);
      expect(result.type).toBe('TextBody');
    });

    it('uses configured aspect ratio', () => {
      const wideConfig: CarouselConfig = {
        aspectRatio: '16:9',
        images: [{ id: 'a', src: 'data:image/png;base64,AAAA', altText: 'A' }],
      };
      const result = buildImageCarousel(wideConfig);
      if (result.type === 'ImageCarousel') {
        expect(result['aspect-ratio']).toBe('16:9');
      }
    });
  });

  describe('estimateBase64Size()', () => {
    it('estimates size of a small base64 string', () => {
      // "AAAA" in base64 = 3 bytes
      const size = estimateBase64Size('AAAA');
      expect(size).toBe(3);
    });

    it('handles data URI format', () => {
      const size = estimateBase64Size('data:image/png;base64,AAAA');
      expect(size).toBe(3);
    });
  });

  describe('buildRoomCarousel()', () => {
    it('returns an ImageCarousel or fallback TextBody', () => {
      const result = buildRoomCarousel();
      expect(['ImageCarousel', 'TextBody']).toContain(result.type);
    });

    it('uses 4:3 aspect ratio for room photos', () => {
      const result = buildRoomCarousel();
      if (result.type === 'ImageCarousel') {
        expect(result['aspect-ratio']).toBe('4:3');
      }
    });
  });

  describe('buildMenuCarousel()', () => {
    it('returns an ImageCarousel or fallback TextBody', () => {
      const result = buildMenuCarousel();
      expect(['ImageCarousel', 'TextBody']).toContain(result.type);
    });

    it('uses 16:9 aspect ratio for menu photos', () => {
      const result = buildMenuCarousel();
      if (result.type === 'ImageCarousel') {
        expect(result['aspect-ratio']).toBe('16:9');
      }
    });
  });
});
