/**
 * Audio Transcription Stage (US-438)
 *
 * Transcribes incoming WhatsApp voice notes via Groq Whisper API.
 * Downloads audio buffer from Baileys, POSTs to Groq, returns transcript text.
 */
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import Groq from 'groq-sdk';
import { getGroqInstance, getProviders } from '../../ai-provider-manager.js';
import type { IncomingMessage } from '../../types.js';

/** Get or create a Groq instance for Whisper transcription */
function getWhisperGroqClient(): Groq | null {
  // Try existing groq instances first
  const providers = getProviders();
  for (const p of providers) {
    if (p.type === 'groq') {
      const instance = getGroqInstance(p.id);
      if (instance) return instance;
    }
  }
  // Fallback: create one from GROQ_API_KEY env var
  const key = process.env.GROQ_API_KEY?.trim();
  if (key) return new Groq({ apiKey: key });
  return null;
}

export interface TranscriptionResult {
  success: boolean;
  text?: string;
  latencyMs?: number;
  error?: string;
}

/**
 * Transcribe a voice note from a raw Baileys message.
 *
 * @param msg - IncomingMessage with rawMessage set (audio type)
 * @param model - Whisper model name (default: whisper-large-v3)
 * @param timeoutMs - Request timeout in ms (default: 15000)
 */
export async function transcribeVoiceNote(
  msg: IncomingMessage,
  model: string = 'whisper-large-v3',
  timeoutMs: number = 15000
): Promise<TranscriptionResult> {
  const start = Date.now();

  if (!msg.rawMessage) {
    return { success: false, error: 'No raw message available for media download' };
  }

  const groq = getWhisperGroqClient();
  if (!groq) {
    return { success: false, error: 'No Groq API key available for Whisper transcription' };
  }

  try {
    // Download audio buffer from Baileys
    const buffer = await downloadMediaMessage(
      msg.rawMessage,
      'buffer',
      {}
    ) as Buffer;

    if (!buffer || buffer.length === 0) {
      return { success: false, error: 'Empty audio buffer from Baileys' };
    }

    // Create a File object from the buffer for Groq SDK
    const audioFile = new File([buffer], 'voice.ogg', { type: 'audio/ogg' });

    // Call Groq Whisper API with timeout
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const transcription = await groq.audio.transcriptions.create(
        {
          file: audioFile,
          model,
          response_format: 'text',
        },
        { signal: controller.signal }
      );

      clearTimeout(timer);
      const latencyMs = Date.now() - start;

      // Groq returns the text directly when response_format is 'text'
      const text = (typeof transcription === 'string' ? transcription : (transcription as any).text || '').trim();

      if (!text) {
        return { success: false, latencyMs, error: 'Empty transcription result' };
      }

      console.log(`[VoiceTranscription] Transcribed ${buffer.length} bytes in ${latencyMs}ms: "${text.slice(0, 100)}"`);
      return { success: true, text, latencyMs };
    } finally {
      clearTimeout(timer);
    }
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    const errorMsg = err.name === 'AbortError'
      ? `Transcription timed out after ${timeoutMs}ms`
      : `Transcription failed: ${err.message}`;
    console.error(`[VoiceTranscription] ${errorMsg}`);
    return { success: false, latencyMs, error: errorMsg };
  }
}
