import { Text, View } from 'react-native';
import { Button, TextField } from '@/components';
import { styles } from '@/styles';

/** Email logins: the code we emailed. */
export function CodeEntry({
  to,
  code,
  onChange,
  onResend,
  busy,
}: {
  to: string;
  code: string;
  onChange(code: string): void;
  onResend(): void;
  busy: boolean;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.muted}>We emailed a 6-digit code to {to}. It expires in 10 minutes.</Text>
      <View style={styles.row}>
        <TextField
          placeholder="123456"
          style={styles.grow}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChangeText={(text) => onChange(text.replace(/\D/g, ''))}
        />
        <Button label="Resend" size="small" disabled={busy} onPress={onResend} />
      </View>
    </View>
  );
}
