import { View } from 'react-native';
import { TextField } from '@/components';
import { styles } from '@/styles';
import { defineMethod } from './types';

const HEX = /^#[0-9a-f]{6}$/i;

/** Login with favorite color: a 24-bit hex color. TODO: a real color picker. */
export default defineMethod({
  type: 'favorite_color',
  label: 'Favorite Color',
  kind: 'form',
  initial: { color: '#' },
  Input: ({ value, onChange }) => (
    <View style={styles.row}>
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: '#ccc',
          backgroundColor: HEX.test(value.color) ? value.color : 'transparent',
        }}
      />
      <TextField
        placeholder="#1e90ff"
        style={styles.grow}
        autoCapitalize="none"
        maxLength={7}
        value={value.color}
        onChangeText={(text) => onChange({ color: `#${text.replace(/[^0-9a-f]/gi, '').slice(0, 6)}` })}
      />
    </View>
  ),
  isValid: (v) => HEX.test(v.color),
  toData: (v) => ({ color: v.color.toLowerCase() }),
});
