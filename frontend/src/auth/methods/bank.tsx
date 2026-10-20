import { View } from 'react-native';
import { TextField } from '@/components';
import { defineMethod } from './types';

/** Login with bank: account and routing number. */
export default defineMethod({
  type: 'bank',
  label: 'Bank',
  kind: 'form',
  initial: { account: '', routing: '' },
  Input: ({ value, onChange }) => (
    <View style={{ gap: 8 }}>
      <TextField
        placeholder="Routing number"
        keyboardType="number-pad"
        maxLength={9}
        value={value.routing}
        onChangeText={(routing) => onChange({ ...value, routing: routing.replace(/\D/g, '') })}
      />
      <TextField
        placeholder="Account number"
        keyboardType="number-pad"
        maxLength={17}
        value={value.account}
        onChangeText={(account) => onChange({ ...value, account: account.replace(/\D/g, '') })}
      />
    </View>
  ),
  isValid: (v) => v.routing.length === 9 && v.account.length >= 4,
  note: 'Use test numbers, never a real account.',
});
