import { LinePayApiError, LinePayUnknownOutcomeError, LinePayValidationError } from "./errors.js";
import { parseLossless } from "./json.js";
import { createNonce, createSignature } from "./sign.js";
import { validatePaymentRequest } from "./validate.js";
import type {
  CaptureResult,
  ConfirmResult,
  Currency,
  PaymentDetail,
  PaymentRequest,
  PaymentRequestResult,
  PaymentRequestStatus,
  PreapprovedPaymentRequest,
  PreapprovedPaymentResult,
  RefundResult,
} from "./types.js";

export type LinePayOptions = {
  channelId: string;
  channelSecret: string;
  /** "sandbox" → sandbox-api-pay.line.me, "production" → api-pay.line.me */
  env: "sandbox" | "production";
  /** Optional terminal identification headers. */
  merchantDeviceProfileId?: string;
  merchantDeviceType?: string;
  /** Override read timeouts (ms). Defaults follow the API reference's minimums. */
  timeouts?: Partial<Record<Operation, number>>;
  /** Check payment requests locally before sending (default true). */
  validate?: boolean;
  /** A fetch implementation (default: global fetch). Handy for tests and proxies. */
  fetch?: typeof fetch;
};

type Operation = "request" | "confirm" | "capture" | "default";

const DEFAULT_TIMEOUTS: Record<Operation, number> = { request: 20_000, confirm: 40_000, capture: 60_000, default: 20_000 };

type Envelope<T> = { returnCode: string; returnMessage: string; info?: T };

/** 19-digit IDs are passed as strings (or bigint) and checked, so a rounded number can't slip through. */
function txId(id: string | bigint): string {
  const s = typeof id === "bigint" ? id.toString() : id;
  if (typeof s !== "string" || !/^\d{1,19}$/.test(s)) {
    throw new LinePayValidationError(`transactionId must be a string of digits (got ${String(id)}); never pass it as a number — it has 19 digits`);
  }
  return s;
}

const CHECK_STATUS: Record<string, PaymentRequestStatus> = {
  "0000": "PENDING",
  "0110": "AUTHORIZED",
  "0121": "CANCELLED",
  "0122": "FAILED",
  "0123": "COMPLETED",
};

/**
 * LINE Pay Online API v4 client. Every method signs its request, keeps
 * transaction IDs as strings, and either returns `info` (returnCode 0000),
 * throws LinePayApiError (another returnCode), or throws
 * LinePayUnknownOutcomeError (no usable answer — reconcile before retrying
 * anything that moves money).
 */
export class LinePay {
  readonly host: string;
  private readonly o: LinePayOptions;
  private readonly fetchImpl: typeof fetch;
  private readonly timeouts: Record<Operation, number>;

