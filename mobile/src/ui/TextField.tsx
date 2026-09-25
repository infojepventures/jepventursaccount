import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { colors, radius, space } from './theme';

export function TextField({ label, error, style, ...rest }: TextInputProps & { label: string; error?: string | null }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        style={[styles.input, rest.multiline ? styles.multi : null, error ? { borderColor: colors.danger } : null, style]}
        {...rest}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space(1) },
  label: { fontSize: 13, color: colors.muted, fontWeight: '500' },
  input: {
    minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius, backgroundColor: colors.card,
    paddingHorizontal: space(3), fontSize: 16, color: colors.text,
  },
  multi: { minHeight: 96, paddingTop: space(3), textAlignVertical: 'top' },
  error: { fontSize: 12, color: colors.danger },
});
