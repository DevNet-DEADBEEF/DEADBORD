/**
 * Login with SSO: the user supplies an email, and its domain picks the
 * identity provider, which then runs as an ordinary OAuth login. Well-known
 * consumer domains are listed; for other domains the mail servers (MX
 * records) tell whether the organization uses Google Workspace or
 * Microsoft 365.
 */

import { Resolver } from 'node:dns/promises';
import type { ProviderName } from './oauth.js';

const DOMAINS: Record<string, ProviderName> = {
  'gmail.com': 'google',
  'googlemail.com': 'google',
  'outlook.com': 'microsoft',
  'hotmail.com': 'microsoft',
  'live.com': 'microsoft',
  'msn.com': 'microsoft',
};

const MX: [RegExp, ProviderName][] = [
  [/(^|\.)(google\.com|googlemail\.com)$/i, 'google'],
  [/(^|\.)(outlook\.com|office365\.us)$/i, 'microsoft'],
];

const resolver = new Resolver({ timeout: 3000, tries: 1 });

/** The provider that signs in `email`'s domain, if we can tell. */
export async function providerForEmail(email: string): Promise<ProviderName | undefined> {
  const domain = email.trim().toLowerCase().split('@')[1];
  if (!domain) return undefined;
  if (DOMAINS[domain]) return DOMAINS[domain];

  let records: { exchange: string }[];
  try {
    records = await resolver.resolveMx(domain);
  } catch {
    return undefined;
  }
  for (const { exchange } of records) {
    const match = MX.find(([pattern]) => pattern.test(exchange.replace(/\.$/, '')));
    if (match) return match[1];
  }
  return undefined;
}
