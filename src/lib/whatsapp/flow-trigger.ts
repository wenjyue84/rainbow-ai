/**
 * WhatsApp Flows Trigger Helper (US-909)
 *
 * Sends interactive Flow messages to users via Baileys.
 * The Flow message opens a native structured form in WhatsApp.
 *
 * Required env vars:
 *   WA_FLOWS_ID           — Flow ID from Meta Business Manager
 *   WA_FLOWS_ENDPOINT_URL — Public HTTPS URL for data-exchange endpoint
 */

import { sendWhatsAppInteractiveMessage } from './index.js';

export interface FlowTriggerOptions {
  phone: string;
  flowId?: string;
  flowToken?: string;
  headerText?: string;
  bodyText?: string;
  footerText?: string;
  ctaText?: string;
  instanceId?: string;
}

/**
 * Send a WhatsApp Flow interactive message to trigger the reservation form.
 */
export async function sendReservationFlow(options: FlowTriggerOptions): Promise<any> {
  const {
    phone,
    flowId = process.env.WA_FLOWS_ID,
    flowToken,
    headerText = 'Room Reservation',
    bodyText = 'Book your stay at Pelangi Capsule Hostel. Tap the button below to fill in your reservation details.',
    footerText = 'Powered by Rainbow AI',
    ctaText = 'Book Now',
    instanceId,
  } = options;

  if (!flowId) {
    throw new Error('WA_FLOWS_ID not configured — cannot send Flow message');
  }

  // Baileys interactive message format for WhatsApp Flows
  const interactiveContent = {
    interactiveMessage: {
      header: {
        title: headerText,
        hasMediaAttachment: false,
      },
      body: {
        text: bodyText,
      },
      footer: {
        text: footerText,
      },
      nativeFlowMessage: {
        buttons: [
          {
            name: 'flow',
            buttonParamsJson: JSON.stringify({
              flow_message_version: '3',
              flow_token: flowToken ?? `reserve_${Date.now()}`,
              flow_id: flowId,
              flow_cta: ctaText,
              flow_action: 'navigate',
              flow_action_payload: {
                screen: 'BOOKING_DETAILS',
                data: {
                  flow_token_payload: { phone },
                },
              },
            }),
          },
        ],
        messageParamsJson: '',
      },
    },
  };

  return sendWhatsAppInteractiveMessage(phone, interactiveContent, instanceId);
}
