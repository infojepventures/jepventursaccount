import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { BatchHint, BatchSelectToolbar, BatchShareBar, useBatchShareSelection } from '../../components/batchShare';
import { ClaimCard } from '../../components/ClaimCard';
import { FilterChips } from '../../components/FilterChips';
import { useMyClaims, type StatusFilter } from '../../data/useClaims';
import { Button } from '../../ui/Button';
import { colors, space } from '../../ui/theme';

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'submitted', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'paid', label: 'Paid' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default function MyClaimsTab() {
  const { user } = useAuth();
  const router = useRouter();
  const [filter, setFilter] = useState<StatusFilter>('all');
  const { data, loading, error } = useMyClaims(user?.uid, filter);
  const batch = useBatchShareSelection(data, filter);

  return (
    <View style={styles.root}>
      <View>
        <FilterChips options={FILTERS} value={filter} onChange={setFilter} />
      </View>
      {batch.selectMode ? (
        <View style={styles.toolbar}>
          <BatchSelectToolbar
            selectMode={batch.selectMode}
            count={batch.selectedClaims.length}
            onSelectAll={batch.selectAll}
            onCancel={batch.exit}
          />
        </View>
      ) : null}
      <BatchHint visible={!batch.selectMode && data.length > 0} />
      {loading ? (
        <ActivityIndicator style={{ marginTop: space(10) }} color={colors.primary} />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => (
            <ClaimCard
              claim={item}
              selectable={batch.selectMode}
              selected={batch.isSelected(item.id)}
              disabled={batch.selectMode && !batch.isShareable(item)}
              onToggle={() => batch.toggle(item.id)}
              onLongPress={() => batch.selectViaLongPress(item)}
            />
          )}
          contentContainerStyle={[styles.list, batch.selectMode && styles.listWithBar]}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>{error ?? 'No claims here yet.'}</Text>
              <Button title="New claim" icon="add" onPress={() => router.push('/new')} />
            </View>
          }
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
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', paddingHorizontal: space(4) },
  list: { padding: space(4), paddingTop: 0, gap: space(3) },
  listWithBar: { paddingBottom: space(20) },
  empty: { alignItems: 'center', gap: space(4), marginTop: space(16) },
  emptyText: { color: colors.muted },
});
