import { ShieldQuestionMark } from 'lucide-react-native';
import { View } from 'react-native';
import { TextField } from '@/components';
import { defineMethod } from './types';

/** Login with security question: the user supplies both question and answer. */
export default defineMethod({
  type: 'security_question',
  label: 'Security Question',
  icon: ShieldQuestionMark,
  kind: 'form',
  initial: { question: '', answer: '' },
  Input: ({ value, onChange }) => (
    <View style={{ gap: 8 }}>
      <TextField placeholder="Question (must end with ?)" maxLength={200} value={value.question} onChangeText={(question) => onChange({ ...value, question })} />
      <TextField placeholder="Answer" autoCapitalize="none" maxLength={200} value={value.answer} onChangeText={(answer) => onChange({ ...value, answer })} />
    </View>
  ),
  isValid: (v) => v.question.trim().endsWith('?') && v.question.trim().length > 1 && v.answer.trim().length > 0,
});
