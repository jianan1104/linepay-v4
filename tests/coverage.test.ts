import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  LinePay,
  LinePayApiError,
  LinePayUnknownOutcomeError,
  LinePayValidationError,
  readRedirectParams,
  validatePaymentRequest,
  type PaymentRequest,
} from "../src/index.js";

// The paths client.test.ts doesn't walk: pre-approved payments, capture,
// device headers, option checks, and every rule of the local validation.

const SECRET = "f0e1d2c3b4a5968778695a4b3c2d1e0f";
type Sent = { url: string; method: string; headers: Record<string, string>; body?: string };

function client(reply = '{"returnCode":"0000","returnMessage":"OK","info":{}}', extra: Partial<ConstructorParameters<typeof LinePay>[0]> = {}) {
  const sent: Sent[] = [];
  const fetchMock = (async (url: string, init: RequestInit) => {
    sent.push({ url, method: init.method!, headers: init.headers as Record<string, string>, body: init.body as string | undefined });
    return new Response(reply);
  }) as unknown as typeof fetch;
  return { lp: new LinePay({ channelId: "1234567890", channelSecret: SECRET, env: "sandbox", fetch: fetchMock, ...extra }), sent };
}
const sig = (path: string, x: string, nonce: string) => createHmac("sha256", SECRET).update(SECRET + path + x + nonce).digest("base64");

describe("options", () => {
  it("require credentials and a known environment", () => {
    expect(() => new LinePay({ channelId: "", channelSecret: SECRET, env: "sandbox" })).toThrow(LinePayValidationError);
    expect(() => new LinePay({ channelId: "1", channelSecret: "", env: "sandbox" })).toThrow(LinePayValidationError);
    expect(() => new LinePay({ channelId: "1", channelSecret: SECRET, env: "staging" as never })).toThrow(/sandbox|production/);
  });

  it("send the optional merchant device headers when set", async () => {
    const { lp, sent } = client(undefined, { merchantDeviceProfileId: "POS-01", merchantDeviceType: "KIOSK" });
    await lp.checkPaymentRequest("1").catch(() => undefined);
    expect(sent[0]!.headers).toMatchObject({ "X-LINE-MerchantDeviceProfileId": "POS-01", "X-LINE-MerchantDeviceType": "KIOSK" });
    const { lp: plain, sent: sentPlain } = client();
    await plain.checkPaymentRequest("1").catch(() => undefined);
    expect(sentPlain[0]!.headers).not.toHaveProperty("X-LINE-MerchantDeviceProfileId");
  });
});

describe("capture", () => {
  it("posts amount and currency to the authorization and returns ids as strings", async () => {
    const { lp, sent } = client('{"returnCode":"0000","returnMessage":"OK","info":{"orderId":"O-1","transactionId":2026093002385195510,"payInfo":[{"method":"CREDIT_CARD","amount":280}]}}');
    const r = await lp.capture("2026093002385195510", { amount: 280, currency: "TWD" });
    expect(sent[0]!.url).toBe("https://sandbox-api-pay.line.me/v4/payments/authorizations/2026093002385195510/capture");
    expect(JSON.parse(sent[0]!.body!)).toEqual({ amount: 280, currency: "TWD" });
    expect(r).toMatchObject({ transactionId: "2026093002385195510", orderId: "O-1" });
  });
});

describe("pre-approved payments", () => {
  it("check signs the creditCardAuth query", async () => {
    const { lp, sent } = client('{"returnCode":"0000","returnMessage":"OK"}');
    await lp.preapproved.check("RK9A8B7C6D", { creditCardAuth: true });
    await lp.preapproved.check("RK9A8B7C6D");
    const [a, b] = sent;
    expect(a!.url).toBe("https://sandbox-api-pay.line.me/v4/payments/preapprovedPay/RK9A8B7C6D/check?creditCardAuth=true");
    expect(a!.headers["X-LINE-Authorization"]).toBe(sig("/v4/payments/preapprovedPay/RK9A8B7C6D/check", "creditCardAuth=true", a!.headers["X-LINE-Authorization-Nonce"]!));
    expect(b!.url).toMatch(/creditCardAuth=false$/);
  });

  it("pay charges the key and returns the transaction id as a string", async () => {
    const { lp, sent } = client('{"returnCode":"0000","returnMessage":"OK","info":{"transactionId":2026093002385199999,"transactionDate":"2026-10-01T00:00:00Z","paymentProvider":"TSP"}}');
    const r = await lp.preapproved.pay("RK/with space", { amount: 199, currency: "TWD", orderId: "SUB-2026-10", productName: "月訂", capture: true });
    expect(sent[0]!.url).toBe("https://sandbox-api-pay.line.me/v4/payments/preapprovedPay/RK%2Fwith%20space/payment");
    expect(JSON.parse(sent[0]!.body!)).toEqual({ amount: 199, currency: "TWD", orderId: "SUB-2026-10", productName: "月訂", capture: true });
    expect(r).toEqual({ transactionId: "2026093002385199999", transactionDate: "2026-10-01T00:00:00Z", paymentProvider: "TSP" });
  });

  it("pay is money-moving: no answer means an unknown outcome", async () => {
    const lp = new LinePay({
      channelId: "1",
      channelSecret: SECRET,
      env: "sandbox",
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    });
    await expect(lp.preapproved.pay("RK1", { amount: 1, currency: "TWD", orderId: "A" })).rejects.toMatchObject({ name: "LinePayUnknownOutcomeError", movesMoney: true });
  });

  it("discard expires the key with an empty signed body; an unknown key is 1190", async () => {
    const { lp, sent } = client('{"returnCode":"0000","returnMessage":"OK"}');
    await lp.preapproved.discard("RK1");
    expect(sent[0]).toMatchObject({ method: "POST", url: "https://sandbox-api-pay.line.me/v4/payments/preapprovedPay/RK1/expire", body: "{}" });
    const e = await client('{"returnCode":"1190","returnMessage":"The regKey does not exist."}').lp.preapproved.discard("RK1").catch((x) => x);
    expect(e).toMatchObject({ returnCode: "1190", category: "merchant" });
  });
});

