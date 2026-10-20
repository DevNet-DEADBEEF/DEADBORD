import { TextField } from '@/components';
import { defineMethod } from './types';

/** Login With Password: the password alone picks the user (collisions ask which user). */
export default defineMethod({
  type: 'password',
  label: 'Password',
  kind: 'form',
  initial: { password: '' },
  Input: ({ value, onChange, mode }) => (
    <TextField
      placeholder="Password"
      secureTextEntry
      autoCapitalize="none"
      autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
      maxLength={128}
      value={value.password}
      onChangeText={(password) => onChange({ password })}
    />
  ),
  isValid: (v, mode) => (mode === 'signup' ? v.password.length >= 8 : v.password.length >= 1),
  note: 'At least 8 characters.',
});
