/**
 * Tamil Grapheme Cluster Normalization
 *
 * Handles combining characters and script variants to improve keyword matching
 * accuracy for Tamil-language booking and inquiry intents.
 */

/**
 * Normalize Tamil text for consistent intent matching
 *
 * Process:
 * 1. Normalize to NFD (decomposed) to separate base characters from combining marks
 * 2. Remove floating diacriticals (combining marks without a base character)
 * 3. Normalize back to NFC (composed) for consistent comparison
 *
 * This ensures that classical ஸ்ரீ matches modern ஸ்ரீ and other variants.
 *
 * @param text - Input text (may contain Tamil characters)
 * @returns Normalized text with consistent Tamil character representation
 */
export function normalizeTamilInput(text: string): string {
  if (!text) return text;

  // Step 1: Normalize to NFD (decomposed form)
  // This separates base characters from combining marks
  let normalized = text.normalize('NFD');

  // Step 2: Remove floating diacriticals (combining marks without a base)
  // Tamil combining marks are in Unicode ranges:
  // - 0x0B3C–0x0B44: Vowel signs, virama
  // - 0x0B82, 0x0B83: Anusvara, visarga
  // These should not appear at the start or after another combining mark
  normalized = normalized.replace(/[\u0B82\u0B83\u0B3C-\u0B44]/g, (match, offset, str) => {
    // Keep the combining mark only if there's a valid base character before it
    // Valid base: not a combining mark itself and not at the beginning
    if (offset === 0) return ''; // Remove at start

    const prevChar = str[offset - 1];
    const prevCode = prevChar.charCodeAt(0);

    // Check if previous character is a combining mark (if so, this is floating)
    if (
      (prevCode >= 0x0B3C && prevCode <= 0x0B44) ||
      prevCode === 0x0B82 ||
      prevCode === 0x0B83
    ) {
      return ''; // Remove floating diacritical
    }

    return match; // Keep valid diacritical
  });

  // Step 3: Normalize back to NFC (composed form)
  // This ensures consistent comparison of normalized text
  normalized = normalized.normalize('NFC');

  return normalized;
}
