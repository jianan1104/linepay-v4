import { createHmac, randomUUID } from "node:crypto";

/**
 * The `X-LINE-Authorization` value:
 * `Base64(HMAC-SHA256(key = channelSecret, channelSecret + apiPath + X + nonce))`,
 * where X is the exact request body for POST and the query string (no `?`) for GET.
 */
export function createSignature(channelSecret: string, apiPath: string, bodyOrQuery: string, nonce: string): string {
  return createHmac("sha256", channelSecret).update(channelSecret + apiPath + bodyOrQuery + nonce).digest("base64");
}

/** A fresh nonce per request (UUID v4). */
export function createNonce(): string {
  return randomUUID();
}
