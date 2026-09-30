/**
 * How to react to a LINE Pay result code.
 * - `retry`: transient; the same call may be sent again (new nonce) after a backoff.
 * - `reconcile`: the outcome is unclear or already happened — read the payment
 *   (getPaymentDetails / checkPaymentRequest) before doing anything else.
 * - `customer`: the buyer's side (card, balance, account, took too long).
 * - `merchant`: configuration or request bug on your side; retrying won't help.
 */
export type ResultCategory = "retry" | "reconcile" | "customer" | "merchant";

export type ResultCodeInfo = { code: string; description: string; category: ResultCategory };

const C: Record<string, [string, ResultCategory]> = {
  "1101": ["The customer isn't a LINE Pay user.", "customer"],
  "1102": ["The customer is currently unable to make transactions with LINE Pay.", "customer"],
  "1104": ["The merchant isn't registered on the merchant center. Check the credentials (and sandbox vs production host).", "merchant"],
  "1105": ["LINE Pay is currently unavailable for the merchant.", "merchant"],
  "1106": ["There is an error in the request header information (usually the signature).", "merchant"],
  "1110": ["The credit card cannot be used.", "customer"],
  "1124": ["There is an error in the amount information.", "merchant"],
  "1141": ["There is a problem with the account status (EPI not enabled, or the pre-approved key was discarded).", "customer"],
  "1142": ["The balance is insufficient.", "customer"],
  "1145": ["Payment is in progress.", "reconcile"],
  "1150": ["There are no transaction details.", "reconcile"],
  "1152": ["There is a duplicate transaction.", "reconcile"],
  "1153": ["The payment request amount and the capture amount differ.", "merchant"],
  "1154": ["The selected payment method for pre-approved payment isn't available.", "customer"],
  "1155": ["This is an invalid transaction ID.", "merchant"],
  "1159": ["There is no payment request information.", "reconcile"],
  "1163": ["Refund isn't available (refund period has expired).", "merchant"],
  "1164": ["Exceeded the refundable amount.", "reconcile"],
  "1165": ["The transaction has already been refunded.", "reconcile"],
  "1169": ["LINE Pay requires payment method selection and password authentication.", "customer"],
  "1170": ["The balance in the member's account has changed.", "customer"],
  "1172": ["Transaction details with the same order ID already exist.", "reconcile"],
  "1177": ["Exceeded the maximum number of transactions that can be retrieved (100).", "merchant"],
  "1178": ["The currency isn't supported by the merchant.", "merchant"],
  "1179": ["Cannot be processed at the moment.", "reconcile"],
  "1180": ["Payment time expired.", "customer"],
  "1183": ["Payment amount must exceed the minimum amount set.", "merchant"],
  "1184": ["Payment amount must not exceed the maximum amount set.", "merchant"],
  "1190": ["There is no pre-approved payment key.", "merchant"],
  "1193": ["Pre-approved payment key has expired.", "customer"],
  "1194": ["Pre-approved payment isn't available for this merchant.", "merchant"],
  "1198": ["API request is duplicated.", "reconcile"],
  "1199": ["Internal error occurred during the request.", "reconcile"],
  "1280": ["Temporary error occurred during credit card payment.", "customer"],
  "1281": ["Error occurred during credit card payment.", "customer"],
  "1282": ["Error occurred during credit card authorization.", "customer"],
  "1283": ["Payment was denied due to suspected fraudulent use.", "customer"],
  "1284": ["Credit card payment is temporarily suspended.", "customer"],
  "1285": ["Credit card payment information is missing.", "customer"],
  "1286": ["Credit card payment information is incorrect.", "customer"],
  "1287": ["Credit card expiration date has passed.", "customer"],
  "1288": ["Insufficient balance in the credit card account.", "customer"],
  "1289": ["Exceeded the credit card limit.", "customer"],
  "1290": ["Exceeded the per-transaction limit for credit card payments.", "customer"],
  "1291": ["This card is reported stolen.", "customer"],
  "1292": ["Card usage is suspended.", "customer"],
  "1293": ["CVN input error occurred.", "customer"],
  "1294": ["This card is on the blacklist.", "customer"],
  "1295": ["The credit card number is incorrect.", "customer"],
  "1296": ["This amount cannot be processed.", "customer"],
  "1298": ["Card use was declined.", "customer"],
  "2024": ["Exceeded the merchant's per-transaction, daily, or monthly limit for receiving payments.", "merchant"],
  "2042": ["Returned by the refund API (no public description).", "reconcile"],
  "2101": ["Parameter error occurred.", "merchant"],
  "2102": ["JSON data format error occurred.", "merchant"],
  "9000": ["Internal error occurred.", "reconcile"],
};

/** Description and handling category for a result code (`190X` = temporary, retry). */
export function resultCodeInfo(code: string): ResultCodeInfo {
  if (/^190\d$/.test(code)) return { code, description: "Temporary error occurred. Please try again later.", category: "retry" };
  const known = C[code];
  return known ? { code, description: known[0], category: known[1] } : { code, description: "Unknown result code.", category: "reconcile" };
}
