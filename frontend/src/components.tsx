import { createContext, useContext, useState, type ComponentType, type ReactNode } from 'react';
import { Pressable, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { toAscii } from '@/ascii';
import { DANGER, INK, PLACEHOLDER, styles } from '@/styles';

export interface ButtonProps {
  label: string;
  onPress(): void;
  disabled?: boolean;
  /** 'danger' for destructive actions (delete, remove). */
  tone?: 'default' | 'danger';
  size?: 'normal' | 'small';
  /** Stays filled, e.g. the chosen option in a group. */
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Drawn before the label, in the label's color (e.g. a lucide-react-native icon). */
  icon?: ComponentType<{ size?: number; color?: string }>;
}

/**
 * The one button style: a rounded square outline that fills while hovered
 * (web) or pressed (touch), and while `selected`.
 */
export function Button({ label, onPress, disabled, tone = 'default', size = 'normal', selected, style, icon: Icon }: ButtonProps) {
  const [hovered, setHovered] = useState(false);
  const color = tone === 'danger' ? DANGER : INK;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      style={({ pressed }) => [
        styles.button,
        size === 'small' && styles.buttonSmall,
        { borderColor: color },
        (selected || (!disabled && (hovered || pressed))) && { backgroundColor: color },
        disabled && styles.disabled,
        style,
      ]}
    >
      {({ pressed }) => {
        const textColor = selected || (!disabled && (hovered || pressed)) ? '#fff' : color;
        const text = <Text style={[styles.buttonText, { color: textColor }]}>{label}</Text>;
        if (!Icon) return text;
        return (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon size={size === 'small' ? 15 : 17} color={textColor} />
            {text}
          </View>
        );
      }}
    </Pressable>
  );
}

/** One option in a group (method grid, blood type, permissions): a Button that stays filled when chosen. */
export function Choice({
  label,
  selected,
  onPress,
  style,
  icon,
}: {
  label: string;
  selected: boolean;
  onPress(): void;
  style?: StyleProp<ViewStyle>;
  icon?: ButtonProps['icon'];
}) {
  return <Button label={label} selected={selected} onPress={onPress} size="small" style={style} icon={icon} />;
}

const SubmitContext = createContext<(() => void) | undefined>(undefined);

/**
 * Pressing Enter in a single-line TextField inside calls `onSubmit`, unless
 * the field has its own onSubmitEditing. For forms whose fields don't know
 * the form, such as a login method's inputs. `onSubmit` checks validity.
 */
export function SubmitScope({ onSubmit, children }: { onSubmit(): void; children: ReactNode }) {
  return <SubmitContext.Provider value={onSubmit}>{children}</SubmitContext.Provider>;
}

/**
 * Text input that only ever produces ASCII (see ascii.ts), within maxLength.
 * Enter submits single-line fields: onSubmitEditing, or the SubmitScope's.
 */
export function TextField({ onChangeText, maxLength, multiline, style, onSubmitEditing, ...props }: TextInputProps) {
  const scoped = useContext(SubmitContext);
  return (
    <TextInput
      placeholderTextColor={PLACEHOLDER}
      {...props}
      style={[styles.input, style]}
      multiline={multiline}
      maxLength={maxLength}
      onSubmitEditing={onSubmitEditing ?? (multiline || !scoped ? undefined : () => scoped())}
      onChangeText={(text) => {
        const ascii = toAscii(text, multiline);
        onChangeText?.(maxLength === undefined ? ascii : ascii.slice(0, maxLength));
      }}
    />
  );
}
