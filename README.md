# linepay-v4

[![npm version](https://img.shields.io/npm/v/linepay-v4.svg)](https://www.npmjs.com/package/linepay-v4)
[![CI](https://github.com/jianan1104/linepay-v4/actions/workflows/ci.yml/badge.svg)](https://github.com/jianan1104/linepay-v4/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/node/v/linepay-v4.svg)](package.json)
[![types: TypeScript](https://img.shields.io/badge/types-TypeScript-3178c6.svg)](src/types.ts)

Zero-dependency TypeScript SDK for the [LINE Pay Online API v4](https://developers-pay.line.me/online-api-v4) (Taiwan, Thailand).

> **Unofficial.** Not affiliated with or endorsed by LINE Corporation or LINE Pay. "LINE" and "LINE Pay" are trademarks of their respective owners.

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Usage](#usage)
- [Errors](#errors)
- [API](#api)
- [Options](#options)
- [Testing against the LINE Pay sandbox](#testing-against-the-line-pay-sandbox)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

## Install

```sh
npm install linepay-v4
```

Also published to GitHub Packages as `@jianan1104/linepay-v4` (add `@jianan1104:registry=https://npm.pkg.github.com` to your `.npmrc`), and each [GitHub Release](https://github.com/jianan1104/linepay-v4/releases) carries the package tarball with its SHA-256.

## Quick start

```ts
import { LinePay } from "linepay-v4";

const linePay = new LinePay({
  channelId: process.env.LINE_PAY_CHANNEL_ID!,
  channelSecret: process.env.LINE_PAY_CHANNEL_SECRET!, // server only
  env: "sandbox",
});

const { transactionId, paymentUrl } = await linePay.requestPayment({
  amount: 100,
  currency: "TWD",
  orderId: "ORDER-1-1",
  packages: [{ id: "shop", amount: 100, products: [{ name: "Yogurt", quantity: 1, price: 100 }] }],
  redirectUrls: { confirmUrl: "https://shop.example/pay/confirm", cancelUrl: "https://shop.example/pay/cancel" },
});
// Send the customer to paymentUrl.web; when LINE Pay brings them back to confirmUrl:
await linePay.confirm(transactionId, { amount: 100, currency: "TWD" });
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

## API

### `new LinePay(options)`

See [Options](#options). Methods: `requestPayment`, `checkPaymentRequest`, `confirm`, `capture`, `void`, `refund`, `getPaymentDetails`, `preapproved.check`, `preapproved.pay`, `preapproved.discard` — each documented with its LINE Pay endpoint in the type declarations.

### Other exports

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

## Testing against the LINE Pay sandbox

The unit tests (`npm test`) need nothing. To check the SDK — or your own integration — against LINE Pay itself, use a sandbox merchant:

1. **Get sandbox credentials.** Apply for a sandbox account at [LINE Pay Developers → Sandbox](https://developers-pay.line.me/sandbox) (one sandbox account per email). In the sandbox merchant center, open *Developer tools → Manage link key*, click *View*, and enter the code emailed to you: you get a **channel ID** and a **channel secret**.
2. **Put them in `.env.sandbox`** (git-ignored — never commit it):

   ```sh
   cp .env.example .env.sandbox
   # LINEPAY_CHANNEL_ID=…
   # LINEPAY_CHANNEL_SECRET=…
   ```

3. **Run the live tests** — no customer needed:

   ```sh
   npm run test:sandbox
   ```

   They call `sandbox-api-pay.line.me` for real: request payments, check them, and pin down how LINE Pay answers (exact 19-digit IDs, GET query signing, 1169 before approval, 1150 for nothing to refund/void/capture, 1106 for a wrong secret, 1190 for an unknown regKey, 2101 for amounts that don't add up). Without credentials they're skipped, so `npm test` and CI never need them.

4. **Walk a whole payment, approved by you:**

   ```sh
   npm run build && npm run sandbox:flow        # optional amount: npm run sandbox:flow -- 250
   ```

   It prints a sandbox payment URL. Open it, log in and approve (the page then goes to example.com — expected). The script notices the approval, confirms the payment, reads it back, refunds part of it, tries to refund too much, refunds the rest, and checks every answer.

### What the sandbox taught us

Things the reference doesn't say, observed against the sandbox and pinned in `tests/sandbox.test.ts` / `scripts/sandbox-flow.ts`:

| Situation | LINE Pay answers |
|---|---|
| `transactionId` in any response | a bare 19-digit JSON number — `JSON.parse` rounds it; this SDK doesn't |
| confirm before the customer approved | `1169` |
| confirm an already confirmed payment | `1172` |
| refund more than is left / nothing left | `1164` / `1165` |
| `refundList` in payment details | amounts are **negative** (`-20`), type `PARTIAL_REFUND` each |
| wrong channel secret | `1106` |
| sandbox keys on the production host | signature accepted; lookups say "not found" (`1150`/`1159`) — a lookup can't tell which environment a key belongs to, so make one real payment before going live |
| a second *request* with the same `orderId` | accepted in the sandbox — keep your orderIds unique per attempt yourself |
| `amount` ≠ Σ packages | `2101` (`form.amount != sum(packages[].amount) + sum(packages[].userFee) + shippingFee`) |

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup, tests and release process, and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## Security

Please report vulnerabilities privately — see [SECURITY.md](SECURITY.md). Keep your channel secret on the server; never commit it.

## License

[MIT](LICENSE) © 林建安
