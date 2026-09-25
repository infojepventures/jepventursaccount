import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { formatRM, sumCents } from '@jep/shared';
import { useAuth } from '../../auth/AuthProvider';
import { ClaimCard } from '../../components/ClaimCard';
import { FilterChips } from '../../components/FilterChips';
import { useClaimsByStatus, type StatusFilter } from '../../data/useClaims';
import { TextField } from '../../ui/TextField';
import { colors, space } from '../../ui/theme';

type Segment = 'pending' | 'topay' | 'all';
const SEGMENTS: { value: Segment; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'topay', label: 'To pay' },
  { value: 'all', label: 'All' },
];
const STATUS_FOR: Record<Segment, StatusFilter> = { pending: 'submitted', topay: 'approved', all: 'all' };

export default function ReviewTab() {
  const { isAdmin } = useAuth();
  const [segment, setSegment] = useState<Segment>('pending');
  const [search, setSearch] = useState('');
  const { data, loading, error } = useClaimsByStatus(STATUS_FOR[segment], isAdmin);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (segment !== 'all' || !q) return data;
    return data.filter((c) => c.refNo.toLowerCase().includes(q) || c.applicant.name.toLowerCase().includes(q));
  }, [data, search, segment]);

  if (!isAdmin) return null;
  return (
    <View style={styles.root}>
      <View>
        <FilterChips options={SEGMENTS} value={segment} onChange={setSegment} />
      </View>
      {segment === 'all' ? (
        <View style={styles.search}>
          <TextField label="Search" placeholder="PR number or name" value={search} onChangeText={setSearch} autoCapitalize="none" />
        </View>
      ) : (
        <Text style={styles.summary}>
          {data.length} claim{data.length === 1 ? '' : 's'} · {formatRM(sumCents(data.map((c) => ({ amountCents: c.totalCents }))))}
        </Text>
      )}
      {loading ? (
        <ActivityIndicator style={{ marginTop: space(10) }} color={colors.primary} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => <ClaimCard claim={item} showApplicant />}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>{error ?? 'Nothing here. 🎉'}</Text>}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  search: { paddingHorizontal: space(4), paddingBottom: space(3) },
  summary: { paddingHorizontal: space(4), paddingBottom: space(2), color: colors.muted },
  list: { padding: space(4), paddingTop: 0, gap: space(3) },
  empty: { textAlign: 'center', color: colors.muted, marginTop: space(16) },
});
