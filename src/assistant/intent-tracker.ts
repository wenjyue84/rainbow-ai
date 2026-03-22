import { eq, desc } from 'drizzle-orm';
import { db } from '../lib/db.js';
import { intentPredictions, type InsertIntentPrediction } from '../../shared/schema-tables.js';

// Batch queue configuration
const BATCH_SIZE = 50;
const FLUSH_INTERVAL_MS = 5000;
const MAX_RETRIES = 3;

// Queue state
let queue: InsertIntentPrediction[] = [];
let retryMap = new Map<string, number>();
let flushTimer: NodeJS.Timeout | null = null;

/**
 * Flush queued predictions to the database in a single bulk insert
 * Retries failed items up to MAX_RETRIES times before dropping with warning
 */
async function flush(): Promise<void> {
  if (queue.length === 0) return;

  const itemsToFlush = [...queue];
  queue = [];

  try {
    await db.insert(intentPredictions).values(itemsToFlush);
    console.log(`[Intent Tracker] 📦 Flushed ${itemsToFlush.length} predictions to DB`);

    // Clear retry map for successfully flushed items
    itemsToFlush.forEach((item) => {
      const key = `${item.conversationId}-${item.messageText}`;
      retryMap.delete(key);
    });
  } catch (error) {
    console.error('[Intent Tracker] ❌ Batch flush failed:', error);

    // Re-queue items with retry logic
    itemsToFlush.forEach((item) => {
      const key = `${item.conversationId}-${item.messageText}`;
      const retryCount = (retryMap.get(key) || 0) + 1;

      if (retryCount <= MAX_RETRIES) {
        retryMap.set(key, retryCount);
        queue.push(item);
        console.log(`[Intent Tracker] 🔄 Requeueing prediction (retry ${retryCount}/${MAX_RETRIES})`);
      } else {
        console.warn(`[Intent Tracker] ⚠️ Dropped prediction after ${MAX_RETRIES} retries: ${item.conversationId}`);
        retryMap.delete(key);
      }
    });
  }
}

/**
 * Initialize the batch queue with timer and process exit handlers
 * Must be called once during app startup
 */
export function initializeQueue(): void {
  // Set up periodic flush every 5 seconds
  flushTimer = setInterval(async () => {
    await flush();
  }, FLUSH_INTERVAL_MS);

  // Flush remaining items on process termination
  const handleExit = async () => {
    if (flushTimer !== null) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
    if (queue.length > 0) {
      console.log(`[Intent Tracker] 📤 Graceful shutdown: flushing ${queue.length} remaining items`);
      await flush();
    }
  };

  process.on('SIGTERM', handleExit);
  process.on('SIGINT', handleExit);

  console.log('[Intent Tracker] ✅ Batch queue initialized');
}

/**
 * Track an intent prediction made by the bot
 * Queues the prediction for batch insertion instead of inserting immediately
 * Callers are unaffected - API signature unchanged
 */
export async function trackIntentPrediction(
  conversationId: string,
  phoneNumber: string,
  messageText: string,
  predictedIntent: string,
  confidence: number,
  tier: string,
  model?: string
): Promise<void> {
  try {
    const prediction: InsertIntentPrediction = {
      conversationId,
      phoneNumber,
      messageText,
      predictedIntent,
      confidence,
      tier,
      model: model || null,
      actualIntent: null,
      wasCorrect: null,
      correctionSource: null,
      correctedAt: null,
    };

    queue.push(prediction);
    console.log(`[Intent Tracker] 📊 Queued prediction: ${predictedIntent} (confidence: ${confidence.toFixed(2)}, tier: ${tier}, queue size: ${queue.length})`);

    // Flush if queue reaches batch size
    if (queue.length >= BATCH_SIZE) {
      await flush();
    }
  } catch (error) {
    console.error('[Intent Tracker] ❌ Failed to queue prediction:', error);
    // Non-fatal — don't crash the router
  }
}

/**
 * Mark an intent prediction as incorrect and log the actual intent
 * Called when user gives negative feedback or when staff corrects the intent
 */
export async function markIntentCorrection(
  conversationId: string,
  actualIntent: string,
  correctionSource: 'feedback' | 'escalation' | 'manual'
): Promise<void> {
  try {
    // Find the most recent prediction for this conversation
    const prediction = await db
      .select()
      .from(intentPredictions)
      .where(eq(intentPredictions.conversationId, conversationId))
      .orderBy(desc(intentPredictions.createdAt))
      .limit(1);

    if (prediction.length === 0) {
      console.warn(`[Intent Tracker] ⚠️ No prediction found for conversation ${conversationId}`);
      return;
    }

    const row = prediction[0];
    const predictionId = row.id;
    const wasCorrect = row.predictedIntent === actualIntent;

    await db
      .update(intentPredictions)
      .set({
        actualIntent,
        wasCorrect,
        correctionSource,
        correctedAt: new Date(),
      })
      .where(eq(intentPredictions.id, predictionId));

    console.log(
      `[Intent Tracker] ${wasCorrect ? '✅' : '❌'} Correction: ` +
      `predicted '${row.predictedIntent}' → actual '${actualIntent}' ` +
      `(source: ${correctionSource})`
    );
  } catch (error) {
    console.error('[Intent Tracker] ❌ Failed to mark correction:', error);
  }
}

/**
 * Mark the most recent intent prediction as correct (e.g. when user gives thumbs up).
 * Used so Intent Accuracy on the dashboard can include positive feedback.
 */
export async function markIntentCorrect(conversationId: string): Promise<void> {
  try {
    const prediction = await db
      .select()
      .from(intentPredictions)
      .where(eq(intentPredictions.conversationId, conversationId))
      .orderBy(desc(intentPredictions.createdAt))
      .limit(1);

    if (prediction.length === 0) return;

    const row = prediction[0];
    await db
      .update(intentPredictions)
      .set({
        actualIntent: row.predictedIntent,
        wasCorrect: true,
        correctionSource: 'feedback',
        correctedAt: new Date(),
      })
      .where(eq(intentPredictions.id, row.id));

    console.log(`[Intent Tracker] ✅ Marked correct: ${row.predictedIntent} (feedback)`);
  } catch (error) {
    console.error('[Intent Tracker] ❌ Failed to mark correct:', error);
  }
}
