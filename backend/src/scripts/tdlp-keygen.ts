/**
 * Makes the TDLP RSA key pair: the server's private key (TDLP_PRIVATE_KEY_FILE,
 * default backend/tdlp-private.pem) and the public key the desktop app is
 * built with (frontend/electron/tdlp-public.pem). Clients only work with the
 * server whose key they were built with, so this refuses to replace an
 * existing private key unless given --force.
 *
 *   npm run tdlp:keygen [-- --force]
 */

import { generateKeyPairSync } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const privatePath = resolve(process.env.TDLP_PRIVATE_KEY_FILE ?? 'tdlp-private.pem');
const publicPath = join(dirname(fileURLToPath(import.meta.url)), '../../../frontend/electron/tdlp-public.pem');

if (existsSync(privatePath) && !process.argv.includes('--force')) {
  console.error(`${privatePath} already exists; pass --force to replace it (existing desktop builds will stop connecting).`);
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
writeFileSync(privatePath, privateKey, { mode: 0o600 });
writeFileSync(publicPath, publicKey);
console.log(`Private key: ${privatePath}\nPublic key:  ${publicPath}`);
