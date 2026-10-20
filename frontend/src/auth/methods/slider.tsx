import { Text, View } from 'react-native';
import { Choice } from '@/components';
import { styles } from '@/styles';
import { defineMethod } from './types';

/**
 * Login with slider: a giant looping, zigzagging slider.
 * TODO: the real slider. Until then, step a position from 0 to 1000.
 */
export default defineMethod({
  type: 'slider',
  label: 'Slider',
  kind: 'form',
  initial: { position: 500 },
  Input: ({ value, onChange }) => {
    const step = (delta: number) => onChange({ position: Math.min(1000, Math.max(0, value.position + delta)) });
    return (
      <View style={[styles.row, { justifyContent: 'center' }]}>
        <Choice label="-10" selected={false} onPress={() => step(-10)} />
        <Choice label="-1" selected={false} onPress={() => step(-1)} />
        <Text style={[styles.heading, { minWidth: 60, textAlign: 'center' }]}>{value.position}</Text>
        <Choice label="+1" selected={false} onPress={() => step(1)} />
        <Choice label="+10" selected={false} onPress={() => step(10)} />
      </View>
    );
  },
  isValid: () => true,
  note: 'Placeholder for the giant looping, zigzagging slider.',
});
