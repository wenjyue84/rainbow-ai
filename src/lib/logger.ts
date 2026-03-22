import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';

const logDir = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
const logLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

// Console format: [14:23:45] [Router] Message {metadata}
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, module, ...meta }) => {
    const mod = module ? `[${module}]` : '';
    const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    return `[${timestamp}] ${mod} ${message}${metaStr}`;
  }),
  winston.format.colorize({ all: true })
);

// File format: {"timestamp":"2026-02-14T14:23:45Z","level":"info","module":"Router",...}
const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Emergency bypass if Winston causes production issues
if (process.env.DISABLE_WINSTON === 'true') {
  const consoleLogger = console as any;
  consoleLogger.child = () => consoleLogger;
  module.exports = { createModuleLogger: () => consoleLogger };
}

const transports: winston.transport[] = [
  new winston.transports.Console({ format: consoleFormat })
];

// Only add file transports if not in test mode
if (process.env.NODE_ENV !== 'test') {
  transports.push(
    new DailyRotateFile({
      filename: path.join(logDir, 'rainbow-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
      format: fileFormat,
      zippedArchive: true
    }),
    new DailyRotateFile({
      filename: path.join(logDir, 'rainbow-error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'warn',
      maxFiles: '30d',
      format: fileFormat,
      zippedArchive: true
    })
  );
}

const rootLogger = winston.createLogger({ level: logLevel, transports });

export function createModuleLogger(module: string): winston.Logger {
  return rootLogger.child({ module });
}

/**
 * Log a conversation interaction to the audit trail table for PDPA compliance.
 * Insert-only; immutable.
 */
export async function auditLog(data: {
  phone: string;
  guestId?: string;
  message: string;
  intent?: string;
  confidence?: number;
  actionTaken?: string;
  tier?: string;
  profileId?: string;
}): Promise<void> {
  try {
    // Dynamic import to avoid circular dependencies
    const { db } = await import('./db.js');
    const { conversationAudit } = await import('../../shared/schema-tables.js');

    await db.insert(conversationAudit).values({
      phone: data.phone,
      guestId: data.guestId,
      message: data.message,
      intent: data.intent,
      confidence: data.confidence,
      actionTaken: data.actionTaken,
      tier: data.tier,
      profileId: data.profileId || 'pelangi',
      timestamp: new Date(),
    });
  } catch (err) {
    // Log to standard logger but don't throw — audit failure should not crash the conversation
    rootLogger.error('Audit log failed', { error: err instanceof Error ? err.message : String(err) });
  }
}
