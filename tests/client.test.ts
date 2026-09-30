import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  LinePay,
  LinePayApiError,
  LinePayUnknownOutcomeError,
  LinePayValidationError,
  parseLossless,
  readRedirectParams,
  resultCodeInfo,
  validatePaymentRequest,
  type PaymentRequest,
} from "../src/index.js";

const SECRET = "a917ab6a2367b536f8e5a6e2977e06f4";
type Sent = { url: string; method: string; headers: Record<string, string>; body?: string };

/** A client whose fetch records the request and answers with `reply` (text, or a thrower). */
function client(reply: string | ((s: Sent) => string | Promise<string>) = '{"returnCode":"0000","returnMessage":"OK","info":{}}', env: "sandbox" | "production" = "sandbox") {
  const sent: Sent[] = [];
  const fetchMock = (async (url: string, init: RequestInit) => {
    const s: Sent = { url, method: init.method!, headers: init.headers as Record<string, string>, body: init.body as string | undefined };
    sent.push(s);
    const text = typeof reply === "string" ? reply : await reply(s);
    return new Response(text, { status: 200 });
  }) as unknown as typeof fetch;
  return { lp: new LinePay({ channelId: "1234567890", channelSecret: SECRET, env, fetch: fetchMock }), sent };
}

const expectedSig = (path: string, bodyOrQuery: string, nonce: string) =>
  createHmac("sha256", SECRET).update(SECRET + path + bodyOrQuery + nonce).digest("base64");

const request: PaymentRequest = {
  amount: 280,
  currency: "TWD",
  orderId: "ORDER-1-1",
  packages: [
    {
      id: "pkg-1",
      amount: 280,
      name: "優格店",
      products: [
        { name: "原味優格 110g", quantity: 2, price: 100 },
        { name: "運費", quantity: 1, price: 80 },
      ],
    },
  ],
  redirectUrls: { confirmUrl: "https://shop.example/pay/confirm", cancelUrl: "https://shop.example/pay/cancel" },
  options: { display: { locale: "zh_TW" } },
};

describe("signing", () => {
  it("signs POST with the exact body string that is sent", async () => {
    const { lp, sent } = client('{"returnCode":"0000","returnMessage":"OK","info":{"transactionId":2023042201206549310,"paymentAccessToken":"1","paymentUrl":{"web":"w","app":"a"}}}');
    await lp.requestPayment(request);
    const s = sent[0]!;
    expect(s.url).toBe("https://sandbox-api-pay.line.me/v4/payments/request");
    expect(s.method).toBe("POST");
    expect(s.headers["X-LINE-ChannelId"]).toBe("1234567890");
    expect(s.headers["Content-Type"]).toBe("application/json");
    const nonce = s.headers["X-LINE-Authorization-Nonce"]!;
    expect(nonce).toMatch(/^[0-9a-f-]{36}$/);
    expect(s.headers["X-LINE-Authorization"]).toBe(expectedSig("/v4/payments/request", s.body!, nonce));
    expect(JSON.parse(s.body!)).toEqual(request);
  });

  it("signs GET with the query string without '?', and a fresh nonce every call", async () => {
    const { lp, sent } = client('{"returnCode":"0000","returnMessage":"OK","info":[]}');
    await lp.getPaymentDetails({ transactionId: ["2023042201206549310"], orderId: ["A 1&2"] });
    await lp.getPaymentDetails({ orderId: ["B"] });
    const [a, b] = sent;
    const query = "transactionId=2023042201206549310&orderId=A+1%262";
    expect(a!.url).toBe(`https://sandbox-api-pay.line.me/v4/payments?${query}`);
    expect(a!.body).toBeUndefined();
    expect(a!.headers["X-LINE-Authorization"]).toBe(expectedSig("/v4/payments", query, a!.headers["X-LINE-Authorization-Nonce"]!));
    expect(a!.headers["X-LINE-Authorization-Nonce"]).not.toBe(b!.headers["X-LINE-Authorization-Nonce"]);
  });

  it("signs a GET without query over the empty string, and POSTs without fields as {}", async () => {
    const { lp, sent } = client('{"returnCode":"0000","returnMessage":"OK"}');
    await lp.checkPaymentRequest("2023042201206549310");
    await lp.void("2023042201206549310");
    const [check, voided] = sent;
    expect(check!.headers["X-LINE-Authorization"]).toBe(expectedSig("/v4/payments/requests/2023042201206549310/check", "", check!.headers["X-LINE-Authorization-Nonce"]!));
    expect(voided!.body).toBe("{}");
    expect(voided!.headers["X-LINE-Authorization"]).toBe(
      expectedSig("/v4/payments/authorizations/2023042201206549310/void", "{}", voided!.headers["X-LINE-Authorization-Nonce"]!),
    );
  });

  it("uses the production host for production", async () => {
    const { lp, sent } = client('{"returnCode":"0000","returnMessage":"OK","info":{}}', "production");
    await lp.confirm("1", { amount: 1, currency: "TWD" });
    expect(sent[0]!.url).toBe("https://api-pay.line.me/v4/payments/1/confirm");
  });
});

