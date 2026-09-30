# linepay-v4

Zero-dependency TypeScript SDK for the [LINE Pay Online API v4](https://developers-pay.line.me/online-api-v4) (Taiwan, Thailand). Unofficial — not affiliated with LINE Corporation.

It gets the parts right that break real integrations:

- **Lossless transaction IDs.** LINE Pay sends `transactionId` as a bare 19-digit JSON number. `JSON.parse` rounds it (`2023042201206549310` → `2023042201206549200`), and your confirm or refund then fails — or hits the wrong transaction. This SDK never lets those IDs become JS numbers: they are `string`s in and out.
- **Correct signing.** `X-LINE-Authorization` is computed over the exact body bytes that are sent (or the query string for GET), with a fresh nonce per call — no more mysterious `1106`.
- **Unknown outcomes are not failures.** A timeout on `confirm`, `capture` or `refund` may still have moved money. Those throw `LinePayUnknownOutcomeError` with `movesMoney: true`, so you reconcile instead of retrying blindly.
- **Actionable errors.** Every `returnCode` comes with a category — `retry`, `reconcile`, `customer` or `merchant` — so you know what to do with it.
- **Checks before sending.** Amounts that don't add up across packages and products (LINE Pay's `1124`) are caught locally with a readable message.
- Node 20+, ESM and CommonJS, full types, per-API read timeouts from the reference.

```sh
npm install linepay-v4
```

## Usage

```ts
import { LinePay, LinePayApiError, LinePayUnknownOutcomeError, readRedirectParams } from "linepay-v4";

const linePay = new LinePay({
  channelId: process.env.LINE_PAY_CHANNEL_ID!,
  channelSecret: process.env.LINE_PAY_CHANNEL_SECRET!, // server only — never ship it to a browser
  env: "sandbox", // or "production"
});
```

### 1. Request a payment

```ts
const { transactionId, paymentUrl } = await linePay.requestPayment({
  amount: 280,
  currency: "TWD",
  orderId: `${order.no}-${attempt}`, // unique per attempt (reusing one → 1172)
  packages: [
    {
      id: "shop",
      amount: 280,
      products: [
        { name: "Plain yogurt 110g", quantity: 2, price: 100 },
        { name: "Shipping", quantity: 1, price: 80 }, // fees are product lines: everything must add up
      ],
    },
  ],
  redirectUrls: {
    confirmUrl: "https://shop.example/pay/line/confirm",
    cancelUrl: "https://shop.example/pay/line/cancel",
  },
  options: { display: { locale: "zh_TW" } },
});
// Save transactionId (a string) with the attempt, then send the customer to
// paymentUrl.web (PC) or paymentUrl.app (mobile).
```

### 2. Confirm when LINE Pay sends the customer back

```ts
// GET /pay/line/confirm?transactionId=…&orderId=…
const { transactionId, orderId } = readRedirectParams(request.url);
const attempt = await db.findAttempt(orderId);
if (!attempt || attempt.transactionId !== transactionId) return notFound(); // anyone can open this URL
if (attempt.status === "paid") return showReceipt(); // reloads must not confirm twice

try {
  const result = await linePay.confirm(transactionId, { amount: attempt.amount, currency: attempt.currency }); // your amount, not the URL's
  await db.markPaid(attempt, result.payInfo);
} catch (e) {
  if (e instanceof LinePayUnknownOutcomeError) {
    // Timed out: it may have gone through. Ask LINE Pay before doing anything else.
    const status = await linePay.checkPaymentRequest(transactionId); // "AUTHORIZED" → safe to confirm again; "COMPLETED" → paid
  } else if (e instanceof LinePayApiError && e.category === "customer") {
    // card declined, balance, expired… let them try again with a new request
  } else throw e;
}
```

### Refunds, capture, void, details

```ts
await linePay.refund(transactionId);                      // full refund
await linePay.refund(transactionId, { refundAmount: 80 }); // partial
await linePay.getPaymentDetails({ orderId: ["ORDER-1-1"] }); // up to 100 ids

// Authorize now, capture later: request with options.payment.capture = false
await linePay.capture(transactionId, { amount: 280, currency: "TWD" });
await linePay.void(transactionId); // release an uncaptured authorization
```

### Pre-approved (regKey) payments

Request with `options.payment.payType: "PREAPPROVED"`; `confirm()` returns `regKey`. Store it like a credential.

```ts
await linePay.preapproved.pay(regKey, { amount: 199, currency: "TWD", orderId: "SUB-2026-10" });
await linePay.preapproved.check(regKey);
await linePay.preapproved.discard(regKey);
```

### Polling instead of a redirect

With `redirectUrls.confirmUrlType: "NONE"`, poll `checkPaymentRequest(transactionId)` at least a second apart:
`PENDING` → keep waiting, `AUTHORIZED` → confirm, `CANCELLED` / `FAILED` → stop, `COMPLETED` → already confirmed.

## Errors

| Thrown | When | What to do |
|---|---|---|
| `LinePayApiError` | LINE Pay answered with a `returnCode` other than `0000` | `category`: `retry` (e.g. `190X`, `retryable === true`), `reconcile` (e.g. `1172`, `1198`, `9000`), `customer` (card/balance/expired), `merchant` (config or request bug, e.g. `1106`, `1124`) |
| `LinePayUnknownOutcomeError` | Timeout, network error, non-JSON reply | If `movesMoney`, read the payment (`getPaymentDetails` / `checkPaymentRequest`) before retrying |
| `LinePayValidationError` | The request was rejected locally | Fix the request |

`resultCodeInfo(code)` returns the description and category for any code.

## Other exports

- `createSignature(channelSecret, apiPath, bodyOrQuery, nonce)` — the raw signer, if you need it elsewhere.
- `parseLossless(text)` — `JSON.parse` that keeps 16+-digit integers as strings.
- `validatePaymentRequest(request)` — the local check `requestPayment()` runs.
- `readRedirectParams(url | URLSearchParams)` — `transactionId` and `orderId` from the confirm/cancel URL.

## Options

| Option | Default | |
|---|---|---|
| `env` | — | `"sandbox"` (sandbox-api-pay.line.me) or `"production"` (api-pay.line.me) |
| `timeouts` | request 20 s, confirm 40 s, capture 60 s, others 20 s | read timeouts, per the API reference's minimums |
| `validate` | `true` | check payment requests before sending |
| `merchantDeviceProfileId`, `merchantDeviceType` | — | optional terminal headers |
| `fetch` | global `fetch` | custom fetch (tests, proxies) |

## License

MIT
