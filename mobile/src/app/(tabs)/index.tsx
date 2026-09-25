import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
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

  return (
    <View style={styles.root}>
      <View>
        <FilterChips options={FILTERS} value={filter} onChange={setFilter} />
      </View>
      {loading ? (
        <ActivityIndicator style={{ marginTop: space(10) }} color={colors.primary} />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => <ClaimCard claim={item} />}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>{error ?? 'No claims here yet.'}</Text>
              <Button title="New claim" icon="add" onPress={() => router.push('/new')} />
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  list: { padding: space(4), paddingTop: 0, gap: space(3) },
  empty: { alignItems: 'center', gap: space(4), marginTop: space(16) },
  emptyText: { color: colors.muted },
});
