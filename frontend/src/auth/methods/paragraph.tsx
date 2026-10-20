import { TextField } from '@/components';
import { TEXT_MAX } from '@/api/types';
import { defineMethod } from './types';

/** Login with paragraph: an LLM decides which user you are. */
export default defineMethod({
  type: 'paragraph',
  label: 'Paragraph',
  kind: 'form',
  initial: { paragraph: '' },
  Input: ({ value, onChange, mode }) => (
    <TextField
      placeholder={mode === 'signup' ? 'Write a paragraph about yourself' : 'Describe yourself'}
      multiline
      maxLength={TEXT_MAX}
      style={{ minHeight: 100, textAlignVertical: 'top' }}
      value={value.paragraph}
      onChangeText={(paragraph) => onChange({ paragraph })}
    />
  ),
  isValid: (v) => v.paragraph.trim().split(/\s+/).length >= 5,
  note: 'An LLM decides which user you are.',
});
