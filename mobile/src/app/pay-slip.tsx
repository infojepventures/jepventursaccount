import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { formatRM } from '@jep/shared';
import { useAuth } from '../auth/AuthProvider';
import { ClaimCard } from '../components/ClaimCard';
import { useClaimsByStatus } from '../data/useClaims';
import { handoff } from '../share/handoff';
import { colors, space } from '../ui/theme';

/** Picks the approved claim a shared payment slip belongs to, then opens Mark as paid with the slip in it. */
export default function PaySlipScreen() {
  const { isAdmin } = useAuth();
  const router = useRouter();
  const { data, loading, error } = useClaimsByStatus('approved', isAdmin);
  const chosen = useRef(false);

  // Leaving without choosing a claim drops the shared slip.
  useEffect(() => () => {
    if (!chosen.current) handoff.clear('slip');
  }, []);

  if (!isAdmin) return <Text style={styles.empty}>Only admins can mark claims paid.</Text>;
  return (
    <View style={styles.root}>
      <Text style={styles.hint}>Which claim did this slip pay?</Text>
      {loading ? (
        <ActivityIndicator style={{ marginTop: space(10) }} color={colors.primary} />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => (
            <ClaimCard
              claim={item}
              showApplicant
              onPress={() => {
                chosen.current = true;
                router.replace({ pathname: '/claim/[id]', params: { id: item.id, slip: '1' } });
              }}
            />
          )}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            data.length ? <Text style={styles.summary}>{data.length} approved · to pay {formatRM(data.reduce((s, c) => s + c.totalCents, 0))}</Text> : null
          }
          ListEmptyComponent={<Text style={styles.empty}>{error ?? 'No approved claims waiting for payment.'}</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  hint: { paddingHorizontal: space(4), paddingTop: space(3), color: colors.text, fontWeight: '600' },
  summary: { color: colors.muted, marginBottom: space(2) },
  list: { padding: space(4), gap: space(3) },
  empty: { textAlign: 'center', color: colors.muted, marginTop: space(10) },
});