describe("19-digit transaction IDs", () => {
  it("come back as exact strings (a plain JSON.parse would round them)", async () => {
    const raw = '{"returnCode":"0000","returnMessage":"OK","info":{"orderId":"O-1","transactionId":2023042201206549310,"payInfo":[{"method":"BALANCE","amount":280}]}}';
    expect(String(JSON.parse(raw).info.transactionId)).not.toBe("2023042201206549310");
    const { lp } = client(raw);
    const r = await lp.confirm("2023042201206549310", { amount: 280, currency: "TWD" });
    expect(r.transactionId).toBe("2023042201206549310");
    expect(r.payInfo[0]!.amount).toBe(280);
  });

  it("are refused as numbers, accepted as strings or bigint", async () => {
    const { lp, sent } = client();
    await expect(lp.refund(2023042201206549310 as unknown as string)).rejects.toBeInstanceOf(LinePayValidationError);
    await expect(lp.refund("12a")).rejects.toBeInstanceOf(LinePayValidationError);
    await lp.refund(2023042201206549310n);
    expect(sent[0]!.url).toContain("/v4/payments/2023042201206549310/refund");
  });

  it("parseLossless keeps long integers anywhere, and leaves strings and ordinary numbers alone", () => {
    const text = '{"a":[1234567890123456789,-12,3.5,1e3],"s":"id 9999999999999999999 \\" x","refundList":[{"refundTransactionId":2023042201206549311}]}';
    expect(parseLossless(text)).toEqual({
      a: ["1234567890123456789", -12, 3.5, 1000],
      s: 'id 9999999999999999999 " x',
      refundList: [{ refundTransactionId: "2023042201206549311" }],
    });
  });
});

describe("results and errors", () => {
  it("throws LinePayApiError with a handling category for any code but 0000", async () => {
    const { lp } = client('{"returnCode":"1106","returnMessage":"Header information error"}');
    const e = await lp.confirm("1", { amount: 1, currency: "TWD" }).catch((x) => x);
    expect(e).toBeInstanceOf(LinePayApiError);
    expect(e).toMatchObject({ returnCode: "1106", category: "merchant", retryable: false, apiPath: "/v4/payments/1/confirm" });
    const temp = await client('{"returnCode":"1902","returnMessage":"try later"}').lp.refund("1").catch((x) => x);
    expect(temp).toMatchObject({ category: "retry", retryable: true });
    expect(resultCodeInfo("1172").category).toBe("reconcile");
    expect(resultCodeInfo("1288").category).toBe("customer");
    expect(resultCodeInfo("7777").category).toBe("reconcile");
  });

  it("reports a timeout as an unknown outcome, flagged when money could have moved", async () => {
    const lp = new LinePay({
      channelId: "1",
      channelSecret: SECRET,
      env: "sandbox",
      timeouts: { confirm: 20, default: 20 },
      fetch: ((_: string, init: RequestInit) =>
        new Promise((_r, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)))) as unknown as typeof fetch,
    });
    const confirm = await lp.confirm("1", { amount: 1, currency: "TWD" }).catch((x) => x);
    expect(confirm).toBeInstanceOf(LinePayUnknownOutcomeError);
    expect(confirm).toMatchObject({ movesMoney: true, apiPath: "/v4/payments/1/confirm" });
    const details = await lp.getPaymentDetails({ orderId: ["A"] }).catch((x) => x);
    expect(details).toMatchObject({ movesMoney: false });
  });

  it("treats a non-JSON reply (e.g. a proxy error page) as an unknown outcome, not a failure", async () => {
    const lp = new LinePay({
      channelId: "1",
      channelSecret: SECRET,
      env: "sandbox",
      fetch: (async () => new Response("<html>502 Bad Gateway</html>", { status: 502 })) as unknown as typeof fetch,
    });
    await expect(lp.refund("1", { refundAmount: 50 })).rejects.toMatchObject({ name: "LinePayUnknownOutcomeError", movesMoney: true });
  });

  it("maps the payment request status codes", async () => {
    for (const [code, status] of [["0000", "PENDING"], ["0110", "AUTHORIZED"], ["0121", "CANCELLED"], ["0122", "FAILED"], ["0123", "COMPLETED"]] as const) {
      expect(await client(`{"returnCode":"${code}","returnMessage":""}`).lp.checkPaymentRequest("1")).toBe(status);
    }
    await expect(client('{"returnCode":"1150","returnMessage":"none"}').lp.checkPaymentRequest("1")).rejects.toMatchObject({ returnCode: "1150" });
  });

  it("sends a partial refund amount, or nothing for a full refund", async () => {
    const { lp, sent } = client('{"returnCode":"0000","returnMessage":"OK","info":{"refundTransactionId":2023042201206549999,"refundTransactionDate":"2026-10-01T00:00:00Z"}}');
    const r = await lp.refund("1", { refundAmount: 50 });
    await lp.refund("1");
    expect(JSON.parse(sent[0]!.body!)).toEqual({ refundAmount: 50 });
    expect(sent[1]!.body).toBe("{}");
    expect(r.refundTransactionId).toBe("2023042201206549999");
  });
});

