// A full sandbox payment, end to end, with a person approving it:
//   npm run build && npm run sandbox:flow
// It requests a payment and prints its URLs; open one and approve with a
// LINE sandbox account. The script polls until the approval, then confirms,
// reads the payment, refunds part of it, then the rest, and checks each
// answer. Needs .env.sandbox (see .env.example).

import { LinePay, LinePayApiError } from "../dist/index.js";

const channelId = process.env.LINEPAY_CHANNEL_ID;
const channelSecret = process.env.LINEPAY_CHANNEL_SECRET;
if (!channelId || !channelSecret) throw new Error("Set LINEPAY_CHANNEL_ID and LINEPAY_CHANNEL_SECRET (.env.sandbox)");

const lp = new LinePay({ channelId, channelSecret, env: "sandbox" });
const amount = Number(process.argv[2] ?? 120);
const orderId = `sdk-flow-${Date.now()}`;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) process.exitCode = 1;
};

const req = await lp.requestPayment({
  amount,
  currency: "TWD",
  orderId,
  packages: [
    {
      id: "pkg",
      amount,
      products: [
        { name: "測試優格 110g", quantity: 1, price: amount - 20 },
        { name: "運費", quantity: 1, price: 20 },
      ],
    },
  ],
  redirectUrls: { confirmUrl: "https://example.com/pay/confirm", cancelUrl: "https://example.com/pay/cancel" },
  options: { display: { locale: "zh_TW" } },
});
console.log(`\norderId       ${orderId}\ntransactionId ${req.transactionId}\n`);
console.log(`Open and approve (sandbox):\n  web: ${req.paymentUrl.web}\n  app: ${req.paymentUrl.app}\n`);
console.log("(After approving, LINE Pay goes to example.com — that's expected; this script confirms instead.)\n");

// Wait for the approval (the confirmUrlType NONE way: poll ≥ 1 s apart).
const deadline = Date.now() + 10 * 60_000;
let status = await lp.checkPaymentRequest(req.transactionId);
while (status === "PENDING" && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 2000));
  status = await lp.checkPaymentRequest(req.transactionId);
}
console.log(`status: ${status}`);
if (status !== "AUTHORIZED") {
  console.log("Not approved (cancelled, failed or timed out) — nothing to confirm.");
  process.exit(status === "CANCELLED" ? 0 : 1);
}

const confirmed = await lp.confirm(req.transactionId, { amount, currency: "TWD" });
check(confirmed.transactionId === req.transactionId, `confirm returns the same transactionId (${confirmed.transactionId})`);
check(confirmed.orderId === orderId, "confirm returns our orderId");
check(confirmed.payInfo.reduce((n, p) => n + p.amount, 0) === amount, `payInfo adds up to ${amount} (${confirmed.payInfo.map((p) => `${p.method} ${p.amount}`).join(", ")})`);
check((await lp.checkPaymentRequest(req.transactionId)) === "COMPLETED", "check says COMPLETED after confirm");

// Confirming again must not charge twice.
const again = await lp.confirm(req.transactionId, { amount, currency: "TWD" }).then(
  () => "0000",
  (e) => (e instanceof LinePayApiError ? e.returnCode : String(e)),
);
check(again !== "0000", `a second confirm is refused (${again})`);

const [detail] = await lp.getPaymentDetails({ orderId: [orderId] });
check(detail?.transactionId === req.transactionId, "details by orderId find it, with the exact transactionId");
console.log(`  transactionType ${detail?.transactionType}, paymentProvider ${detail?.paymentProvider ?? "-"}`);

const partial = await lp.refund(req.transactionId, { refundAmount: 20 });
check(/^\d{19}$/.test(partial.refundTransactionId), `partial refund 20 → ${partial.refundTransactionId}`);
const tooMuch = await lp.refund(req.transactionId, { refundAmount: amount }).then(
  () => "0000",
  (e) => (e instanceof LinePayApiError ? e.returnCode : String(e)),
);
check(tooMuch === "1164", `refunding more than is left is refused (${tooMuch}, expected 1164)`);
const rest = await lp.refund(req.transactionId);
check(/^\d{19}$/.test(rest.refundTransactionId), `full refund of the rest → ${rest.refundTransactionId}`);
const done = await lp.refund(req.transactionId).then(
  () => "0000",
  (e) => (e instanceof LinePayApiError ? e.returnCode : String(e)),
);
check(done === "1165" || done === "1164", `nothing left to refund (${done})`);

const [after] = await lp.getPaymentDetails({ transactionId: [req.transactionId] });
const refunded = (after?.refundList ?? []).reduce((n, r) => n + r.refundAmount, 0);
check(Math.abs(refunded) === amount, `refundList adds up to ${amount} (${JSON.stringify(after?.refundList)})`);
console.log(process.exitCode ? "\nSome checks failed." : "\nAll checks passed.");
