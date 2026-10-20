import { SlidersHorizontal } from 'lucide-react-native';
import { Text, View } from 'react-native';
import { styles } from '@/styles';
import { ZigzagSlider } from '../inputs/ZigzagSlider';
import { defineMethod } from './types';

/** Login with slider: a giant looping, zigzagging slider (0-1000, three decimal places). */
export default defineMethod({
  type: 'slider',
  label: 'Slider',
  icon: SlidersHorizontal,
  kind: 'form',
  initial: { position: 0 },
  Input: ({ value, onChange }) => (
    <View style={{ gap: 8 }}>
      <ZigzagSlider position={value.position} onChange={(position) => onChange({ position })} />
      <Text style={[styles.heading, { textAlign: 'center', fontVariant: ['tabular-nums'] }]}>{value.position.toFixed(3)}</Text>
    </View>
  ),
  isValid: () => true,
  note: 'Drag the thumb along the track. Logging in needs the exact position, to three decimal places.',
});
