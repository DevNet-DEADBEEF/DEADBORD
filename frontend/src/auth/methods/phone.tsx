import { TextField } from '@/components';
import { defineMethod } from './types';

/** Login with phone number. */
export default defineMethod({
  type: 'phone',
  label: 'Phone',
  kind: 'form',
  initial: { phone: '' },
  Input: ({ value, onChange }) => (
    <TextField
      placeholder="Phone number"
      keyboardType="phone-pad"
      autoComplete="tel"
      maxLength={20}
      value={value.phone}
      onChangeText={(phone) => onChange({ phone: phone.replace(/[^0-9+()\- ]/g, '') })}
    />
  ),
  isValid: (v) => v.phone.replace(/\D/g, '').length >= 10,
});
