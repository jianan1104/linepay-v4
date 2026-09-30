import { LinePayValidationError } from "./errors.js";

/**
 * Reads the `transactionId` and `orderId` LINE Pay appends to your
 * confirmUrl (or cancelUrl). This only checks their shape: the page is a
 * plain GET anyone can open, so look the attempt up by orderId, check the
 * transactionId matches the one you stored, and take the amount from your
 * own records before confirming.
 */
export function readRedirectParams(input: string | URL | URLSearchParams): { transactionId: string; orderId: string } {
  const params =
    input instanceof URLSearchParams ? input : new URL(typeof input === "string" ? input : input.href, "http://localhost").searchParams;
  const transactionId = params.get("transactionId") ?? "";
  const orderId = params.get("orderId") ?? "";
  if (!/^\d{1,19}$/.test(transactionId)) throw new LinePayValidationError("confirmUrl is missing a valid transactionId");
  if (!orderId || orderId.length > 100) throw new LinePayValidationError("confirmUrl is missing a valid orderId");
  return { transactionId, orderId };
}
