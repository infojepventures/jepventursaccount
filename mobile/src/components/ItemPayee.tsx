import type { BankDetails } from '@jep/shared';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { TextField } from '../ui/TextField';
import { colors, radius, space } from '../ui/theme';

const oneLine = (p: BankDetails) => [p.accountHolder, p.bankName, p.accountNumber].map((s) => s.trim()).filter(Boolean).join(' · ');

/**
 * "Pay to" inside an item's tab. By default an item pays the claim's default payee (the claimant's profile bank
 * details, or a resubmitted claim's payee), shown as one line. "Different payee" gives it its own, with one-tap
 * choices of payees other items already use; items paying different people are submitted as separate claims.
 */
export function ItemPayee(p: {
  payee: BankDetails;
  /** True when the item has its own payee rather than the default. */
  own: boolean;
  /** False when there's no usable default (no bank details in the profile): the fields are shown straight away. */
  hasDefault: boolean;
  choices: { payee: BankDetails; isDefault: boolean }[];
  badge: (field: keyof BankDetails) => string | undefined;
  onChange: (patch: Partial<BankDetails>) => void;
  onUseOwn: () => void;
  onUseDefault: () => void;
  onPick: (payee: BankDetails, isDefault: boolean) => void;
  /** Shown when the claim has more than one item. */
  onApplyToAll?: () => void;
  disabled?: boolean;
}) {
  const editing = p.own || !p.hasDefault;
  return (
    <View style={styles.root}>
      <View style={styles.head}>
        <Text style={styles.title}>Pay to</Text>
        {p.hasDefault ? (
          <Pressable disabled={p.disabled} hitSlop={8} onPress={p.own ? p.onUseDefault : p.onUseOwn} accessibilityRole="button">
            <Text style={styles.link}>{p.own ? 'Use default' : 'Different payee'}</Text>
          </Pressable>
        ) : null}
      </View>

      {editing ? (
        <>
          {p.choices.length ? (
            <View style={styles.chips}>
              {p.choices.map((c) => (
                <Pressable
                  key={oneLine(c.payee)}
                  disabled={p.disabled}
                  onPress={() => p.onPick(c.payee, c.isDefault)}
                  style={styles.chip}
                  accessibilityRole="button"
                  accessibilityLabel={`Pay ${c.payee.accountHolder}`}
                >
                  <Text style={styles.chipText} numberOfLines={1}>
                    {c.payee.accountHolder.trim()}
                    {c.isDefault ? ' (default)' : ''}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
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
          {oneLine(p.payee)} <Text style={styles.muted}>(default)</Text>
        </Text>
      )}

      {p.onApplyToAll ? (
        <Pressable disabled={p.disabled} hitSlop={8} onPress={p.onApplyToAll} accessibilityRole="button">
          <Text style={styles.link}>Apply this payee to all items</Text>
        </Pressable>
      ) : null}
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  chip: {
    maxWidth: '100%',
    paddingHorizontal: space(3),
    paddingVertical: space(1),
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  chipText: { fontSize: 13, color: colors.text },
});
