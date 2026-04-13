/**
 * KB Extractor Module (US-537)
 *
 * Integrates kreuzberg to extract clean Markdown text from uploaded documents
 * (PDF, DOCX, XLSX, images). Forms the extraction layer for KB ingestion pipeline.
 *
 * Supports: PDF, DOCX, PNG/JPG (with OCR), plain text files
 */

import { spawn } from 'child_process';
import { resolve } from 'path';
import process from 'process';

/**
 * Custom error class for KB extraction failures
 */
export class KBExtractorError extends Error {
  constructor(message: string, public readonly filePath?: string) {
    super(message);
    this.name = 'KBExtractorError';
  }
}

/**
 * Options for document extraction
 */
export interface ExtractOptions {
  /** Enable OCR for image files */
  ocr?: boolean;
}

/**
 * Extract clean Markdown text from a document file using kreuzberg
 *
 * @param filePath - Absolute or relative path to the document
 * @param opts - Extraction options (e.g., { ocr: true })
 * @returns Promise resolving to extracted Markdown text
 * @throws KBExtractorError if file is unsupported, corrupted, or extraction fails
 *
 * Supported formats:
 * - PDF: Text and structure extraction with table preservation
 * - DOCX: Microsoft Word documents with formatting
 * - XLSX: Excel spreadsheets converted to markdown tables
 * - PNG/JPG: Images with optional OCR to extract text
 * - TXT: Plain text files
 */
export async function extractToMarkdown(
  filePath: string,
  opts?: ExtractOptions
): Promise<string> {
  const absolutePath = resolve(filePath);

  return new Promise((resolve, reject) => {
    // Build kreuzberg command arguments
    const args = [
      'extract',
      '--output-format',
      'markdown',
      absolutePath,
    ];

    // Add OCR flag if requested
    if (opts?.ocr) {
      args.push('--ocr', 'true');
    }

    // Spawn kreuzberg child process
    const child = spawn('kreuzberg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
      },
    });

    let stdout = '';
    let stderr = '';

    // Capture stdout (markdown output)
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    // Capture stderr (error messages)
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    // Handle process completion
    child.on('close', (code) => {
      if (code === 0) {
        // Success: return extracted markdown
        if (stdout.trim().length === 0) {
          reject(
            new KBExtractorError(
              `Document extraction returned empty content. File may be corrupted or unsupported: ${filePath}`,
              filePath
            )
          );
          return;
        }
        resolve(stdout);
      } else {
        // Failure: kreuzberg returned non-zero exit code
        const errorMsg = stderr.trim() || `kreuzberg exited with code ${code}`;
        reject(
          new KBExtractorError(
            `Failed to extract markdown from file: ${errorMsg}`,
            filePath
          )
        );
      }
    });

    // Handle process errors (e.g., kreuzberg not found)
    child.on('error', (err) => {
      reject(
        new KBExtractorError(
          `Failed to spawn kreuzberg: ${err.message}. Ensure kreuzberg is installed and in PATH.`,
          filePath
        )
      );
    });
  });
}
