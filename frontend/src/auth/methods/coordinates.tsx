import { MapPin } from 'lucide-react-native';
import { View } from 'react-native';
import { TextField } from '@/components';
import { styles } from '@/styles';
import { MapPicker } from '../inputs/MapPicker';
import { defineMethod } from './types';

const inRange = (text: string, limit: number) => text !== '' && Math.abs(Number(text)) <= limit;

/**
 * Login with coordinates: select a place on Earth and log in as the closest
 * user within 1 mile. Pick on the map or type the numbers.
 */
export default defineMethod({
  type: 'coordinates',
  label: 'Coordinates',
  icon: MapPin,
  kind: 'form',
  initial: { lat: '', lng: '' },
  Input: ({ value, onChange }) => (
    <View style={{ gap: 8 }}>
      <MapPicker
        value={inRange(value.lat, 90) && inRange(value.lng, 180) ? { lat: Number(value.lat), lng: Number(value.lng) } : undefined}
        onChange={({ lat, lng }) => onChange({ lat: String(lat), lng: String(lng) })}
      />
      <View style={styles.row}>
      <TextField
        placeholder="Latitude"
        style={styles.grow}
        keyboardType="numbers-and-punctuation"
        maxLength={12}
        value={value.lat}
        onChangeText={(lat) => onChange({ ...value, lat: lat.replace(/[^0-9.\-]/g, '') })}
      />
      <TextField
        placeholder="Longitude"
        style={styles.grow}
        keyboardType="numbers-and-punctuation"
        maxLength={12}
        value={value.lng}
        onChangeText={(lng) => onChange({ ...value, lng: lng.replace(/[^0-9.\-]/g, '') })}
      />
      </View>
    </View>
  ),
  isValid: (v) => inRange(v.lat, 90) && inRange(v.lng, 180),
  toData: (v) => ({ lat: Number(v.lat), lng: Number(v.lng) }),
  note: 'Logging in picks the closest user within 1 mile of the pin.',
});