  constructor(options: LinePayOptions) {
    if (!options.channelId || !options.channelSecret) throw new LinePayValidationError("channelId and channelSecret are required");
    if (options.env !== "sandbox" && options.env !== "production") throw new LinePayValidationError('env must be "sandbox" or "production"');
    this.o = options;
    this.host = options.env === "sandbox" ? "https://sandbox-api-pay.line.me" : "https://api-pay.line.me";
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts };
  }

  /** Sends one signed call and returns the raw envelope (returnCode checked by the caller). */
  private async send<T>(method: "GET" | "POST", apiPath: string, opts: { body?: unknown; query?: URLSearchParams; op?: Operation; movesMoney?: boolean }): Promise<Envelope<T>> {
    const nonce = createNonce();
    const body = method === "POST" ? JSON.stringify(opts.body ?? {}) : undefined;
    const query = opts.query?.toString() ?? "";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-LINE-ChannelId": this.o.channelId,
      "X-LINE-Authorization-Nonce": nonce,
      "X-LINE-Authorization": createSignature(this.o.channelSecret, apiPath, body ?? query, nonce),
    };
    if (this.o.merchantDeviceProfileId) headers["X-LINE-MerchantDeviceProfileId"] = this.o.merchantDeviceProfileId;
    if (this.o.merchantDeviceType) headers["X-LINE-MerchantDeviceType"] = this.o.merchantDeviceType;

    const movesMoney = opts.movesMoney ?? false;
    let text: string;
    try {
      const res = await this.fetchImpl(`${this.host}${apiPath}${query ? `?${query}` : ""}`, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(this.timeouts[opts.op ?? "default"]),
      });
      text = await res.text();
      if (!res.ok && !text.trim().startsWith("{")) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      throw new LinePayUnknownOutcomeError(apiPath, movesMoney, e);
    }
    try {
      const env = parseLossless<Envelope<T>>(text);
      if (typeof env?.returnCode !== "string") throw new Error("no returnCode");
      return env;
    } catch (e) {
      throw new LinePayUnknownOutcomeError(apiPath, movesMoney, e);
    }
  }

  private async call<T>(method: "GET" | "POST", apiPath: string, opts: { body?: unknown; query?: URLSearchParams; op?: Operation; movesMoney?: boolean } = {}): Promise<T> {
    const env = await this.send<T>(method, apiPath, opts);
    if (env.returnCode !== "0000") throw new LinePayApiError(env.returnCode, env.returnMessage, apiPath);
    return env.info as T;
  }

  /**
   * POST /v4/payments/request — start a payment. Send the customer to
   * `paymentUrl.web` (PC) or `paymentUrl.app` (mobile), and store
   * `transactionId` with your attempt before redirecting.
   */
  async requestPayment(request: PaymentRequest): Promise<PaymentRequestResult> {
    if (this.o.validate !== false) validatePaymentRequest(request);
    return this.call("POST", "/v4/payments/request", { body: request, op: "request" });
  }

  /**
   * GET /v4/payments/requests/{transactionId}/check — where a payment request
   * stands. Poll it (≥ 1 s apart) with confirmUrlType NONE, and use it to
   * reconcile a confirm whose outcome you don't know.
   */
  async checkPaymentRequest(transactionId: string | bigint): Promise<PaymentRequestStatus> {
    const path = `/v4/payments/requests/${txId(transactionId)}/check`;
    const env = await this.send<never>("GET", path, {});
    const status = CHECK_STATUS[env.returnCode];
    if (!status) throw new LinePayApiError(env.returnCode, env.returnMessage, path);
    return status;
  }

  /**
   * POST /v4/payments/{transactionId}/confirm — complete the payment after the
   * customer authenticated. `amount`/`currency` must equal the request's: take
   * them from your records, not from the confirmUrl.
   */
  async confirm(transactionId: string | bigint, payment: { amount: number; currency: Currency }): Promise<ConfirmResult> {
    return this.call("POST", `/v4/payments/${txId(transactionId)}/confirm`, { body: { amount: payment.amount, currency: payment.currency }, op: "confirm", movesMoney: true });
  }

  /** POST /v4/payments/authorizations/{transactionId}/capture — after a confirm with options.payment.capture = false. */
  async capture(transactionId: string | bigint, payment: { amount: number; currency: Currency }): Promise<CaptureResult> {
    return this.call("POST", `/v4/payments/authorizations/${txId(transactionId)}/capture`, {
      body: { amount: payment.amount, currency: payment.currency },
      op: "capture",
      movesMoney: true,
    });
  }

  /** POST /v4/payments/authorizations/{transactionId}/void — release an authorization that wasn't captured. */
  async void(transactionId: string | bigint): Promise<void> {
    await this.call("POST", `/v4/payments/authorizations/${txId(transactionId)}/void`, { movesMoney: true });
  }

  /**
   * POST /v4/payments/{transactionId}/refund — full refund, or partial with
   * `refundAmount`. On an unknown outcome, look for the refund in
   * getPaymentDetails().refundList before trying again.
   */
  async refund(transactionId: string | bigint, options: { refundAmount?: number } = {}): Promise<RefundResult> {
    const body = options.refundAmount === undefined ? {} : { refundAmount: options.refundAmount };
    return this.call("POST", `/v4/payments/${txId(transactionId)}/refund`, { body, movesMoney: true });
  }

  /** GET /v4/payments — payments by transaction IDs and/or order IDs (up to 100). */
  async getPaymentDetails(by: { transactionId?: (string | bigint)[]; orderId?: string[] }): Promise<PaymentDetail[]> {
    const q = new URLSearchParams();
    for (const id of by.transactionId ?? []) q.append("transactionId", txId(id));
    for (const id of by.orderId ?? []) q.append("orderId", id);
    if (![...q.keys()].length) throw new LinePayValidationError("getPaymentDetails needs transactionId or orderId");
    return this.call("GET", "/v4/payments", { query: q });
  }

  /** Pre-approved payments: a regKey from confirming a request with payType PREAPPROVED. */
  readonly preapproved = {
    /** GET /v4/payments/preapprovedPay/{regKey}/check */
    check: async (regKey: string, options: { creditCardAuth?: boolean } = {}): Promise<void> => {
      await this.call("GET", `/v4/payments/preapprovedPay/${encodeURIComponent(regKey)}/check`, {
        query: new URLSearchParams({ creditCardAuth: String(options.creditCardAuth ?? false) }),
      });
    },
    /** POST /v4/payments/preapprovedPay/{regKey}/payment — charge the customer without them present. */
    pay: async (regKey: string, payment: PreapprovedPaymentRequest): Promise<PreapprovedPaymentResult> =>
      this.call("POST", `/v4/payments/preapprovedPay/${encodeURIComponent(regKey)}/payment`, { body: payment, movesMoney: true }),
    /** POST /v4/payments/preapprovedPay/{regKey}/expire — discard the key. */
    discard: async (regKey: string): Promise<void> => {
      await this.call("POST", `/v4/payments/preapprovedPay/${encodeURIComponent(regKey)}/expire`);
    },
  };
}
