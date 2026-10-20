/**
 * Text inside TLON values. TLON only carries printable ASCII, so backslashes,
 * line breaks and tabs are escaped as \\ \n \r \t, and length limits count
 * the escaped form. Mirrors backend/src/tdlp/text.ts.
 */

const ESCAPES: Record<string, string> = { '\\': '\\\\', '\n': '\\n', '\r': '\\r', '\t': '\\t' };
const UNESCAPES: Record<string, string> = { '\\': '\\', n: '\n', r: '\r', t: '\t' };

export function escapeText(text: string): string {
  return text.replace(/[\\\n\r\t]/g, (c) => ESCAPES[c]);
}

/** Unknown escapes are dropped. */
export function unescapeText(wire: string): string {
  return wire.replace(/\\(.?)/g, (_, c: string) => UNESCAPES[c] ?? '');
}

/** Length as the server counts it. */
export function wireLength(text: string): number {
  return escapeText(text).length;
}
