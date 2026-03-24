/**
 * cart-handlers-order.ts — Order flow handlers
 *
 * Handles: order_request_confirmation, order_confirm_submit, order_back_to_cart,
 *          cart_cancel_order, order_check_status
 */

import type { MCPToolResult } from '../types/mcp.js';
import {
  cartGetItems, cartClear, cartFormatSummary,
  cartGetTableInfo,
} from '../assistant/cart-store.js';
import { transitionOrderStage, clearOrderStage, getOrderStage } from '../assistant/order-stage-store.js';
import { fnbCreateOrder, fnbGetOrderStatus, fnbGetKitchenStatus } from './fnb-orders.js';
import { setSessionOrderId, getSessionOrderId } from '../assistant/order-id-store.js';
import { sendToKds, buildKdsPayload, type KdsWebhookResult } from '../lib/kds-webhook.js';
import { startModificationWindow } from '../assistant/order-modification-store.js';
import { saveOrderHistory } from '../assistant/order-history-store.js';
import {
  markConfirmationShown, recordOrderSubmitted, clearAccuracyTracking,
  recordKdsSent,
} from '../assistant/order-accuracy-tracker.js';
import { clearPendingSetMeal } from '../assistant/set-meal-store.js';

type HandlerMap = Map<string, (args: any) => Promise<MCPToolResult>>;

export interface CartOrderContext {
  paymentMethods: string[];
  queueThreshold: number;
  waitThreshold: number;
  kdsEnabled: boolean;
  kdsOpsPhone: string;
  kdsProfileId: string;
  modificationWindowMs: number;
}

function formatPaymentGuidance(methods: string[]): string {
  if (!methods || methods.length === 0) return '';
  const labels: Record<string, string> = {
    cash: 'cash',
    qr: 'QR code at the counter',
    card: 'card',
    online: 'online payment',
  };
  const readable = methods.map(m => labels[m.toLowerCase()] || m);
  if (readable.length === 1) return `\n\nYou can pay by ${readable[0]} when ready.`;
  const last = readable.pop();
  return `\n\nYou can pay by ${readable.join(', ')} or ${last} when ready.`;
}

async function getKitchenWarning(queueThreshold: number, waitThreshold: number): Promise<string> {
  try {
    const result = await fnbGetKitchenStatus();
    if (result.isError) return '';
    const text = result.content.map((c: any) => c.text || '').join('\n').trim();
    if (!text) return '';
    const pendingMatch = text.match(/pending[:\s]*(\d+)/i) || text.match(/queue[:\s]*(\d+)/i) || text.match(/orders?[:\s]*(\d+)/i);
    const pendingCount = pendingMatch ? parseInt(pendingMatch[1], 10) : 0;
    const waitMatch = text.match(/(?:estimated?|wait|eta)[:\s]*(\d+)\s*(?:min|minute)/i);
    const waitMinutes = waitMatch ? parseInt(waitMatch[1], 10) : 0;
    if (pendingCount > queueThreshold || waitMinutes > waitThreshold) {
      const waitStr = waitMinutes > 0 ? `about ${waitMinutes} minutes` : `about ${Math.max(waitThreshold, 25)} minutes`;
      return `\n\n⚠️ Note: Kitchen is currently busy. Estimated wait is ${waitStr}.`;
    }
  } catch { /* non-blocking */ }
  return '';
}

