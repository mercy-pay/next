import { MercyPay, SignatureVerificationError, type Event } from '@mercy-pay/node';

export type WebhookHandler = (event: Event) => unknown | Promise<unknown>;

export interface WebhookHandlerOptions {
  /** The endpoint's secret (whsec_…). MERCY_PAY_WEBHOOK_SECRET by default. */
  secret?: string;
  /** One function per event type: { 'payment.succeeded': async (event) => … }. */
  handlers?: Partial<Record<string, WebhookHandler>>;
  /** Called for every verified event, before the type's handler. */
  onEvent?: WebhookHandler;
  /** Seconds a signature stays valid. 300 by default. */
  tolerance?: number;
}

/**
 * A route handler for the App Router. It checks the MercyPay-Signature header against the
 * raw body, calls your handler, then answers 200. A bad signature gets a 400, an error thrown
 * by your handler a 500, so Mercy Pay sends the event again later.
 *
 * ```ts
 * // app/api/webhooks/mercy-pay/route.ts
 * export const POST = createWebhookHandler({
 *   handlers: { 'payment.succeeded': async (event) => markOrderPaid(event.data.metadata?.order_id) },
 * });
 * ```
 */
export function createWebhookHandler(options: WebhookHandlerOptions = {}): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const secret = options.secret ?? process.env.MERCY_PAY_WEBHOOK_SECRET;
    if (!secret) {
      console.error('Mercy Pay : webhook refusé, MERCY_PAY_WEBHOOK_SECRET est vide.');
      return Response.json({ error: 'Secret de webhook non configuré.' }, { status: 500 });
    }

    const payload = await request.text();
    let event: Event;
    try {
      event = await MercyPay.webhooks.constructEvent(payload, request.headers.get('MercyPay-Signature'), secret, { tolerance: options.tolerance });
    } catch (error) {
      if (error instanceof SignatureVerificationError) {
        return Response.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    try {
      await options.onEvent?.(event);
      await options.handlers?.[event.type]?.(event);
    } catch (error) {
      console.error(`Mercy Pay : le traitement de ${event.type} (${event.id}) a échoué.`, error);
      return Response.json({ error: 'Traitement échoué, Mercy Pay renverra cet événement.' }, { status: 500 });
    }

    return Response.json({ received: true });
  };
}

export { MercyPay } from '@mercy-pay/node';
export type { Event } from '@mercy-pay/node';
