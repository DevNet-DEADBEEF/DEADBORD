import { Clover } from 'lucide-react-native';
import { defineMethod } from './types';

/** I'm feeling lucky: log in as a randomly selected user. */
export default defineMethod({
  type: 'lucky',
  label: "I'm Feeling Lucky",
  icon: Clover,
  kind: 'form',
  initial: {},
  isValid: () => true,
  note: 'Logs you in as a randomly selected user.',
  signup: false,
});
