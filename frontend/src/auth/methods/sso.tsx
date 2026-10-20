import { TextField } from '@/components';
import { defineMethod } from './types';

/** Login with SSO: the email's domain picks the identity provider. */
export default defineMethod({
  type: 'sso',
  label: 'SSO',
  kind: 'form',
  initial: { email: '' },
  Input: ({ value, onChange }) => (
    <TextField
      placeholder="Work email"
      keyboardType="email-address"
      autoCapitalize="none"
      autoComplete="email"
      maxLength={254}
      value={value.email}
      onChangeText={(email) => onChange({ email })}
    />
  ),
  isValid: (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email),
  note: "You'll continue at your organization's sign-in page.",
});
