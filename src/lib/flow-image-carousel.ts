/**
 * US-932: WhatsApp Flows Image Carousel helper
 *
 * Builds ImageCarousel component data for WhatsApp Flows v7.1+.
 * Loads room/menu images from JSON config files and validates
 * base64 size constraints (<100KB per image).
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface CarouselImage {
  /** base64-encoded image data (data URI format: data:image/jpeg;base64,...) */
  src: string;
  /** Accessibility alt-text for the image */
  'alt-text': string;
}

export interface ImageCarouselComponent {
  type: 'ImageCarousel';
  'aspect-ratio': '4:3' | '16:9';
  images: CarouselImage[];
}

export interface ImageConfig {
  id: string;
  src: string;
  altText: string;
  label?: string;
}

export interface CarouselConfig {
  aspectRatio: '4:3' | '16:9';
  images: ImageConfig[];
}

const MAX_IMAGES_PER_CAROUSEL = 3;
const MAX_IMAGE_SIZE_BYTES = 100 * 1024; // 100KB

/**
 * Load image config from a JSON file.
 * Falls back to empty array if file not found.
 */
export function loadImageConfig(filename: string): CarouselConfig | null {
  const paths = [
    join(process.cwd(), 'src', 'assistant', 'data', filename),
    join(process.cwd(), 'dist', 'assistant', 'data', filename),
  ];

  for (const p of paths) {
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, 'utf-8'));
      } catch (err: any) {
        console.warn(`[ImageCarousel] Failed to parse ${filename}:`, err.message);
      }
    }
  }

  return null;
}

/**
 * Estimate the byte size of a base64-encoded image.
 * Accepts both raw base64 and data URI format.
 */
export function estimateBase64Size(src: string): number {
  const raw = src.includes(',') ? src.split(',')[1] : src;
  // Base64 encodes 3 bytes into 4 chars; account for padding
  const padding = (raw.match(/=+$/) || [''])[0].length;
  return Math.floor((raw.length * 3) / 4) - padding;
}

/**
 * Build an ImageCarousel component for WhatsApp Flows v7.1+.
 *
 * - Limits to 3 images per carousel (WhatsApp constraint)
 * - Validates each image is under 100KB
 * - Provides fallback text component if no valid images
 *
 * @returns The carousel component, or a TextBody fallback if no images available
 */
export function buildImageCarousel(
  config: CarouselConfig,
  filterIds?: string[],
): ImageCarouselComponent | { type: 'TextBody'; text: string } {
  let images = config.images;

  // Filter by IDs if specified (e.g., specific room types)
  if (filterIds && filterIds.length > 0) {
    images = images.filter(img => filterIds.includes(img.id));
  }

  // Limit to max 3 images
  images = images.slice(0, MAX_IMAGES_PER_CAROUSEL);

  // Validate sizes and build carousel images
  const validImages: CarouselImage[] = [];
  for (const img of images) {
    const size = estimateBase64Size(img.src);
    if (size > MAX_IMAGE_SIZE_BYTES) {
      console.warn(
        `[ImageCarousel] Image "${img.id}" is ${Math.round(size / 1024)}KB — exceeds 100KB limit, skipping`,
      );
      continue;
    }
    validImages.push({
      src: img.src,
      'alt-text': img.altText || img.label || img.id,
    });
  }

  // Fallback: if no valid images, return text description instead
  if (validImages.length === 0) {
    const descriptions = config.images
      .slice(0, 3)
      .map(img => `• ${img.label || img.id}: ${img.altText}`)
      .join('\n');
    return {
      type: 'TextBody',
      text: descriptions || 'Images are currently unavailable. Please ask our staff for photos.',
    };
  }

  return {
    type: 'ImageCarousel',
    'aspect-ratio': config.aspectRatio || '4:3',
    images: validImages,
  };
}

/**
 * Load room images and build a carousel for the reservation flow.
 */
export function buildRoomCarousel(roomTypeFilter?: string[]): ImageCarouselComponent | { type: 'TextBody'; text: string } {
  const config = loadImageConfig('room-images.json');
  if (!config) {
    return {
      type: 'TextBody',
      text: '• Mixed Dorm: Comfortable shared bunk beds with privacy curtains\n• Female Dorm: Ladies-only room with secure lockers\n• Private Room: En-suite bathroom with city view\n• Family Room: Spacious room for up to 4 guests',
    };
  }
  return buildImageCarousel(config, roomTypeFilter);
}

/**
 * Load menu images and build a carousel for the ordering flow.
 */
export function buildMenuCarousel(categoryFilter?: string[]): ImageCarouselComponent | { type: 'TextBody'; text: string } {
  const config = loadImageConfig('menu-images.json');
  if (!config) {
    return {
      type: 'TextBody',
      text: '• Nasi Lemak Special: Fragrant coconut rice with sambal, anchovies, and egg\n• Roti Canai Set: Flaky flatbread with dhal and curry\n• Teh Tarik: Creamy pulled milk tea',
    };
  }
  return buildImageCarousel(config, categoryFilter);
}
