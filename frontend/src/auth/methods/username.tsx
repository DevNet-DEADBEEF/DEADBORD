import { User } from 'lucide-react-native';
import { TextField } from '@/components';
import { defineMethod } from './types';

/** Login With Username: no password required. */
export default defineMethod({
  type: 'username',
  label: 'Username',
  icon: User,
  kind: 'form',
  initial: { username: '' },
  Input: ({ value, onChange }) => (
    <TextField
      placeholder="Username"
      autoCapitalize="none"
      autoComplete="username"
      maxLength={32}
      value={value.username}
      onChangeText={(username) => onChange({ username })}
    />
  ),
  isValid: (v) => v.username.length >= 1,
});
