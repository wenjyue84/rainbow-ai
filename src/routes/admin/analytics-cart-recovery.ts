/**
 * analytics-cart-recovery.ts — Admin endpoint for cart recovery analytics
 *
 * US-917 AC6: Recovery rate (abandoned carts that convert to completed orders)
 * is tracked in analytics.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { getRecoveryAnalytics } from '../../assistant/cart-recovery.js';

const router = Router();

/**
 * GET /analytics/cart-recovery
 *
 * Returns:
 * - totalAbandoned: number of carts detected as abandoned
 * - recoverySent: number of recovery messages sent
 * - recovered: number of users who tapped "Resume Order"
 * - completed: number of recovered carts that became completed orders
 * - cleared: number of users who tapped "Clear Cart"
 * - recoveryRate: recovered / recoverySent
 * - conversionRate: completed / recovered
 *
 * Query params:
 * - days: number of days to look back (default: 30)
 */
router.get('/analytics/cart-recovery', async (req: Request, res: Response) => {
  const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 1), 365);
  const analytics = await getRecoveryAnalytics(days);
  res.json({ ...analytics, periodDays: days });
});

export default router;
