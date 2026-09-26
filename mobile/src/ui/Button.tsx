import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space } from './theme';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const VARIANTS: Record<Variant, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.primary, fg: colors.primaryText, border: colors.primary },
  secondary: { bg: colors.card, fg: colors.text, border: colors.border },
  danger: { bg: colors.card, fg: colors.danger, border: colors.danger },
  ghost: { bg: 'transparent', fg: colors.text, border: 'transparent' },
};

export function Button(p: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const v = VARIANTS[p.variant ?? 'primary'];
  const disabled = p.disabled || p.loading;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={p.onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: v.bg, borderColor: v.border, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
      ]}
    >
      {p.loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <View style={styles.row}>
          {p.icon ? <Ionicons name={p.icon} size={18} color={v.fg} /> : null}
          <Text style={[styles.text, { color: v.fg }]}>{p.title}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: 48, borderRadius: radius, borderWidth: 1, paddingHorizontal: space(4), justifyContent: 'center', alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  text: { fontSize: 16, fontWeight: '600' },
});
