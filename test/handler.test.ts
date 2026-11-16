import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createWebhookHandler } from '../src/index.js';

const SECRET = 'whsec_test';

function signedRequest(payload: string, timestamp = Math.floor(Date.now() / 1000), secret = SECRET): Request {
  const signature = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return new Request('https://shop.test/api/webhooks/mercy-pay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'MercyPay-Signature': `t=${timestamp},v1=${signature}` },
    body: payload,
  });
}

const payload = JSON.stringify({ id: 'evt_1', object: 'event', type: 'payment.succeeded', data: { id: 'pay_1', metadata: { order_id: '4821' } } });

describe('createWebhookHandler', () => {
  it('calls the handler of the event type, then answers 200', async () => {
    const succeeded = vi.fn();
    const failed = vi.fn();
    const onEvent = vi.fn();
    const POST = createWebhookHandler({ secret: SECRET, onEvent, handlers: { 'payment.succeeded': succeeded, 'payment.failed': failed } });

    const response = await POST(signedRequest(payload));

    expect(response.status).toBe(200);
    expect(onEvent).toHaveBeenCalledOnce();
    expect(succeeded).toHaveBeenCalledWith(expect.objectContaining({ id: 'evt_1', data: expect.objectContaining({ metadata: { order_id: '4821' } }) }));
    expect(failed).not.toHaveBeenCalled();
  });

  it('refuses a bad or old signature without calling anything', async () => {
    const handler = vi.fn();
    const POST = createWebhookHandler({ secret: SECRET, onEvent: handler });

    expect((await POST(signedRequest(payload, undefined, 'whsec_other'))).status).toBe(400);
    expect((await POST(signedRequest(payload, Math.floor(Date.now() / 1000) - 600))).status).toBe(400);
    expect((await POST(new Request('https://shop.test', { method: 'POST', body: payload }))).status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });

  it('answers 500 when the handler fails, so the event comes again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const POST = createWebhookHandler({ secret: SECRET, handlers: { 'payment.succeeded': () => { throw new Error('base indisponible'); } } });

    expect((await POST(signedRequest(payload))).status).toBe(500);
  });

  it('reads the secret from MERCY_PAY_WEBHOOK_SECRET, and says when it is missing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('MERCY_PAY_WEBHOOK_SECRET', SECRET);
    expect((await createWebhookHandler()(signedRequest(payload))).status).toBe(200);

    vi.stubEnv('MERCY_PAY_WEBHOOK_SECRET', '');
    expect((await createWebhookHandler()(signedRequest(payload))).status).toBe(500);
    vi.unstubAllEnvs();
  });
});
