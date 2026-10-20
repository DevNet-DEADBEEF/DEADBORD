import { StyleSheet } from 'react-native';
import { fromTimestamp, type Timestamp } from '@/epoch';

export const INK = '#222';
export const DANGER = '#c0392b';
/** Placeholder text in inputs. */
export const PLACEHOLDER = '#b0b0b0';

export const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16, gap: 12, backgroundColor: '#fff' },
  title: { fontSize: 22, fontWeight: '600' },
  heading: { fontSize: 18, fontWeight: '600' },
  muted: { color: '#666' },
  danger: { color: '#c0392b' },
  error: { color: '#c0392b' },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 10 },
  /** For inputs inside a `row`: take the remaining width. */
  grow: { flexGrow: 1, flexShrink: 1 },
  /** Every button: a rounded square outline, filled while hovered or pressed (see Button). */
  button: {
    borderWidth: 1,
    borderColor: INK,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  buttonSmall: { paddingVertical: 6, paddingHorizontal: 10 },
  buttonText: { color: INK, fontWeight: '600', textAlign: 'center' },
  disabled: { opacity: 0.4 },
  /** Centered, width-capped page content (inside a ScrollView's contentContainerStyle). */
  page: { width: '100%', maxWidth: 760, alignSelf: 'center', padding: 16, gap: 12 },
  divider: { borderBottomWidth: 1, borderBottomColor: '#e5e5e5' },
  card: { borderWidth: 1, borderColor: '#e5e5e5', borderRadius: 8, padding: 12, gap: 4 },
});

export function formatDateTime(ts: Timestamp): string {
  return fromTimestamp(ts).toLocaleString();
}
