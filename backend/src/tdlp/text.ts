/**
 * DEADBORD text inside TLON values. TLON only carries printable ASCII, so
 * backslashes, line breaks and tabs are escaped as \\ \n \r \t. Length
 * limits (TEXT_MAX etc.) count the escaped form. Mirrored by
 * frontend/src/api/text.ts.
 */

const ESCAPES: Record<string, string> = { '\\': '\\\\', '\n': '\\n', '\r': '\\r', '\t': '\\t' };
const UNESCAPES: Record<string, string> = { '\\': '\\', n: '\n', r: '\r', t: '\t' };

export function escapeText(text: string): string {
  return text.replace(/[\\\n\r\t]/g, (c) => ESCAPES[c]);
}

/** Undefined if `wire` has an unknown or unfinished escape. */
export function unescapeText(wire: string): string | undefined {
  let valid = true;
  const text = wire.replace(/\\(.?)/g, (_, c: string) => {
    const plain = UNESCAPES[c];
    if (plain === undefined) valid = false;
    return plain ?? '';
  });
  return valid ? text : undefined;
}
