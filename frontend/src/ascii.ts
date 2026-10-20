/**
 * All text is ASCII only (see Notion: DB Layout/Schemas). Keyboards, iOS in
 * particular, insert typographic punctuation, so map the common ones to their
 * ASCII forms before dropping anything else.
 */

const REPLACEMENTS: Record<string, string> = {
  '‘': "'", '’': "'", '‚': "'", '′': "'",
  '“': '"', '”': '"', '„': '"', '″': '"',
  '–': '-', '—': '-', '−': '-',
  '…': '...',
  ' ': ' ', ' ': ' ', ' ': ' ',
};

/**
 * Converts text to ASCII: accents are stripped (é -> e), typographic
 * punctuation is mapped, and everything else non-ASCII is dropped. Single-line
 * text turns tabs and line breaks into spaces.
 */
export function toAscii(text: string, multiline = false): string {
  const allowed = multiline ? /[\x20-\x7E\t\r\n]/ : /[\x20-\x7E]/;
  const normalized = (multiline ? text : text.replace(/\r\n|[\t\r\n]/g, ' '))
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  let out = '';
  for (const ch of normalized) {
    const mapped = REPLACEMENTS[ch] ?? ch;
    for (const c of mapped) if (allowed.test(c)) out += c;
  }
  return out;
}