describe("details and odd replies", () => {
  it("getPaymentDetails needs at least one id", async () => {
    await expect(client().lp.getPaymentDetails({})).rejects.toBeInstanceOf(LinePayValidationError);
  });

  it("treats JSON without a returnCode as an unknown outcome", async () => {
    await expect(client('{"status":"ok"}').lp.confirm("1", { amount: 1, currency: "TWD" })).rejects.toBeInstanceOf(LinePayUnknownOutcomeError);
  });

  it("an error with no returnMessage falls back to the code's description", () => {
    const e = new LinePayApiError("1142", "", "/v4/payments/1/confirm");
    expect(e.message).toContain("The balance is insufficient.");
    expect(new LinePayUnknownOutcomeError("/x", false, "boom").message).toContain("boom");
  });
});

describe("validatePaymentRequest, rule by rule", () => {
  const ok: PaymentRequest = {
    amount: 30.3,
    currency: "USD",
    orderId: "O-1",
    packages: [{ id: "p", amount: 30.3, products: [{ name: "a", quantity: 3, price: 10.1 }] }], // 3 × 10.1 = 30.299999…
    redirectUrls: { confirmUrl: "https://x/c", cancelUrl: "https://x/x" },
  };
  const bad = (patch: Partial<PaymentRequest>) => () => validatePaymentRequest({ ...ok, ...patch });
  const pkg = (p: Partial<PaymentRequest["packages"][number]>) => ({ packages: [{ ...ok.packages[0]!, ...p }] });
  const product = (p: Partial<PaymentRequest["packages"][number]["products"][number]>) => pkg({ products: [{ ...ok.packages[0]!.products[0]!, ...p }] });

  it("accepts cents that only differ by float noise", () => {
    expect(() => validatePaymentRequest(ok)).not.toThrow();
  });

  it("checks the amount itself and the package list", () => {
    expect(bad({ amount: -1 })).toThrow(/non-negative/);
    expect(bad({ amount: Number.NaN })).toThrow(/non-negative/);
    expect(bad({ packages: [] })).toThrow(/at least one package/);
    expect(bad(pkg({ products: [] }))).toThrow(/has no products/);
  });

  it("checks package and product fields", () => {
    expect(bad(pkg({ id: "" }))).toThrow(/packages\[0\]\.id/);
    expect(bad(pkg({ id: "x".repeat(51) }))).toThrow(/packages\[0\]\.id/);
    expect(bad(pkg({ name: "x".repeat(101) }))).toThrow(/name is at most 100/);
    expect(bad(product({ name: "" }))).toThrow(/products\[0\]\.name/);
    expect(bad(product({ id: "x".repeat(51) }))).toThrow(/products\[0\]\.id/);
    expect(bad(product({ imageUrl: `https://x/${"x".repeat(500)}` }))).toThrow(/imageUrl/);
    expect(bad(product({ price: Number.NaN }))).toThrow(/numeric price/);
  });

  it("checks redirect URLs", () => {
    expect(bad({ redirectUrls: { confirmUrl: "https://x/c" } })).toThrow(/cancelUrl is required/);
    expect(bad({ redirectUrls: { confirmUrl: `https://x/${"c".repeat(500)}`, cancelUrl: "https://x/x" } })).toThrow(/confirmUrl is at most 500/);
    expect(bad({ redirectUrls: { confirmUrl: "https://x/c", cancelUrl: "https://x/x?transactionId=1" } })).not.toThrow(); // only confirmUrl gets params appended
  });

  it("lists every problem at once", () => {
    const e = (() => {
      try {
        validatePaymentRequest({ ...ok, currency: "JPY" as never, orderId: "" });
      } catch (x) {
        return x as Error;
      }
    })();
    expect(e?.message).toMatch(/currency.*orderId/);
  });
});

describe("readRedirectParams", () => {
  it("takes a URL object too", () => {
    expect(readRedirectParams(new URL("https://shop.example/pay?transactionId=123&orderId=O"))).toEqual({ transactionId: "123", orderId: "O" });
    expect(readRedirectParams("/pay/confirm?transactionId=123&orderId=O")).toEqual({ transactionId: "123", orderId: "O" }); // a relative path works
    expect(() => readRedirectParams(`https://x/?transactionId=1&orderId=${"o".repeat(101)}`)).toThrow(LinePayValidationError);
  });
});
