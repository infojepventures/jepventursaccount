import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatRM, formatYmd } from '@jep/shared';
import type { ClaimRow } from '../data/useClaims';
import { StatusBadge } from '../ui/StatusBadge';
import { colors, radius, space } from '../ui/theme';

export function ClaimCard({
  claim,
  showApplicant,
  selectable,
  selected,
  disabled,
  onToggle,
  onLongPress,
}: {
  claim: ClaimRow;
  showApplicant?: boolean;
  /** When true, the card renders a checkbox and taps toggle selection instead of navigating. */
  selectable?: boolean;
  selected?: boolean;
  /** When true (with `selectable`), the checkbox is greyed out and taps are ignored. */
  disabled?: boolean;
  onToggle?: () => void;
  /** Long-pressing a card enters select mode and selects it, whether or not it's already selectable. */
  onLongPress?: () => void;
}) {
  const router = useRouter();
  const handlePress = () => {
    if (selectable) {
      if (!disabled) onToggle?.();
      return;
    }
    router.push({ pathname: '/claim/[id]', params: { id: claim.id } });
  };
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }, disabled && styles.cardDisabled]}
      onPress={handlePress}
      onLongPress={onLongPress}
    >
      <View style={styles.top}>
        <View style={styles.topLeft}>
          {selectable ? (
            <Ionicons
              name={selected ? 'checkbox' : 'square-outline'}
              size={20}
              color={disabled ? colors.border : selected ? colors.primary : colors.muted}
            />
          ) : null}
          <Text style={styles.ref}>{claim.refNo}</Text>
        </View>
        <StatusBadge status={claim.status} />
      </View>
      {showApplicant ? <Text style={styles.applicant}>{claim.applicant.name}</Text> : null}
      <Text numberOfLines={1} style={styles.items}>{claim.items.map((i) => i.description).join(', ')}</Text>
      <View style={styles.bottom}>
        <Text style={styles.date}>{formatYmd(claim.submittedAt.toDate())}</Text>
        {claim.pdf.status === 'generating' ? <Ionicons name="hourglass-outline" size={14} color={colors.muted} /> : null}
        {claim.pdf.status === 'failed' ? <Ionicons name="alert-circle" size={14} color={colors.danger} /> : null}
        {selectable && disabled ? <Text style={styles.pdfHint}>PDF not ready</Text> : null}
        <Text style={styles.total}>{formatRM(claim.totalCents)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius, borderWidth: 1, borderColor: colors.border, padding: space(4), gap: space(1) },
  cardDisabled: { opacity: 0.6 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  topLeft: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  ref: { fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  applicant: { color: colors.text, fontWeight: '600' },
  items: { color: colors.muted },
  bottom: { flexDirection: 'row', alignItems: 'center', gap: space(2), marginTop: space(1) },
  date: { color: colors.muted, flex: 1 },
  pdfHint: { color: colors.muted, fontSize: 12 },
  total: { fontSize: 16, fontWeight: '800', color: colors.text },
});
