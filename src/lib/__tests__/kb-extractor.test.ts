import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { extractToMarkdown, KBExtractorError } from '../kb-extractor.js';

describe('KB Extractor (US-537, US-541)', () => {
  let testDir: string;
  let testFilePath: string;

  beforeEach(() => {
    // Create a temporary test directory
    testDir = join(process.cwd(), '.test-kb-extractor');
    try {
      mkdirSync(testDir, { recursive: true });
    } catch {
      // Directory may already exist
    }
  });

  afterEach(() => {
    // Clean up test files
    try {
      if (testFilePath) {
        unlinkSync(testFilePath);
      }
      // Remove test directory
      try {
        unlinkSync(testDir);
      } catch {
        // May contain other files
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('extractToMarkdown', () => {
    it('should extract markdown from a plain text file', async () => {
      // Create a simple test fixture
      testFilePath = join(testDir, 'sample.txt');
      const testContent = 'Hello World\n\nThis is a test document.\n\nWith multiple paragraphs.';
      writeFileSync(testFilePath, testContent, 'utf-8');

      const result = await extractToMarkdown(testFilePath);

      // Verify output is non-empty string
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain('Hello');
    });

    it('should return clean markdown output', async () => {
      // Create test file with markdown-able content
      testFilePath = join(testDir, 'markdown-test.txt');
      const testContent = '# Heading\n\nSome content here.';
      writeFileSync(testFilePath, testContent, 'utf-8');

      const result = await extractToMarkdown(testFilePath);

      // Should be markdown (not empty)
      expect(result.trim().length).toBeGreaterThan(0);
    });

    it('should throw KBExtractorError for non-existent file', async () => {
      const nonExistentPath = join(testDir, 'does-not-exist.txt');

      await expect(extractToMarkdown(nonExistentPath)).rejects.toThrow(
        KBExtractorError
      );
    });

    it('should throw KBExtractorError with descriptive message for non-existent file', async () => {
      const nonExistentPath = join(testDir, 'does-not-exist.txt');

      try {
        await extractToMarkdown(nonExistentPath);
        expect.fail('Should have thrown KBExtractorError');
      } catch (err) {
        expect(err).toBeInstanceOf(KBExtractorError);
        expect((err as KBExtractorError).message).toContain('Failed to extract');
        expect((err as KBExtractorError).filePath).toBe(nonExistentPath);
      }
    });

    it('should support OCR option for images', async () => {
      // Create a simple text file (simulating an image extraction scenario)
      testFilePath = join(testDir, 'ocr-test.txt');
      const testContent = 'Text content that would come from OCR';
      writeFileSync(testFilePath, testContent, 'utf-8');

      // Call with OCR enabled
      const result = await extractToMarkdown(testFilePath, { ocr: true });

      // Should still extract successfully with OCR flag
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should throw for corrupted/empty files with clear error message', async () => {
      // Create an empty file
      testFilePath = join(testDir, 'empty.txt');
      writeFileSync(testFilePath, '', 'utf-8');

      await expect(extractToMarkdown(testFilePath)).rejects.toThrow(
        KBExtractorError
      );
    });

    it('should handle file paths with special characters', async () => {
      testFilePath = join(testDir, 'test-file_123.txt');
      const testContent = 'Content with special path.';
      writeFileSync(testFilePath, testContent, 'utf-8');

      const result = await extractToMarkdown(testFilePath);

      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });

    it('should log warning when extracted text is less than 50 characters without OCR', async () => {
      // Create a file with very short content (simulating scanned PDF with little text)
      testFilePath = join(testDir, 'short-content.txt');
      const shortContent = 'Hi'; // Only 2 characters
      writeFileSync(testFilePath, shortContent, 'utf-8');

      // Spy on console.warn
      const warnSpy = vi.spyOn(console, 'warn');

      // Extract without OCR (should trigger warning)
      const result = await extractToMarkdown(testFilePath, { ocr: false });

      // Verify warning was logged
      expect(warnSpy).toHaveBeenCalledWith(
        'Warning: extracted text is very short -- consider re-running with --ocr'
      );
      expect(result).toBeTruthy();

      warnSpy.mockRestore();
    });

    it('should not log warning when extracted text is less than 50 characters with OCR enabled', async () => {
      // Create a file with very short content
      testFilePath = join(testDir, 'short-content-ocr.txt');
      const shortContent = 'Hi'; // Only 2 characters
      writeFileSync(testFilePath, shortContent, 'utf-8');

      // Spy on console.warn
      const warnSpy = vi.spyOn(console, 'warn');

      // Extract WITH OCR (should NOT trigger warning)
      const result = await extractToMarkdown(testFilePath, { ocr: true });

      // Verify warning was NOT logged
      expect(warnSpy).not.toHaveBeenCalledWith(
        'Warning: extracted text is very short -- consider re-running with --ocr'
      );
      expect(result).toBeTruthy();

      warnSpy.mockRestore();
    });

    it('should not log warning when extracted text is 50+ characters without OCR', async () => {
      // Create a file with 50+ characters
      testFilePath = join(testDir, 'long-content.txt');
      const longContent = 'This is a longer piece of text that is definitely more than 50 characters long.';
      writeFileSync(testFilePath, longContent, 'utf-8');

      // Spy on console.warn
      const warnSpy = vi.spyOn(console, 'warn');

      // Extract without OCR (should NOT trigger warning because text is long)
      const result = await extractToMarkdown(testFilePath, { ocr: false });

      // Verify warning was NOT logged
      expect(warnSpy).not.toHaveBeenCalledWith(
        'Warning: extracted text is very short -- consider re-running with --ocr'
      );
      expect(result).toBeTruthy();

      warnSpy.mockRestore();
    });
  });

  describe('KBExtractorError', () => {
    it('should be an instance of Error', () => {
      const error = new KBExtractorError('Test error');
      expect(error).toBeInstanceOf(Error);
    });

    it('should have correct name property', () => {
      const error = new KBExtractorError('Test error');
      expect(error.name).toBe('KBExtractorError');
    });

    it('should store filePath in error', () => {
      const filePath = '/path/to/file.txt';
      const error = new KBExtractorError('Test error', filePath);
      expect(error.filePath).toBe(filePath);
    });

    it('should preserve message', () => {
      const message = 'Custom error message';
      const error = new KBExtractorError(message);
      expect(error.message).toBe(message);
    });
  });
});
