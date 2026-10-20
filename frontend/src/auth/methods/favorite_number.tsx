import { TextField } from '@/components';
import { defineMethod } from './types';

/** Login with favorite number. */
export default defineMethod({
  type: 'favorite_number',
  label: 'Favorite Number',
  kind: 'form',
  initial: { number: '' },
  Input: ({ value, onChange }) => (
    <TextField
      placeholder="Favorite number"
      keyboardType="numbers-and-punctuation"
      maxLength={32}
      value={value.number}
      onChangeText={(number) => onChange({ number: number.replace(/[^0-9.\-]/g, '') })}
    />
  ),
  isValid: (v) => v.number !== '' && Number.isFinite(Number(v.number)),
  toData: (v) => ({ number: Number(v.number) }),
});
