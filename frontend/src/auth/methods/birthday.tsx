import { Cake } from 'lucide-react-native';
import { DateField } from '@/DateField';
import { defineMethod } from './types';

const OLDEST = new Date(1900, 0, 1);

function isoDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Login with birthday. */
export default defineMethod<{ birthday: Date | undefined }>({
  type: 'birthday',
  label: 'Birthday',
  icon: Cake,
  kind: 'form',
  initial: { birthday: undefined },
  Input: ({ value, onChange }) => (
    <DateField
      placeholder="Birthday"
      value={value.birthday}
      onChange={(birthday) => onChange({ birthday })}
      minimumDate={OLDEST}
      maximumDate={new Date()}
    />
  ),
  isValid: (v) => v.birthday !== undefined,
  toData: (v) => ({ birthday: v.birthday ? isoDay(v.birthday) : undefined }),
});
