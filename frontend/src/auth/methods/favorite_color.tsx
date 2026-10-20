import { Palette } from 'lucide-react-native';
import { View } from 'react-native';
import { TextField } from '@/components';
import { styles } from '@/styles';
import { ColorPicker } from '../inputs/ColorPicker';
import { defineMethod } from './types';

const HEX = /^#[0-9a-f]{6}$/i;

/** Login with favorite color: a 24-bit hex color, from the picker or typed. */
export default defineMethod({
  type: 'favorite_color',
  label: 'Favorite Color',
  icon: Palette,
  kind: 'form',
  initial: { color: '#' },
  Input: ({ value, onChange }) => (
    <View style={{ gap: 8 }}>
      <ColorPicker color={value.color} onChange={(color) => onChange({ color })} />
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
    </View>
  ),
  isValid: (v) => HEX.test(v.color),
  toData: (v) => ({ color: v.color.toLowerCase() }),
  note: 'Logging in needs the exact color, so note its hex code.',
});
