import { Receipt } from 'lucide-react-native';
import { View } from 'react-native';
import { TextField } from '@/components';
import { styles } from '@/styles';
import { defineMethod } from './types';

/** Login with billing address (US addresses only). */
export default defineMethod({
  type: 'billing_address',
  label: 'Billing Address',
  icon: Receipt,
  kind: 'form',
  initial: { street: '', city: '', state: '', zip: '' },
  Input: ({ value, onChange }) => (
    <View style={{ gap: 8 }}>
      <TextField placeholder="Street" autoComplete="street-address" maxLength={100} value={value.street} onChangeText={(street) => onChange({ ...value, street })} />
      <TextField placeholder="City" maxLength={60} value={value.city} onChangeText={(city) => onChange({ ...value, city })} />
      <View style={styles.row}>
        <TextField
          placeholder="State"
          style={styles.grow}
          autoCapitalize="characters"
          maxLength={2}
          value={value.state}
          onChangeText={(state) => onChange({ ...value, state: state.replace(/[^A-Za-z]/g, '').toUpperCase() })}
        />
        <TextField
          placeholder="ZIP"
          style={styles.grow}
          keyboardType="number-pad"
          autoComplete="postal-code"
          maxLength={5}
          value={value.zip}
          onChangeText={(zip) => onChange({ ...value, zip: zip.replace(/\D/g, '') })}
        />
      </View>
    </View>
  ),
  isValid: (v) => !!v.street.trim() && !!v.city.trim() && v.state.length === 2 && v.zip.length === 5,
  note: 'Use a test address, not your real one.',
});
