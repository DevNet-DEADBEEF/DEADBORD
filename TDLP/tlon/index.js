/** TLON is a sequence of terminated entries, each containing separated ASCII values. */
export function encode(entries) {
  if (!Array.isArray(entries)) throw new TypeError('Expected TLON entries');
  return Buffer.from(entries.map(entry => {
    if (!Array.isArray(entry) || entry.length === 0) throw new TypeError('Each entry needs at least one value');
    return entry.map(value => {
      if (typeof value !== 'string' || /[^\x20-\x7e]/.test(value)) throw new TypeError('TLON values must be printable ASCII');
      return value;
    }).join('\x1e') + '\x1f';
  }).join(''), 'ascii');
}

export function decode(data) {
  const bytes = Buffer.from(data);
  for (const byte of bytes) if (byte !== 30 && byte !== 31 && (byte < 32 || byte > 126)) throw new TypeError('Invalid TLON byte');
  if (!bytes.length) return [];
  if (bytes.at(-1) !== 31) throw new TypeError('Unterminated TLON entry');
  return bytes.toString('ascii').slice(0, -1).split('\x1f').map(entry => entry.split('\x1e'));
}