describe("validatePaymentRequest", () => {
  const bad = (patch: Partial<PaymentRequest>) => () => validatePaymentRequest({ ...request, ...patch });

  it("accepts a request whose amounts add up (shipping as a product line)", () => {
    expect(() => validatePaymentRequest(request)).not.toThrow();
  });

  it("rejects amounts that don't add up, before LINE Pay answers 1124", () => {
    expect(bad({ amount: 200 })).toThrow(/packages add up to 280/);
    expect(bad({ packages: [{ ...request.packages[0]!, amount: 200, products: request.packages[0]!.products }] })).toThrow(/products add up to 280/);
    expect(bad({ amount: 280.5 })).toThrow(/whole dollars/);
  });

  it("rejects bad currencies, ids and redirect URLs", () => {
    expect(bad({ currency: "JPY" as never })).toThrow(/currency/);
    expect(bad({ orderId: "x".repeat(101) })).toThrow(/orderId/);
    expect(bad({ redirectUrls: { cancelUrl: "https://x" } })).toThrow(/confirmUrl is required/);
    expect(bad({ redirectUrls: { confirmUrl: "https://x/c?orderId=1", cancelUrl: "https://x" } })).toThrow(/appends them/);
    expect(() => validatePaymentRequest({ ...request, redirectUrls: { confirmUrlType: "NONE" } })).not.toThrow();
  });

  it("runs before sending, and can be turned off", async () => {
    const { lp, sent } = client();
    await expect(lp.requestPayment({ ...request, amount: 1 })).rejects.toBeInstanceOf(LinePayValidationError);
    expect(sent).toHaveLength(0);
    const loose = new LinePay({ channelId: "1", channelSecret: SECRET, env: "sandbox", validate: false, fetch: (async () => new Response('{"returnCode":"1124","returnMessage":"amount"}')) as unknown as typeof fetch });
    await expect(loose.requestPayment({ ...request, amount: 1 })).rejects.toMatchObject({ returnCode: "1124" });
  });
});

describe("readRedirectParams", () => {
  it("reads transactionId and orderId as strings from the confirmUrl", () => {
    expect(readRedirectParams("https://shop.example/pay/confirm?transactionId=2023042201206549310&orderId=ORDER-1-1")).toEqual({
      transactionId: "2023042201206549310",
      orderId: "ORDER-1-1",
    });
    expect(readRedirectParams(new URLSearchParams("transactionId=1&orderId=A"))).toEqual({ transactionId: "1", orderId: "A" });
  });

  it("rejects missing or malformed values", () => {
    expect(() => readRedirectParams("https://x/c?orderId=A")).toThrow(LinePayValidationError);
    expect(() => readRedirectParams("https://x/c?transactionId=12x&orderId=A")).toThrow(LinePayValidationError);
    expect(() => readRedirectParams("https://x/c?transactionId=1")).toThrow(LinePayValidationError);
  });
});
