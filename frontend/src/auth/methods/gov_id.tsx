import { IdCard } from 'lucide-react-native';
import { TextField } from '@/components';
import { defineMethod } from './types';

/** Login with government ID: picks a random user enrolled with a government ID. */
export default defineMethod({
  type: 'gov_id',
  label: 'Government ID',
  icon: IdCard,
  kind: 'form',
  initial: { idNumber: '' },
  Input: ({ value, onChange }) => (
    <TextField
      placeholder="ID number"
      autoCapitalize="characters"
      maxLength={20}
      value={value.idNumber}
      onChangeText={(idNumber) => onChange({ idNumber: idNumber.replace(/[^A-Za-z0-9]/g, '') })}
    />
  ),
  isValid: (v) => v.idNumber.length >= 4,
  note: 'Logs you in as a random user enrolled with a government ID. Use a test number, not a real ID.',
});
