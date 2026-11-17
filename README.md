# Mercy Pay pour Next.js

Recevez les webhooks [Mercy Pay](https://mercy-pay.com) dans une route de l'App Router, signature vérifiée. Le paquet s'appuie sur [`@mercy-pay/node`](https://github.com/mercy-pay/mercy-pay-node), qu'il réexporte.

```sh
npm install @mercy-pay/next
```

Dans `.env.local` :

```dotenv
MERCY_PAY_API_KEY=mp_sandbox_...
MERCY_PAY_WEBHOOK_SECRET=whsec_...
```

## Encaisser un paiement

Créez la session côté serveur, dans une action serveur, puis redirigez :

```ts
// app/checkout/actions.ts
'use server';

import { MercyPay } from '@mercy-pay/next';
import { redirect } from 'next/navigation';

const mercyPay = new MercyPay(process.env.MERCY_PAY_API_KEY!);

export async function pay(orderId: string) {
  const order = await getOrder(orderId);
  const session = await mercyPay.checkoutSessions.create(
    {
      amount: order.total,
      currency: 'XAF',
      success_url: `${process.env.APP_URL}/commandes/${order.id}`,
      metadata: { order_id: order.id },
    },
    { idempotencyKey: `order-${order.id}` },
  );

  redirect(session.checkout_url);
}
```

Côté client, un simple formulaire suffit : `<form action={pay.bind(null, order.id)}><button>Payer</button></form>`. Pour un bouton avec état de chargement, voyez [`@mercy-pay/react`](https://github.com/mercy-pay/react).

## Afficher le formulaire dans votre page

Créez une session intégrée dans une action serveur, puis affichez-la avec [`@mercy-pay/react`](https://github.com/mercy-pay/react). Votre site doit être déclaré dans **Paramètres > Paiements** ; en sandbox, `localhost` marche tout de suite.

```ts
// app/checkout/actions.ts
'use server';

import { MercyPay } from '@mercy-pay/next';

const mercyPay = new MercyPay(process.env.MERCY_PAY_API_KEY!);

export async function startPayment(orderId: string): Promise<string> {
  const order = await getOrder(orderId);
  const session = await mercyPay.checkoutSessions.create(
    { amount: order.total, currency: 'XAF', ui_mode: 'embedded', metadata: { order_id: order.id } },
    { idempotencyKey: `order-${order.id}` },
  );

  return session.client_secret!;
}
```

```tsx
// app/checkout/[orderId]/payment.tsx
'use client';

import { EmbeddedCheckout } from '@mercy-pay/react';
import { useRouter } from 'next/navigation';

export function Payment({ clientSecret, orderId }: { clientSecret: string; orderId: string }) {
  const router = useRouter();

  return <EmbeddedCheckout clientSecret={clientSecret} onSuccess={() => router.push(`/commandes/${orderId}`)} />;
}
```

La page serveur appelle `startPayment(orderId)` et passe le secret à `<Payment>`. La commande se confirme toujours avec le webhook `payment.succeeded`, ci-dessous.

## Recevoir les webhooks

```ts
// app/api/webhooks/mercy-pay/route.ts
import { createWebhookHandler } from '@mercy-pay/next';

export const POST = createWebhookHandler({
  handlers: {
    'payment.succeeded': async (event) => {
      await markOrderPaid(event.data.metadata?.order_id);
    },
    'payout.failed': async (event) => {
      await alertTreasury(event.data.id);
    },
  },
});
```

- La signature est vérifiée sur le corps brut. Une mauvaise signature reçoit un `400`, et aucun handler n'est appelé.
- Si votre handler lève une erreur, la route répond `500` : Mercy Pay renverra l'événement plus tard.
- Un même événement peut arriver deux fois : servez-vous de `event.id`.
- `onEvent` est appelé pour chaque événement, avant le handler de son type.

Déclarez `https://votre-site/api/webhooks/mercy-pay` comme endpoint dans Développeurs > Webhooks.

## En local

```sh
mercypay listen --forward-to localhost:3000/api/webhooks/mercy-pay
mercypay trigger payment.succeeded
```

La [CLI](https://docs.mercy-pay.com/developers/cli) affiche son secret de signature au démarrage : mettez-le dans `MERCY_PAY_WEBHOOK_SECRET` en local.
