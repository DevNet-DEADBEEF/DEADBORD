import { SlidersHorizontal } from 'lucide-react-native';
import { Text, View } from 'react-native';
import { Choice } from '@/components';
import { styles } from '@/styles';
import { ZigzagSlider } from '../inputs/ZigzagSlider';
import { defineMethod } from './types';

/** Login with slider: a giant looping, zigzagging slider (0-1000). */
export default defineMethod({
  type: 'slider',
  label: 'Slider',
  icon: SlidersHorizontal,
  kind: 'form',
  initial: { position: 0 },
  Input: ({ value, onChange }) => {
    const step = (delta: number) => onChange({ position: Math.min(1000, Math.max(0, value.position + delta)) });
    return (
      <View style={{ gap: 8 }}>
        <ZigzagSlider position={value.position} onChange={(position) => onChange({ position })} />
        <View style={[styles.row, { justifyContent: 'center' }]}>
          <Choice label="-1" selected={false} onPress={() => step(-1)} />
          <Text style={[styles.heading, { minWidth: 60, textAlign: 'center' }]}>{value.position}</Text>
          <Choice label="+1" selected={false} onPress={() => step(1)} />
        </View>
      </View>
    );
  },
  isValid: () => true,
  note: 'Drag the thumb along the track. Logging in needs the exact position.',
});
