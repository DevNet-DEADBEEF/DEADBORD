import { Droplet } from 'lucide-react-native';
import { View } from 'react-native';
import { Choice } from '@/components';
import { styles } from '@/styles';
import { defineMethod } from './types';

const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

/** Login with blood type. */
export default defineMethod({
  type: 'blood_type',
  label: 'Blood Type',
  icon: Droplet,
  kind: 'form',
  initial: { bloodType: '' },
  Input: ({ value, onChange }) => (
    <View style={[styles.row, { flexWrap: 'wrap' }]}>
      {BLOOD_TYPES.map((t) => (
        <Choice key={t} label={t} selected={value.bloodType === t} onPress={() => onChange({ bloodType: t })} style={{ minWidth: 56 }} />
      ))}
    </View>
  ),
  isValid: (v) => BLOOD_TYPES.includes(v.bloodType),
});
