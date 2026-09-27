import type { BankDetails } from '@jep/shared';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { TextField } from '../ui/TextField';
import { colors, space } from '../ui/theme';

/**
 * "Pay to" inside an item's tab. By default an item pays the claim's default payee (shown as one line);
 * "Different payee" gives it its own, and items with different payees are submitted as separate claims.
 */
export function ItemPayee(p: {
  payee: BankDetails;
  /** True when the item has its own payee rather than the default. */
  own: boolean;
  badge: (field: keyof BankDetails) => string | undefined;
  onChange: (patch: Partial<BankDetails>) => void;
  onUseOwn: () => void;
  onUseDefault: () => void;
  disabled?: boolean;
}) {
  const summary = [p.payee.accountHolder, p.payee.bankName, p.payee.accountNumber].map((s) => s.trim()).filter(Boolean).join(' · ');
  return (
    <View style={styles.root}>
      <View style={styles.head}>
        <Text style={styles.title}>Pay to</Text>
        <Pressable disabled={p.disabled} hitSlop={8} onPress={p.own ? p.onUseDefault : p.onUseOwn} accessibilityRole="button">
          <Text style={styles.link}>{p.own ? 'Use default' : 'Different payee'}</Text>
        </Pressable>
      </View>
      {p.own ? (
        <>
          <TextField label="Bank" value={p.payee.bankName} onChangeText={(t) => p.onChange({ bankName: t })} badge={p.badge('bankName')} />
          <TextField
            label="Account holder"
            value={p.payee.accountHolder}
            onChangeText={(t) => p.onChange({ accountHolder: t })}
            autoCapitalize="words"
            badge={p.badge('accountHolder')}
          />
          <TextField
            label="Account number"
            value={p.payee.accountNumber}
            onChangeText={(t) => p.onChange({ accountNumber: t })}
            keyboardType="number-pad"
            badge={p.badge('accountNumber')}
          />
        </>
      ) : (
        <Text style={styles.summary} numberOfLines={2}>
          {summary || 'Not set yet'} <Text style={styles.muted}>(default)</Text>
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space(2), paddingTop: space(3), borderTopWidth: 1, borderTopColor: colors.border },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  title: { fontSize: 14, fontWeight: '700', color: colors.text },
  link: { fontSize: 13, fontWeight: '600', color: colors.info },
  summary: { fontSize: 14, color: colors.text },
  muted: { color: colors.muted },
});
