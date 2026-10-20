import { TextField } from '@/components';
import { defineMethod } from './types';

/** Login with PIN. */
export default defineMethod({
  type: 'pin',
  label: 'PIN',
  kind: 'form',
  initial: { pin: '' },
  Input: ({ value, onChange }) => (
    <TextField
      placeholder="PIN"
      keyboardType="number-pad"
      secureTextEntry
      maxLength={8}
      value={value.pin}
      onChangeText={(pin) => onChange({ pin: pin.replace(/\D/g, '') })}
    />
  ),
  isValid: (v) => v.pin.length >= 4,
  note: '4 to 8 digits.',
});
