import { describe, expect, it } from "vitest";
import { createNonce, createSignature, LinePay, LinePayApiError, parseLossless, type PaymentRequest } from "../src/index.js";

// Live tests against the LINE Pay sandbox (sandbox-api-pay.line.me). They run
// only with credentials in the environment — copy .env.example to
// .env.sandbox and run `npm run test:sandbox`. Nothing here needs a customer:
// the paths a customer has to approve are in scripts/sandbox-flow.ts.

const channelId = process.env.LINEPAY_CHANNEL_ID;
const channelSecret = process.env.LINEPAY_CHANNEL_SECRET;

describe.skipIf(!channelId || !channelSecret)("LINE Pay sandbox (live)", () => {
  // Built on first use: skipIf still runs this body while collecting tests.
  let client: LinePay | undefined;
  const lp = new Proxy({} as LinePay, {
    get: (_t, key) => {
      client ??= new LinePay({ channelId: channelId!, channelSecret: channelSecret!, env: "sandbox" });
      const v = Reflect.get(client, key, client);
      return typeof v === "function" ? v.bind(client) : v;
    },
  });
  const payment = (orderId: string, amount = 100): PaymentRequest => ({
    amount,
    currency: "TWD",
    orderId,
    packages: [{ id: "pkg", amount, products: [{ name: "測試商品", quantity: 1, price: amount }] }],
    redirectUrls: { confirmUrl: "https://example.com/pay/confirm", cancelUrl: "https://example.com/pay/cancel" },
    options: { display: { locale: "zh_TW" } },
  });
  const orderId = () => `sdk-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const code = (p: Promise<unknown>) => p.then(() => "0000", (e) => (e instanceof LinePayApiError ? e.returnCode : `thrown ${String(e)}`));

  it("requests a payment and returns the 19-digit transaction id exactly (a plain JSON.parse would not)", async () => {
    // The same request by hand, to see LINE Pay's raw answer.
    const body = JSON.stringify(payment(orderId()));
    const nonce = createNonce();
    const raw = await (
      await fetch("https://sandbox-api-pay.line.me/v4/payments/request", {
        method: "POST",
        body,
        headers: {
          "Content-Type": "application/json",
          "X-LINE-ChannelId": channelId!,
          "X-LINE-Authorization-Nonce": nonce,
          "X-LINE-Authorization": createSignature(channelSecret!, "/v4/payments/request", body, nonce),
        },
      })
    ).text();
    const exact = raw.match(/"transactionId"\s*:\s*(\d{19})/)?.[1];
    expect(exact).toMatch(/^\d{19}$/); // sent as a bare JSON number
    expect(String(JSON.parse(raw).info.transactionId)).not.toBe(exact); // …and JSON.parse rounds it
    expect(parseLossless<{ info: { transactionId: string } }>(raw).info.transactionId).toBe(exact);

    const r = await lp.requestPayment(payment(orderId()));
    expect(r.transactionId).toMatch(/^\d{19}$/);
    expect(r.paymentUrl.web).toMatch(/^https:\/\/sandbox-web-pay\.line\.me\//);
    expect(r.paymentUrl.app).toMatch(/^line:\/\/pay\/payment\//);
    expect(r.paymentAccessToken).toMatch(/^\d+$/);
  });

  it("reports a fresh request as PENDING until the customer approves", async () => {
    const r = await lp.requestPayment(payment(orderId()));
    expect(await lp.checkPaymentRequest(r.transactionId)).toBe("PENDING");
  });

  it("signs GET query strings the way LINE Pay checks them (1150 'not found', not 1106 'bad header')", async () => {
    const id = orderId();
    const r = await lp.requestPayment(payment(id));
    // Several ids, repeated keys, characters that need encoding.
    expect(await code(lp.getPaymentDetails({ transactionId: [r.transactionId], orderId: [id, "a b&c/ü"] }))).toBe("1150");
  });

  it("won't confirm before the customer approved (1169, a customer-side code)", async () => {
    const r = await lp.requestPayment(payment(orderId()));
    const e = await lp.confirm(r.transactionId, { amount: 100, currency: "TWD" }).catch((x) => x);
    expect(e).toBeInstanceOf(LinePayApiError);
    expect(e).toMatchObject({ returnCode: "1169", category: "customer" });
  });

  it("has nothing to refund, void or capture on an unpaid request (1150)", async () => {
    const r = await lp.requestPayment(payment(orderId()));
    expect(await code(lp.refund(r.transactionId))).toBe("1150");
    expect(await code(lp.void(r.transactionId))).toBe("1150");
    expect(await code(lp.capture(r.transactionId, { amount: 100, currency: "TWD" }))).toBe("1150");
  });

  it("rejects a wrong secret as a header error (1106)", async () => {
    const wrong = new LinePay({ channelId: channelId!, channelSecret: "0".repeat(32), env: "sandbox" });
    const e = await wrong.checkPaymentRequest("2026093000000000000").catch((x) => x);
    expect(e).toMatchObject({ returnCode: "1106", category: "merchant" });
  });

  it("doesn't know sandbox transactions on the production host", async () => {
    const r = await lp.requestPayment(payment(orderId()));
    const prod = new LinePay({ channelId: channelId!, channelSecret: channelSecret!, env: "production" });
    // Observed: 1159 (no such request) — so a wrong host looks like "not found", not like bad credentials.
    expect(await code(prod.checkPaymentRequest(r.transactionId))).toMatch(/^(1159|1104|1106)$/);
  });

  it("can't tell sandbox from production keys with a lookup: both hosts verify the signature", async () => {
    // So a credential check proves the ID/secret pair, not the environment.
    const prod = new LinePay({ channelId: channelId!, channelSecret: channelSecret!, env: "production" });
    expect(await code(prod.getPaymentDetails({ orderId: ["sdk-env-check"] }))).toBe("1150");
    const prodWrong = new LinePay({ channelId: channelId!, channelSecret: "0".repeat(32), env: "production" });
    expect(await code(prodWrong.getPaymentDetails({ orderId: ["sdk-env-check"] }))).toBe("1106");
  });

  it("reports an unknown pre-approved key as 1190", async () => {
    expect(await code(lp.preapproved.check("RK0000000000000000"))).toBe("1190");
  });

  it("agrees with the local amount check (LINE Pay says 2101 for the same request)", async () => {
    const bad = { ...payment(orderId()), amount: 99 };
    await expect(lp.requestPayment(bad)).rejects.toThrow(/packages add up to 100/);
    const unchecked = new LinePay({ channelId: channelId!, channelSecret: channelSecret!, env: "sandbox", validate: false });
    expect(await code(unchecked.requestPayment(bad))).toBe("2101");
  });
});
