import { Mail } from 'lucide-react-native';
import { TextField } from '@/components';
import { defineMethod } from './types';

/** Login with email: sends a verification email. */
export default defineMethod({
  type: 'email',
  label: 'Email',
  icon: Mail,
  kind: 'form',
  initial: { email: '' },
  Input: ({ value, onChange }) => (
    <TextField
      placeholder="Email"
      keyboardType="email-address"
      autoCapitalize="none"
      autoComplete="email"
      maxLength={254}
      value={value.email}
      onChangeText={(email) => onChange({ email })}
    />
  ),
  isValid: (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email),
  note: "We'll email you a 6-digit code.",
});
