import { Ionicons } from '@expo/vector-icons';
import { formatRM } from '@jep/shared';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ClaimSummary } from '../claims/claimSummary';
import { colors, radius, space } from '../ui/theme';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Summary above the item tabs: total, counts, payee, and whether the claim is ready to submit. */
export function ClaimSummaryCard({ summary: s, onJumpToItem }: { summary: ClaimSummary; onJumpToItem: (key: string) => void }) {
  const firstIncomplete = s.incompleteItems[0];
  return (
    <View style={styles.card}>
      <Text style={styles.label}>Claim total</Text>
      <Text style={styles.total}>{formatRM(s.totalCents)}</Text>
      <Text style={styles.meta}>
        {plural(s.itemCount, 'item')} · {plural(s.receiptCount, 'receipt')}
        {s.payee ? ` · Pay to ${s.payee}` : ''}
      </Text>

      <View style={styles.divider} />

      {s.ready ? (
        <View style={styles.row}>
          <Ionicons name="checkmark-circle" size={16} color={colors.success} />
          <Text style={[styles.status, { color: colors.success }]}>Ready to submit</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {s.busyReceipts ? (
            <View style={styles.row}>
              <ActivityIndicator size={14} color={colors.muted} />
              <Text style={styles.status}>Reading {plural(s.busyReceipts, 'receipt')}…</Text>
            </View>
          ) : null}
          {s.issues.map((issue) => {
            const jumps = firstIncomplete !== undefined && issue.startsWith('Item');
            return (
              <Pressable
                key={issue}
                disabled={!jumps}
                onPress={() => firstIncomplete && onJumpToItem(firstIncomplete.key)}
                style={styles.row}
                accessibilityRole={jumps ? 'button' : undefined}
              >
                <Ionicons name="alert-circle" size={16} color={colors.warning} />
                <Text style={[styles.status, { color: colors.warning }]}>{issue}</Text>
                {jumps ? <Ionicons name="chevron-forward" size={14} color={colors.warning} /> : null}
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius, borderWidth: 1, borderColor: colors.border, padding: space(4), gap: 2 },
  label: { fontSize: 13, fontWeight: '700', letterSpacing: 0.6, color: colors.muted, textTransform: 'uppercase' },
  total: { fontSize: 30, fontWeight: '800', color: colors.text, marginTop: space(1) },
  meta: { fontSize: 13, color: colors.muted },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: space(3) },
  list: { gap: space(2) },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  status: { flexShrink: 1, fontSize: 14, fontWeight: '600', color: colors.muted },
});
