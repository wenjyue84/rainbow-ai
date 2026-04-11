/**
 * US-467: Error Handler with Incident Classification
 *
 * Express middleware that intercepts errors, classifies them using the incident classifier,
 * and routes them to appropriate remediation handlers with comprehensive logging.
 */

import { Request, Response, NextFunction } from 'express';
import {
  classifyAndRoute,
  IncidentClassification,
  HandlerResultStatus,
  getRoutingMetrics,
} from '../tools/incident-classifier.js';

// ─── Error Logging Record ──────────────────────────────────────────
export interface ErrorLogEntry {
  timestamp: string;
  error_id: string;
  error_message: string;
  error_stack?: string;
  error_category: string;
  category_confidence: number;
  affected_profile: string;
  handler_routed_to: string | null;
  handler_result_status: HandlerResultStatus | null;
  request_path?: string;
  request_method?: string;
  http_status?: number;
}

// ─── Configuration ──────────────────────────────────────────────────
interface ErrorHandlerConfig {
  logToConsole?: boolean;
  logToDB?: boolean;
  includeStackTrace?: boolean;
}

let errorHandlerConfig: ErrorHandlerConfig = {
  logToConsole: true,
  logToDB: false,
  includeStackTrace: true,
};

/**
 * Configure error handler behavior
 */
export function configureErrorHandler(config: Partial<ErrorHandlerConfig>): void {
  errorHandlerConfig = { ...errorHandlerConfig, ...config };
}

/**
 * Log an error entry to console and database if configured
 */
export async function logErrorEntry(logEntry: ErrorLogEntry): Promise<void> {
  if (errorHandlerConfig.logToConsole) {
    console.log(`[ErrorHandler] ${logEntry.error_category} error classified:`, {
      error_id: logEntry.error_id,
      message: logEntry.error_message.slice(0, 100),
      category: logEntry.error_category,
      confidence: logEntry.category_confidence,
      handler_routed_to: logEntry.handler_routed_to,
      handler_result_status: logEntry.handler_result_status,
    });
  }

  // TODO: Implement database logging when incident_classifications table is available
  if (errorHandlerConfig.logToDB) {
    // const db = getDB();
    // await db.insert(incidentClassifications).values({
    //   error_id: logEntry.error_id,
    //   error_message: logEntry.error_message,
    //   error_category: logEntry.error_category,
    //   category_confidence: logEntry.category_confidence,
    //   affected_profile: logEntry.affected_profile,
    //   handler_routed_to: logEntry.handler_routed_to,
    //   handler_result_status: logEntry.handler_result_status,
    //   classified_at: new Date(logEntry.timestamp),
    // });
  }
}

/**
 * Express error handling middleware
 *
 * This should be registered as the LAST middleware in the Express app chain.
 * It catches all errors from previous handlers and classifies them.
 *
 * Usage in index.ts:
 * ```
 * app.use(createErrorHandlerMiddleware());
 * ```
 */
export function createErrorHandlerMiddleware() {
  return async (err: any, req: Request, res: Response, next: NextFunction) => {
    try {
      // Extract error details
      const errorMessage = extractErrorMessage(err);
      const errorStack = err?.stack || '';
      const affectedProfile = (req as any)?.business_name || process.env.BUSINESS_NAME || 'pelangi';
      const errorId = `err_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

      // Classify and route the error
      const classification = await classifyAndRoute(
        errorMessage,
        affectedProfile,
        errorId,
        err,
        {
          request_path: req.path,
          request_method: req.method,
          query: req.query,
          params: req.params,
        }
      );

      // Create log entry
      const logEntry: ErrorLogEntry = {
        timestamp: new Date().toISOString(),
        error_id: classification.error_id,
        error_message: classification.error_message,
        error_stack: errorHandlerConfig.includeStackTrace ? errorStack : undefined,
        error_category: classification.error_category,
        category_confidence: classification.category_confidence,
        affected_profile: classification.affected_profile,
        handler_routed_to: classification.handler_routed_to,
        handler_result_status: classification.handler_result_status,
        request_path: req.path,
        request_method: req.method,
        http_status: res.statusCode || 500,
      };

      // Log the error entry
      await logErrorEntry(logEntry);

      // Respond to client with error details
      const statusCode = getHttpStatusCode(classification.error_category);
      res.status(statusCode).json({
        error: {
          id: classification.error_id,
          message: 'An error occurred processing your request',
          category: classification.error_category,
          support_context: {
            category_confidence: classification.category_confidence,
            handler_routed_to: classification.handler_routed_to,
          },
        },
      });
    } catch (innerErr: any) {
      console.error('[ErrorHandler] Fatal error in error handler:', innerErr.message);
      // Fallback response
      res.status(500).json({
        error: {
          message: 'An unexpected error occurred',
        },
      });
    }
  };
}

/**
 * Helper: Extract error message from various error types
 */
function extractErrorMessage(err: any): string {
  if (typeof err === 'string') {
    return err;
  }

  if (err instanceof Error) {
    return err.message;
  }

  if (typeof err === 'object' && err !== null) {
    if (typeof err.message === 'string') return err.message;
    if (typeof err.error === 'string') return err.error;
    if (typeof err.reason === 'string') return err.reason;
  }

  return 'Unknown error';
}

/**
 * Helper: Map error category to appropriate HTTP status code
 */
function getHttpStatusCode(category: string): number {
  switch (category) {
    case 'INTENT_MISCLASSIFICATION':
      return 400; // Bad Request — classification failed
    case 'CONTEXT_RETRIEVAL':
      return 502; // Bad Gateway — external retrieval failed
    case 'PROFILE_ISOLATION':
      return 403; // Forbidden — isolation violation
    case 'BOOKING_STEP':
      return 422; // Unprocessable Entity — workflow step failed
    case 'FALLBACK_TRIGGER':
      return 400; // Bad Request — no matching intent
    case 'OTHER':
    default:
      return 500; // Internal Server Error
  }
}

/**
 * Get current error handling metrics
 */
export function getErrorMetrics() {
  return getRoutingMetrics();
}
