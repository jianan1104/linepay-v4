import { LinePayValidationError } from "./errors.js";
import type { PaymentRequest } from "./types.js";

const CURRENCIES = new Set(["TWD", "USD", "THB"]);

/**
 * Checks a payment request the way LINE Pay will, so a mistake fails here
 * with a clear message instead of as 1124 / 2101 from the API:
 * amount = Σ packages[].amount, each package amount = Σ price × quantity,
 * a supported currency, and field lengths.
 */
export function validatePaymentRequest(req: PaymentRequest): void {
  const problems: string[] = [];
  if (!CURRENCIES.has(req.currency)) problems.push(`currency must be TWD, USD or THB (got ${req.currency})`);
  if (!req.orderId || req.orderId.length > 100) problems.push("orderId is required and at most 100 characters");
  if (!Number.isFinite(req.amount) || req.amount < 0) problems.push("amount must be a non-negative number");
  if (req.currency === "TWD" && !Number.isInteger(req.amount)) problems.push("TWD amounts are whole dollars");
  if (!req.packages?.length) problems.push("at least one package is required");

  let sum = 0;
  (req.packages ?? []).forEach((p, i) => {
    let lines = 0;
    if (!p.id || p.id.length > 50) problems.push(`packages[${i}].id is required and at most 50 characters`);
    if (p.name && p.name.length > 100) problems.push(`packages[${i}].name is at most 100 characters`);
    if (!p.products?.length) problems.push(`packages[${i}] has no products`);
    (p.products ?? []).forEach((pr, j) => {
      if (!pr.name || pr.name.length > 4000) problems.push(`packages[${i}].products[${j}].name is required and at most 4000 characters`);
      if (pr.id && pr.id.length > 50) problems.push(`packages[${i}].products[${j}].id is at most 50 characters`);
      if (pr.imageUrl && pr.imageUrl.length > 500) problems.push(`packages[${i}].products[${j}].imageUrl is at most 500 characters`);
      if (!Number.isFinite(pr.price) || !Number.isFinite(pr.quantity)) problems.push(`packages[${i}].products[${j}] needs a numeric price and quantity`);
      lines += pr.price * pr.quantity;
    });
    if (!equal(lines, p.amount)) problems.push(`packages[${i}].amount is ${p.amount} but its products add up to ${lines}`);
    sum += p.amount;
  });
  if (req.packages?.length && !equal(sum, req.amount)) problems.push(`amount is ${req.amount} but the packages add up to ${sum} (charge shipping/fees as a product line)`);

  const urls = req.redirectUrls ?? {};
  if ((urls.confirmUrlType ?? "CLIENT") !== "NONE") {
    if (!urls.confirmUrl) problems.push("redirectUrls.confirmUrl is required unless confirmUrlType is NONE");
    if (!urls.cancelUrl) problems.push("redirectUrls.cancelUrl is required unless confirmUrlType is NONE");
  }
  for (const k of ["confirmUrl", "cancelUrl"] as const) if ((urls[k]?.length ?? 0) > 500) problems.push(`redirectUrls.${k} is at most 500 characters`);
  if (urls.confirmUrl && /[?&](transactionId|orderId)=/.test(urls.confirmUrl)) problems.push("don't put transactionId/orderId in confirmUrl — LINE Pay appends them");

  if (problems.length) throw new LinePayValidationError(`Invalid payment request: ${problems.join("; ")}`);
}

// USD/THB may carry cents: compare in hundredths to dodge float noise.
const equal = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100);
