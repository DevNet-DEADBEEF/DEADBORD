import { View } from 'react-native';
import { TextField } from '@/components';
import { styles } from '@/styles';
import { defineMethod } from './types';

/** Shared template for credit_card and debit_card: number, CVV, expiry. */
export function cardMethod(type: 'credit_card' | 'debit_card', label: string) {
  return defineMethod({
    type,
    label,
    kind: 'form',
    initial: { number: '', cvv: '', exp: '' },
    Input: ({ value, onChange }) => (
      <View style={{ gap: 8 }}>
        <TextField
          placeholder="Card number"
          keyboardType="number-pad"
          maxLength={19}
          value={value.number}
          onChangeText={(number) => onChange({ ...value, number: number.replace(/\D/g, '') })}
        />
        <View style={styles.row}>
          <TextField
            placeholder="MM/YY"
            style={styles.grow}
            keyboardType="number-pad"
            maxLength={5}
            value={value.exp}
            onChangeText={(text) => {
              const digits = text.replace(/\D/g, '').slice(0, 4);
              onChange({ ...value, exp: digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits });
            }}
          />
          <TextField
            placeholder="CVV"
            style={styles.grow}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={4}
            value={value.cvv}
            onChangeText={(cvv) => onChange({ ...value, cvv: cvv.replace(/\D/g, '') })}
          />
        </View>
      </View>
    ),
    isValid: (v) => v.number.length >= 13 && /^(0[1-9]|1[0-2])\/\d\d$/.test(v.exp) && v.cvv.length >= 3,
    note: 'Use a test card number (e.g. 4242 4242 4242 4242), never a real card.',
  });
}
