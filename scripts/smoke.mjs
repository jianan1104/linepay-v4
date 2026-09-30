// Runs the built package (dist/) the way a user's app would, with a fake
// LINE Pay: request → confirm, lossless ids, signing, a timeout. CI runs it on
// Node 20 (the oldest supported runtime), where the test tooling can't run.
//   node scripts/smoke.mjs          (ESM build)
//   node scripts/smoke.mjs --cjs    (CommonJS build)
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";

const lib = process.argv.includes("--cjs") ? createRequire(import.meta.url)("../dist/index.cjs") : await import("../dist/index.mjs");
const { LinePay, LinePayUnknownOutcomeError } = lib;
const SECRET = "0123456789abcdef0123456789abcdef";
const assert = (ok, what) => {
  if (!ok) throw new Error(`smoke failed: ${what}`);
};

const seen = [];
const fakeFetch = async (url, init) => {
  const path = new URL(url).pathname;
  const h = init.headers;
  const expected = createHmac("sha256", SECRET).update(SECRET + path + (init.body ?? "") + h["X-LINE-Authorization-Nonce"]).digest("base64");
  assert(h["X-LINE-Authorization"] === expected, `signature for ${path}`);
  seen.push(path);
  if (path === "/v4/payments/request") {
    return new Response('{"returnCode":"0000","returnMessage":"OK","info":{"transactionId":2026093002385193410,"paymentAccessToken":"1","paymentUrl":{"web":"https://w","app":"line://a"}}}');
  }
  if (path.endsWith("/confirm")) {
    return new Response('{"returnCode":"0000","returnMessage":"OK","info":{"orderId":"O-1","transactionId":2026093002385193410,"payInfo":[{"method":"BALANCE","amount":100}]}}');
  }
  return new Promise((_r, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason))); // never answers
};

const lp = new LinePay({ channelId: "1", channelSecret: SECRET, env: "sandbox", fetch: fakeFetch, timeouts: { default: 50 } });
const req = await lp.requestPayment({
  amount: 100,
  currency: "TWD",
  orderId: "O-1",
  packages: [{ id: "p", amount: 100, products: [{ name: "x", quantity: 1, price: 100 }] }],
  redirectUrls: { confirmUrl: "https://s/c", cancelUrl: "https://s/x" },
});
assert(req.transactionId === "2026093002385193410", `lossless id (got ${req.transactionId})`);
const conf = await lp.confirm(req.transactionId, { amount: 100, currency: "TWD" });
assert(conf.transactionId === "2026093002385193410" && conf.payInfo[0].amount === 100, "confirm result");
// AbortSignal.timeout doesn't keep Node alive by itself (a real request's
// socket would): hold the event loop open while the fake never answers.
const keepAlive = setInterval(() => {}, 1000);
const e = await lp.refund(req.transactionId).catch((x) => x);
clearInterval(keepAlive);
assert(e instanceof LinePayUnknownOutcomeError && e.movesMoney === true, "a timeout is an unknown outcome");
assert(seen.join(",") === "/v4/payments/request,/v4/payments/2026093002385193410/confirm,/v4/payments/2026093002385193410/refund", "paths");
console.log(`smoke ok (${process.argv.includes("--cjs") ? "cjs" : "esm"}) on Node ${process.version}`);
