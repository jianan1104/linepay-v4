/**
 * LINE Pay sends transaction IDs as bare 19-digit JSON numbers
 * (e.g. 2023042201206549310), beyond Number.MAX_SAFE_INTEGER. A plain
 * JSON.parse rounds them (…549200), which then targets the wrong
 * transaction or fails with 1150/1155.
 *
 * Before parsing, every integer of 16+ digits that is the value of a key
 * (`"…": 1234…`) or an array element is rewritten as a string. Amounts and
 * counts never get that long, and strings in the JSON are left untouched.
 */
export function parseLossless<T = unknown>(text: string): T {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i]!;
    if (c === '"') {
      // Copy a string literal verbatim, honouring escapes.
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === "-" || (c >= "0" && c <= "9")) {
      let j = i + 1;
      while (j < n && /[0-9eE+\-.]/.test(text[j]!)) j++;
      const num = text.slice(i, j);
      out += /^-?\d{16,}$/.test(num) ? `"${num}"` : num;
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return JSON.parse(out) as T;
}
