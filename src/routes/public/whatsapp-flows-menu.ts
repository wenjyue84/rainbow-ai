/**
 * US-932: WhatsApp Flows Menu Ordering Endpoint (Makan Moments)
 *
 * Handles encrypted data-exchange requests from Meta for the menu ordering Flow.
 * Features Image Carousel (v7.1) for featured menu item visual browsing.
 *
 * Supports:
 *   - INIT action: returns menu items with image carousel
 *   - add_to_order: validates item/quantity and shows order summary
 *   - submit_order: places order and sends confirmation
 *   - PING health-check: responds with {data: {status: 'active'}}
 *
 * Encryption: RSA-OAEP + AES-128-GCM per Meta's WhatsApp Flows protocol.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import crypto from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { decryptRequest, encryptResponse } from '../../lib/whatsapp-flows-crypto.js';
import { sendWhatsAppMessage } from '../../lib/baileys-client.js';
import { recordFlowSuccess, recordFlowError } from '../../lib/whatsapp-flows-health.js';
import { buildMenuCarousel } from '../../lib/flow-image-carousel.js';

const router = Router();

// ─── Configuration ────────────────────────────────────────────────────
const FLOW_PRIVATE_KEY_PATH = process.env.WA_FLOWS_PRIVATE_KEY_PATH || '';
const FLOW_PRIVATE_KEY_PEM = process.env.WA_FLOWS_PRIVATE_KEY || '';
const FLOW_TOKEN = process.env.WA_FLOWS_MENU_TOKEN || process.env.WA_FLOWS_TOKEN || '';

let _privateKey: string | null = null;

function getPrivateKey(): string | null {
  if (_privateKey) return _privateKey;
  if (FLOW_PRIVATE_KEY_PEM) {
    _privateKey = FLOW_PRIVATE_KEY_PEM;
    return _privateKey;
  }
  if (FLOW_PRIVATE_KEY_PATH && existsSync(FLOW_PRIVATE_KEY_PATH)) {
    try {
      _privateKey = readFileSync(FLOW_PRIVATE_KEY_PATH, 'utf-8');
      return _privateKey;
    } catch (err: any) {
      console.error('[WhatsApp Flows Menu] Failed to read private key:', err.message);
    }
  }
  return null;
}

// ─── Menu Items ──────────────────────────────────────────────────────
const DEFAULT_MENU_ITEMS = [
  { id: 'nasi_lemak', title: 'Nasi Lemak Special (RM12)' },
  { id: 'roti_canai', title: 'Roti Canai Set (RM8)' },
  { id: 'teh_tarik', title: 'Teh Tarik (RM5)' },
  { id: 'mee_goreng', title: 'Mee Goreng Mamak (RM10)' },
  { id: 'kopi_o', title: 'Kopi O (RM4)' },
];

const PRICES: Record<string, number> = {
  nasi_lemak: 12,
  roti_canai: 8,
  teh_tarik: 5,
  mee_goreng: 10,
  kopi_o: 4,
};

// ─── In-memory order state per session ───────────────────────────────
// In production, this would be in Redis/DB. For Flows, the session is
// short-lived so in-memory is acceptable.
const orderSessions = new Map<string, Array<{ id: string; name: string; qty: number; price: number }>>();

// ─── Order Reference Generator ───────────────────────────────────────
function generateOrderRef(): string {
  const date = new Date();
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `MM-${yy}${mm}${dd}-${rand}`;
}

// ─── Action Types ────────────────────────────────────────────────────
interface FlowResponse {
  screen?: string;
  data?: Record<string, any>;
}

function handleInit(): FlowResponse {
  // US-932: Build menu image carousel for visual browsing
  const carousel = buildMenuCarousel();
  const isCarousel = carousel.type === 'ImageCarousel';

  return {
    screen: 'MENU_BROWSE',
    data: {
      menu_carousel: isCarousel ? carousel : { type: 'ImageCarousel', 'aspect-ratio': '16:9', images: [] },
      menu_carousel_fallback: isCarousel ? '' : (carousel as any).text || '',
      menu_items: DEFAULT_MENU_ITEMS,
      error_message: '',
    },
  };
}

function handleAddToOrder(payload: Record<string, any>, sessionKey: string): FlowResponse {
  const { selected_item, quantity } = payload;
  const qty = typeof quantity === 'string' ? parseInt(quantity, 10) : quantity;

  if (!selected_item) {
    const init = handleInit();
    init.data!.error_message = 'Please select a menu item.';
    return init;
  }

  if (isNaN(qty) || qty < 1) {
    const init = handleInit();
    init.data!.error_message = 'Please enter a valid quantity (at least 1).';
    return init;
  }

  if (qty > 10) {
    const init = handleInit();
    init.data!.error_message = 'Maximum 10 per item. For larger orders, please contact the cafe directly.';
    return init;
  }

  const itemDef = DEFAULT_MENU_ITEMS.find(m => m.id === selected_item);
  const price = PRICES[selected_item] || 0;

  if (!orderSessions.has(sessionKey)) {
    orderSessions.set(sessionKey, []);
  }
  const items = orderSessions.get(sessionKey)!;
  items.push({
    id: selected_item,
    name: itemDef?.title || selected_item,
    qty,
    price,
  });

  const summary = items.map(i => `${i.qty}x ${i.name}`).join('\n');
  const total = items.reduce((sum, i) => sum + i.qty * i.price, 0);

  return {
    screen: 'ORDER_DETAILS',
    data: {
      order_summary: summary,
      total: `RM${total.toFixed(2)}`,
      error_message: '',
    },
  };
}

function handleSubmitOrder(payload: Record<string, any>, sessionKey: string, senderPhone?: string): FlowResponse {
  const items = orderSessions.get(sessionKey) || [];
  if (items.length === 0) {
    return handleInit();
  }

  const orderRef = generateOrderRef();
  const summary = items.map(i => `${i.qty}x ${i.name}`).join('\n');
  const total = items.reduce((sum, i) => sum + i.qty * i.price, 0);
  const specialNotes = payload.special_notes || '';

  // Send WhatsApp confirmation (fire-and-forget)
  if (senderPhone) {
    const confirmMsg = [
      `*Order Placed* ✅`,
      ``,
      `Order #${orderRef}`,
      summary,
      ``,
      `Total: RM${total.toFixed(2)}`,
      specialNotes ? `Notes: ${specialNotes}` : '',
      ``,
      `Thank you for ordering from Makan Moments!`,
    ].filter(Boolean).join('\n');

    sendWhatsAppMessage(senderPhone, confirmMsg).catch(err =>
      console.error('[WhatsApp Flows Menu] Failed to send confirmation:', err.message)
    );
  }

  // Clean up session
  orderSessions.delete(sessionKey);

  return {
    screen: 'ORDER_CONFIRM',
    data: {
      order_ref: orderRef,
      summary: [
        summary,
        `Total: RM${total.toFixed(2)}`,
        specialNotes ? `Notes: ${specialNotes}` : '',
        '',
        'Your order has been received and is being prepared.',
      ].filter(Boolean).join('\n'),
    },
  };
}

// ─── Health Check Endpoint ───────────────────────────────────────────
router.get('/whatsapp-flows/menu-health', (_req: Request, res: Response) => {
  res.json({ data: { status: 'active' } });
});

// ─── Data Exchange Endpoint ──────────────────────────────────────────
router.post('/whatsapp-flows/menu-exchange', async (req: Request, res: Response) => {
  const startTime = Date.now();
  const privateKey = getPrivateKey();

  if (!privateKey && process.env.NODE_ENV === 'production') {
    console.error('[WhatsApp Flows Menu] No private key configured');
    recordFlowError('menu', 'CONFIG_ERROR', 'No private key configured', Date.now() - startTime);
    res.status(500).json({ error: 'Flow endpoint not configured' });
    return;
  }

  try {
    let action: string;
    let payload: Record<string, any>;
    let aesKeyBuffer: Buffer | null = null;
    let initialVectorBuffer: Buffer | null = null;
    let flowToken: string | undefined;

    if (req.body.encrypted_aes_key && privateKey) {
      const decrypted = decryptRequest(req.body, privateKey);
      action = decrypted.decryptedBody.action;
      payload = decrypted.decryptedBody;
      aesKeyBuffer = decrypted.aesKeyBuffer;
      initialVectorBuffer = decrypted.initialVectorBuffer;
      flowToken = decrypted.decryptedBody.flow_token;
    } else {
      action = req.body.action;
      payload = req.body;
      flowToken = req.body.flow_token;
    }

    if (FLOW_TOKEN && flowToken && flowToken !== FLOW_TOKEN) {
      console.warn('[WhatsApp Flows Menu] Invalid flow_token received');
      recordFlowError('menu', 'INVALID_TOKEN', 'Invalid flow_token', Date.now() - startTime);
      res.status(421).end();
      return;
    }

    if (action === 'ping' || action === 'PING') {
      const pingResponse = { data: { status: 'active' } };
      recordFlowSuccess('menu', Date.now() - startTime, 'ping');
      if (aesKeyBuffer && initialVectorBuffer) {
        res.send(encryptResponse(pingResponse, aesKeyBuffer, initialVectorBuffer));
      } else {
        res.json(pingResponse);
      }
      return;
    }

    console.log(`[WhatsApp Flows Menu] Processing action: ${action}`);

    // Session key from sender phone or a fallback
    const sessionKey = payload.sender_phone || payload.flow_token || 'default_session';

    let flowResponse: FlowResponse;

    switch (action) {
      case 'INIT':
        flowResponse = handleInit();
        break;
      case 'add_to_order':
        flowResponse = handleAddToOrder(payload, sessionKey);
        break;
      case 'submit_order':
        flowResponse = handleSubmitOrder(payload, sessionKey, payload.sender_phone);
        break;
      default:
        console.warn(`[WhatsApp Flows Menu] Unknown action: ${action}`);
        flowResponse = handleInit();
    }

    recordFlowSuccess('menu', Date.now() - startTime, action);

    if (aesKeyBuffer && initialVectorBuffer) {
      res.send(encryptResponse(flowResponse, aesKeyBuffer, initialVectorBuffer));
    } else {
      res.json(flowResponse);
    }
  } catch (err: any) {
    recordFlowError('menu', 'ENDPOINT_ERROR', err.message, Date.now() - startTime);
    console.error('[WhatsApp Flows Menu] Data exchange error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Flow JSON Definition Endpoint ───────────────────────────────────
router.get('/whatsapp-flows/menu-flow.json', (_req: Request, res: Response) => {
  try {
    const flowPath = join(process.cwd(), 'src', 'assistant', 'data', 'menu-flow.json');
    if (existsSync(flowPath)) {
      const flowJson = JSON.parse(readFileSync(flowPath, 'utf-8'));
      res.json(flowJson);
    } else {
      const distPath = join(process.cwd(), 'dist', 'assistant', 'data', 'menu-flow.json');
      if (existsSync(distPath)) {
        const flowJson = JSON.parse(readFileSync(distPath, 'utf-8'));
        res.json(flowJson);
      } else {
        res.status(404).json({ error: 'Menu flow definition not found' });
      }
    }
  } catch (err: any) {
    console.error('[WhatsApp Flows Menu] Error serving flow JSON:', err.message);
    res.status(500).json({ error: 'Failed to load flow definition' });
  }
});

export default router;
