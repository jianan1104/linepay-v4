// Request and response shapes of the LINE Pay Online API v4.
// Transaction IDs are always strings in what this SDK returns.

export type Currency = "TWD" | "USD" | "THB";

/** A transaction ID as LINE Pay issued it: 19 digits. Pass it as a string (or bigint), never a number. */
export type TransactionId = string;

export type Product = {
  /** ≤ 50 chars */
  id?: string;
  /** ≤ 4000 chars */
  name: string;
  /** ≤ 500 chars */
  imageUrl?: string;
  quantity: number;
  price: number;
  originalPrice?: number;
};

export type Package = {
  /** ≤ 50 chars */
  id: string;
  /** Must equal Σ products[].price × quantity. */
  amount: number;
  /** Package or shipping merchant name (≤ 100 chars). */
  name?: string;
  products: Product[];
};

export type RedirectUrls = {
  /** Where LINE Pay sends the customer (or calls, with SERVER) after authentication. It appends transactionId and orderId. */
  confirmUrl?: string;
  /** Where the customer lands after cancelling. */
  cancelUrl?: string;
  /** CLIENT (default): the customer's browser is redirected. SERVER: LINE Pay's server calls confirmUrl. NONE: no redirect — poll checkPaymentRequest. */
  confirmUrlType?: "CLIENT" | "SERVER" | "NONE";
  /** Android: the exact package name of the app to return to (anti-phishing). */
  appPackageName?: string;
};

export type RegPayRequest = {
  regPayPeriodType?: "RECURRING" | "NON_RECURRING";
  recurringPeriod?: "WEEK" | "MONTH" | "YEAR" | null;
  recurringDay?: number | null;
  recurringDayOfWeek?: "SUN" | "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | null;
  recurringMonth?: number | null;
  productPrice?: number;
  perTransactionLimit?: number;
};

export type PaymentRequestOptions = {
  payment?: {
    /** true (default): confirm also captures. false: confirm only authorizes; capture or void later. */
    capture?: boolean;
    payType?: "NORMAL" | "PREAPPROVED";
  };
  display?: {
    /** Language of the LINE Pay pages; default "en". */
    locale?: "en" | "ja" | "ko" | "th" | "zh_TW" | "zh_CN";
    /** Ask the customer to return to the browser where they started. */
    checkConfirmUrlBrowser?: boolean;
  };
  extra?: {
    branchId?: string;
    branchName?: string;
    /** TW only: amounts promotions can't apply to. */
    promotionRestriction?: { rewardLimit: number; useLimit?: number };
  };
  events?: { code: string; productQuantity?: number | null; totalAmount?: number | null }[];
  regPayRequest?: RegPayRequest;
};

export type PaymentRequest = {
  /** Must equal Σ packages[].amount. */
  amount: number;
  currency: Currency;
  /** Your order ID for this attempt (≤ 100 chars). Reusing one returns 1172 — make it unique per attempt. */
  orderId: string;
  packages: Package[];
  redirectUrls: RedirectUrls;
  options?: PaymentRequestOptions;
};

export type PaymentRequestResult = {
  transactionId: TransactionId;
  /** Code the customer can type into the LINE Pay app instead of scanning. Treat as sensitive. */
  paymentAccessToken: string;
  paymentUrl: {
    /** PC: redirect or open as a 700×546 popup. */
    web: string;
    /** Mobile deep link into the LINE app's payment screen. */
    app: string;
  };
};

export type PayInfo = {
  method: string;
  amount: number;
  creditCardNickname?: string;
  creditCardBrand?: string;
  maskedCreditCardNumber?: string;
};

export type ConfirmResult = {
  orderId: string;
  transactionId: TransactionId;
  /** "TSP" or "EPI". */
  paymentProvider?: string;
  payInfo: PayInfo[];
  /** Pre-approved payments: the key for later charges. Store it like a credential. */
  regKey?: string;
  /** Separate capture: when the authorization lapses (ISO 8601). */
  authorizationExpireDate?: string;
};

export type CaptureResult = {
  orderId: string;
  transactionId: TransactionId;
  paymentProvider?: string;
  payInfo: PayInfo[];
};

export type RefundResult = {
  refundTransactionId: TransactionId;
  /** ISO 8601 */
  refundTransactionDate: string;
};

export type PaymentDetail = {
  transactionId: TransactionId;
  transactionDate: string;
  /** e.g. "PAYMENT" for the payment itself. */
  transactionType: string;
  orderId: string;
  productName?: string;
  currency: Currency;
  paymentProvider?: string;
  payInfo: PayInfo[];
  /**
   * Refunds so far. As the sandbox returns them: `refundAmount` is NEGATIVE
   * (e.g. -20). `transactionType` is "PAYMENT_REFUND" for a single refund of
   * the whole amount and "PARTIAL_REFUND" for each one otherwise (even the
   * one that uses up the rest), so don't infer "fully refunded" from it: add
   * up the amounts with Math.abs and compare with the payment.
   */
  refundList?: { refundTransactionId: TransactionId; transactionType?: string; refundAmount: number; refundTransactionDate: string }[];
  packages?: { id: string; amount: number; name?: string }[];
  [key: string]: unknown;
};

/**
 * Where a payment request stands (GET …/requests/{id}/check):
 * PENDING (0000) customer hasn't finished · AUTHORIZED (0110) ready to confirm ·
 * CANCELLED (0121) cancelled or timed out · FAILED (0122) · COMPLETED (0123) already confirmed.
 */
export type PaymentRequestStatus = "PENDING" | "AUTHORIZED" | "CANCELLED" | "FAILED" | "COMPLETED";

export type PreapprovedPaymentRequest = {
  amount: number;
  currency: Currency;
  orderId: string;
  productName?: string;
  capture?: boolean;
};

export type PreapprovedPaymentResult = {
  transactionId: TransactionId;
  transactionDate: string;
  paymentProvider?: string;
};
