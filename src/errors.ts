import { resultCodeInfo, type ResultCategory } from "./codes.js";

/** Base class of everything this SDK throws. */
export class LinePayError extends Error {
  override name = "LinePayError";
}

/** LINE Pay answered with a returnCode other than success. */
export class LinePayApiError extends LinePayError {
  override name = "LinePayApiError";
  readonly returnCode: string;
  readonly returnMessage: string;
  readonly apiPath: string;
  /** How to react: retry / reconcile / customer / merchant (see resultCodeInfo). */
  readonly category: ResultCategory;
  constructor(returnCode: string, returnMessage: string, apiPath: string) {
    const info = resultCodeInfo(returnCode);
    super(`LINE Pay ${apiPath} → ${returnCode}: ${returnMessage || info.description}`);
    this.returnCode = returnCode;
    this.returnMessage = returnMessage;
    this.apiPath = apiPath;
    this.category = info.category;
  }
  /** Safe to send the same call again after a backoff. */
  get retryable(): boolean {
    return this.category === "retry";
  }
}

/**
 * The request may or may not have reached LINE Pay (timeout, network error,
 * non-JSON reply). For calls that move money (confirm, capture, refund,
 * pre-approved payment) the payment may have happened: read its state with
 * getPaymentDetails / checkPaymentRequest before retrying.
 */
export class LinePayUnknownOutcomeError extends LinePayError {
  override name = "LinePayUnknownOutcomeError";
  readonly apiPath: string;
  /** This call could have charged, captured or refunded money. */
  readonly movesMoney: boolean;
  constructor(apiPath: string, movesMoney: boolean, cause: unknown) {
    super(`LINE Pay ${apiPath}: no usable answer (${(cause as Error)?.message ?? cause}); the outcome is unknown${movesMoney ? " — reconcile before retrying" : ""}`, { cause });
    this.apiPath = apiPath;
    this.movesMoney = movesMoney;
  }
}

/** Rejected before sending: the request would fail (e.g. amounts that don't add up → 1124). */
export class LinePayValidationError extends LinePayError {
  override name = "LinePayValidationError";
}
