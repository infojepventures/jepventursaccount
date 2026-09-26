import type { ClaimStatus } from '@jep/shared';
import { StyleSheet, Text, View } from 'react-native';
import { STATUS_STYLE, space } from './theme';

export function StatusBadge({ status }: { status: ClaimStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <View style={[styles.badge, { backgroundColor: s.bg }]}>
      <Text style={[styles.text, { color: s.fg }]}>{s.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { paddingHorizontal: space(2), paddingVertical: 2, borderRadius: 999, alignSelf: 'flex-start' },
  text: { fontSize: 12, fontWeight: '700' },
});