export function registerOrderHandlers(
  handlers: HandlerMap,
  sessionId: string,
  profileId: string,
  ctx: CartOrderContext,
): void {
  const { paymentMethods, queueThreshold, waitThreshold, kdsEnabled, kdsOpsPhone, kdsProfileId, modificationWindowMs } = ctx;

  handlers.set('order_request_confirmation', async (_args: any) => {
    const items = cartGetItems(profileId, sessionId);
    if (items.length === 0) {
      return { content: [{ type: 'text', text: 'The cart is empty. Please add items before placing an order.' }] };
    }
    transitionOrderStage(profileId, sessionId, 'CONFIRMING');
    markConfirmationShown(sessionId);
    const summary = cartFormatSummary(items);
    const tableInfo = cartGetTableInfo(profileId, sessionId);
    const tableLine = tableInfo
      ? tableInfo.orderType === 'takeaway' ? '\nOrder type: Takeaway'
        : tableInfo.tableNumber ? `\nTable: ${tableInfo.tableNumber}` : '\nOrder type: Dine-in'
      : '';
    const kitchenWarning = await getKitchenWarning(queueThreshold, waitThreshold);
    return {
      content: [{
        type: 'text',
        text: `Here is your order summary:\n\n${summary}${tableLine}${kitchenWarning}\n\nShall I place this order? Reply YES to confirm or tell me what to change.`
      }]
    };
  });

  handlers.set('order_confirm_submit', async (args: any) => {
    const items = cartGetItems(profileId, sessionId);
    if (items.length === 0) {
      return { content: [{ type: 'text', text: 'The cart is empty. Nothing to submit.' }] };
    }
    const summary = cartFormatSummary(items);
    const storedTable = cartGetTableInfo(profileId, sessionId);
    const effectiveTableNumber = args.tableNumber || storedTable?.tableNumber;
    const effectiveOrderType = storedTable?.orderType || (args.tableNumber ? 'dine-in' : undefined);
    let tableDesc = '';
    if (effectiveOrderType === 'takeaway') tableDesc = ' (Takeaway)';
    else if (effectiveTableNumber) tableDesc = ` for table ${effectiveTableNumber}`;

    const codedItems = items.filter(i => i.code).map(i => ({
      code: i.code as string, qty: i.qty, ...(i.notes ? { notes: i.notes } : {})
    }));
    let orderAck = '';
    let placedOrderId = `ORD-${Date.now()}`;
    const fnbNotes: string[] = [];
    if (effectiveTableNumber) fnbNotes.push(`Table: ${effectiveTableNumber}`);
    if (effectiveOrderType) fnbNotes.push(`Type: ${effectiveOrderType}`);

    if (codedItems.length > 0) {
      const fnbResult = await fnbCreateOrder({
        items: codedItems,
        phone: `webchat-${profileId}-${sessionId}`,
        estimated_arrival: new Date().toISOString(),
        ...(fnbNotes.length > 0 ? { notes: fnbNotes.join(', ') } : {}),
        ...(effectiveTableNumber ? { tableNumber: effectiveTableNumber } : {}),
        ...(effectiveOrderType ? { orderType: effectiveOrderType } : {}),
      });
      if (!fnbResult.isError) {
        const fnbText = fnbResult.content.map((c: any) => c.text || '').join('\n').trim();
        orderAck = fnbText ? `\n\n${fnbText}` : '\n\nEstimated wait time: 15–20 minutes.';
        const orderIdMatch = fnbText.match(/\b(MM-[A-Z0-9]{4,})\b/i) || fnbText.match(/order\s*(?:id|#|number)?[:\s]*([A-Za-z0-9-]{4,})/i);
        const extractedOrderId = orderIdMatch ? (orderIdMatch[1] || orderIdMatch[0]) : placedOrderId;
        placedOrderId = extractedOrderId;
        if (orderIdMatch) setSessionOrderId(profileId, sessionId, extractedOrderId);
        if (kdsEnabled) {
          const kdsPayload = buildKdsPayload({
            orderId: extractedOrderId,
            items: items.map(i => ({ name: i.name, code: i.code, qty: i.qty, notes: i.notes })),
            tableNumber: effectiveTableNumber,
            orderType: effectiveOrderType,
            jid: `webchat-${profileId}-${sessionId}`,
            profileId: kdsProfileId,
          });
          sendToKds(kdsPayload, kdsOpsPhone).then((kdsResult: KdsWebhookResult) => {
            if (kdsResult.success) {
              recordKdsSent(sessionId, kdsProfileId, extractedOrderId).catch(() => {});
            } else if (kdsResult.posStatus === 'rejected' && kdsResult.posMessage) {
              console.warn(`[KDS] Order ${extractedOrderId} rejected by POS: ${kdsResult.posMessage}`);
            }
          }).catch(() => {});
        }
      } else {
        orderAck = '\n\nOur staff has been notified and will prepare your order shortly.';
      }
    } else {
      orderAck = '\n\nOur staff has been notified and will prepare your order shortly.';
    }

    const snapshotItems = items.map(i => ({ ...i }));
    const snapshotTable = storedTable ? { ...storedTable } : undefined;
    saveOrderHistory(`webchat-${profileId}-${sessionId}`, placedOrderId, snapshotItems).catch(err => {
      console.error('[OrderHistory] Save failed:', err.message);
    });
    recordOrderSubmitted(sessionId, kdsProfileId || 'makan-moments').catch(err => {
      console.error('[OrderAccuracy] Record failed:', err.message);
    });
    transitionOrderStage(profileId, sessionId, 'PLACED');
    cartClear(profileId, sessionId);
    clearOrderStage(profileId, sessionId);
    if (modificationWindowMs > 0) {
      startModificationWindow(sessionId, placedOrderId, snapshotItems, snapshotTable, modificationWindowMs);
    }
    const paymentGuidance = formatPaymentGuidance(paymentMethods);
    const kitchenWarning = await getKitchenWarning(queueThreshold, waitThreshold);
    const modWindowMinutes = Math.round(modificationWindowMs / 60000);
    const modNotice = modificationWindowMs > 0
      ? `\n\nYou have ${modWindowMinutes} minute${modWindowMinutes !== 1 ? 's' : ''} to request changes. Just say "change order" if you need to modify anything.`
      : '';
    return {
      content: [{
        type: 'text',
        text: `Your order${tableDesc} has been sent to the kitchen!\n\n${summary}${orderAck}${kitchenWarning}${paymentGuidance}${modNotice}\n\nThank you! Please let us know if you need anything else.`
      }]
    };
  });

  handlers.set('order_back_to_cart', async (_args: any) => {
    transitionOrderStage(profileId, sessionId, 'ORDERING');
    const items = cartGetItems(profileId, sessionId);
    const summary = cartFormatSummary(items);
    return {
      content: [{
        type: 'text',
        text: `No problem! Your cart still has:\n\n${summary}\n\nFeel free to add or remove items, or let me know when you're ready to order.`
      }]
    };
  });

  handlers.set('cart_cancel_order', async (_args: any) => {
    const stage = getOrderStage(profileId, sessionId);
    if (stage === 'PLACED') {
      return {
        content: [{
          type: 'text',
          text: 'Your order has already been sent to the kitchen and cannot be cancelled here. Please speak to our staff directly and they will assist you.'
        }]
      };
    }
    const items = cartGetItems(profileId, sessionId);
    if (items.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'There is nothing to cancel — your cart is already empty. Let me know if you would like to order something!'
        }]
      };
    }
    cartClear(profileId, sessionId);
    clearPendingSetMeal(sessionId);
    clearOrderStage(profileId, sessionId);
    clearAccuracyTracking(sessionId);
    return {
      content: [{ type: 'text', text: 'Your order has been cleared. Let me know if you would like to start a new order!' }]
    };
  });

  handlers.set('order_check_status', async (args: any) => {
    const orderId = (args.orderId && String(args.orderId).trim()) || getSessionOrderId(profileId, sessionId);
    if (!orderId) {
      return {
        content: [{ type: 'text', text: 'There is no active order for you yet. Place an order first and then you can check its status!' }]
      };
    }
    const result = await fnbGetOrderStatus({ orderId });
    if (result.isError) {
      return {
        content: [{
          type: 'text',
          text: `I wasn't able to check the status of order ${orderId} right now. Please try again in a moment or ask our staff for an update.`
        }]
      };
    }
    const statusMap: Record<string, string> = {
      'pending':    'Received — your order has been received and is waiting to be prepared.',
      'received':   'Received — your order has been received and is waiting to be prepared.',
      'confirmed':  'Received — your order has been confirmed and will be prepared shortly.',
      'approved':   'Received — your order has been approved and will be prepared shortly.',
      'preparing':  'Preparing — the kitchen is working on your order right now!',
      'cooking':    'Preparing — the kitchen is working on your order right now!',
      'in_progress':'Preparing — the kitchen is working on your order right now!',
      'ready':      'Ready — your order is ready for pickup/serving!',
      'completed':  'Served — your order has been completed. Enjoy your meal!',
      'served':     'Served — your order has been completed. Enjoy your meal!',
      'cancelled':  'Cancelled — this order has been cancelled.',
    };
    const rawText = result.content.map((c: any) => c.text || '').join('\n').trim();
    const statusMatch = rawText.match(/status[:\s]*["']?(\w+)["']?/i);
    const rawStatus = statusMatch?.[1]?.toLowerCase();
    const friendlyStatus = rawStatus ? statusMap[rawStatus] : null;
    const waitMatch = rawText.match(/(?:estimated?|wait|eta|time)[:\s]*(\d+[\s-]*\d*\s*(?:min(?:ute)?s?|hours?))/i);
    const waitTime = waitMatch ? `\nEstimated wait: ${waitMatch[1]}` : '';
    if (friendlyStatus) {
      return { content: [{ type: 'text', text: `Order ${orderId}: ${friendlyStatus}${waitTime}` }] };
    }
    return { content: [{ type: 'text', text: `Order ${orderId} status:\n${rawText}${waitTime}` }] };
  });
}
