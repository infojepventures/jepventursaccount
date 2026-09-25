import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatRM, formatYmd } from '@jep/shared';
import type { ClaimRow } from '../data/useClaims';
import { StatusBadge } from '../ui/StatusBadge';
import { colors, radius, space } from '../ui/theme';

export function ClaimCard({ claim, showApplicant }: { claim: ClaimRow; showApplicant?: boolean }) {
  const router = useRouter();
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
      onPress={() => router.push({ pathname: '/claim/[id]', params: { id: claim.id } })}
    >
      <View style={styles.top}>
        <Text style={styles.ref}>{claim.refNo}</Text>
        <StatusBadge status={claim.status} />
      </View>
      {showApplicant ? <Text style={styles.applicant}>{claim.applicant.name}</Text> : null}
      <Text numberOfLines={1} style={styles.items}>{claim.items.map((i) => i.description).join(', ')}</Text>
      <View style={styles.bottom}>
        <Text style={styles.date}>{formatYmd(claim.submittedAt.toDate())}</Text>
        {claim.pdf.status === 'generating' ? <Ionicons name="hourglass-outline" size={14} color={colors.muted} /> : null}
        {claim.pdf.status === 'failed' ? <Ionicons name="alert-circle" size={14} color={colors.danger} /> : null}
        <Text style={styles.total}>{formatRM(claim.totalCents)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius, borderWidth: 1, borderColor: colors.border, padding: space(4), gap: space(1) },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  ref: { fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  applicant: { color: colors.text, fontWeight: '600' },
  items: { color: colors.muted },
  bottom: { flexDirection: 'row', alignItems: 'center', gap: space(2), marginTop: space(1) },
  date: { color: colors.muted, flex: 1 },
  total: { fontSize: 16, fontWeight: '800', color: colors.text },
});
