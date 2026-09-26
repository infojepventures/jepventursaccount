import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { formatRM, sumCents } from '@jep/shared';
import { useAuth } from '../../auth/AuthProvider';
import { BatchHint, BatchSelectToolbar, BatchShareBar, useBatchShareSelection } from '../../components/batchShare';
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

  const batch = useBatchShareSelection(rows, segment);

  if (!isAdmin) return null;
  return (
    <View style={styles.root}>
      <View>
        <FilterChips options={SEGMENTS} value={segment} onChange={setSegment} />
      </View>
      <View style={styles.toolbar}>
        {segment === 'all' ? (
          <View style={styles.search}>
            <TextField label="Search" placeholder="PR number or name" value={search} onChangeText={setSearch} autoCapitalize="none" />
          </View>
        ) : (
          <Text style={styles.summary}>
            {data.length} claim{data.length === 1 ? '' : 's'} · {formatRM(sumCents(data.map((c) => ({ amountCents: c.totalCents }))))}
          </Text>
        )}
        <BatchSelectToolbar
          selectMode={batch.selectMode}
          count={batch.selectedClaims.length}
          onSelectAll={batch.selectAll}
          onCancel={batch.exit}
        />
      </View>
      <BatchHint visible={!batch.selectMode && rows.length > 0} />
      {loading ? (
        <ActivityIndicator style={{ marginTop: space(10) }} color={colors.primary} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => (
            <ClaimCard
              claim={item}
              showApplicant
              selectable={batch.selectMode}
              selected={batch.isSelected(item.id)}
              disabled={batch.selectMode && !batch.isShareable(item)}
              onToggle={() => batch.toggle(item.id)}
              onLongPress={() => batch.selectViaLongPress(item)}
            />
          )}
          contentContainerStyle={[styles.list, batch.selectMode && styles.listWithBar]}
          ListEmptyComponent={<Text style={styles.empty}>{error ?? 'Nothing here. 🎉'}</Text>}
        />
      )}
      {batch.selectMode ? (
        <BatchShareBar count={batch.selectedClaims.length} busy={batch.busy} onCancel={batch.exit} onShare={batch.share} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  toolbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space(4) },
  search: { flex: 1, paddingBottom: space(3) },
  summary: { flex: 1, paddingBottom: space(2), color: colors.muted },
  list: { padding: space(4), paddingTop: 0, gap: space(3) },
  listWithBar: { paddingBottom: space(20) },
  empty: { textAlign: 'center', color: colors.muted, marginTop: space(16) },
});
