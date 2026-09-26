import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatRM, sumCents } from '@jep/shared';
import { useAuth } from '../../auth/AuthProvider';
import { ClaimCard } from '../../components/ClaimCard';
import { FilterChips } from '../../components/FilterChips';
import { useClaimsByStatus, type ClaimRow, type StatusFilter } from '../../data/useClaims';
import { buildWhatsAppBatchText } from '../../files/claimShareText';
import { shareTextToWhatsApp } from '../../files/shareFile';
import { Button } from '../../ui/Button';
import { TextField } from '../../ui/TextField';
import { colors, space } from '../../ui/theme';
import { useBusy } from '../../ui/useBusy';

type Segment = 'pending' | 'topay' | 'all';
const SEGMENTS: { value: Segment; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'topay', label: 'To pay' },
  { value: 'all', label: 'All' },
];
const STATUS_FOR: Record<Segment, StatusFilter> = { pending: 'submitted', topay: 'approved', all: 'all' };

/** Only a claim with a ready PDF has a doc name + Drive link, so only those can be batch-shared. */
const isShareable = (c: ClaimRow) => c.pdf.status === 'ready';

export default function ReviewTab() {
  const { isAdmin } = useAuth();
  const [segment, setSegment] = useState<Segment>('pending');
  const [search, setSearch] = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busy, run] = useBusy();
  const { data, loading, error } = useClaimsByStatus(STATUS_FOR[segment], isAdmin);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (segment !== 'all' || !q) return data;
    return data.filter((c) => c.refNo.toLowerCase().includes(q) || c.applicant.name.toLowerCase().includes(q));
  }, [data, search, segment]);

  // Selection is only meaningful for the currently visible segment/list; clear it whenever either changes.
  useEffect(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, [segment]);

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const toggleRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(rows.filter(isShareable).map((c) => c.id)));
  };

  const selectedClaims = rows.filter((c) => selectedIds.has(c.id));

  const shareSelected = () =>
    run(async () => {
      await shareTextToWhatsApp(buildWhatsAppBatchText(selectedClaims));
      exitSelectMode();
    });

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
        {selectMode ? (
          <View style={styles.selectRow}>
            <Pressable onPress={selectAll} style={styles.selectAllBtn}>
              <Text style={styles.selectAllText}>Select all</Text>
            </Pressable>
            <Pressable onPress={exitSelectMode} style={styles.selectAllBtn}>
              <Text style={styles.selectAllText}>Cancel</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={() => setSelectMode(true)} style={styles.selectToggle}>
            <Text style={styles.selectToggleText}>Select</Text>
          </Pressable>
        )}
      </View>
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
              selectable={selectMode}
              selected={selectedIds.has(item.id)}
              disabled={selectMode && !isShareable(item)}
              onToggle={() => toggleRow(item.id)}
            />
          )}
          contentContainerStyle={[styles.list, selectMode && styles.listWithBar]}
          ListEmptyComponent={<Text style={styles.empty}>{error ?? 'Nothing here. 🎉'}</Text>}
        />
      )}
      {selectMode ? (
        <View style={styles.bottomBar}>
          <View style={styles.bottomBarBtn}>
            <Button title="Cancel" variant="secondary" onPress={exitSelectMode} />
          </View>
          <View style={styles.bottomBarBtn}>
            <Button
              title={`WhatsApp (${selectedIds.size})`}
              icon="logo-whatsapp"
              loading={busy}
              disabled={selectedIds.size === 0}
              onPress={shareSelected}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  toolbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space(4) },
  search: { flex: 1, paddingBottom: space(3) },
  summary: { flex: 1, paddingBottom: space(2), color: colors.muted },
  selectToggle: { paddingVertical: space(2), paddingHorizontal: space(3) },
  selectToggleText: { color: colors.primary, fontWeight: '600' },
  selectRow: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  selectAllBtn: { paddingVertical: space(2), paddingHorizontal: space(1) },
  selectAllText: { color: colors.primary, fontWeight: '600' },
  list: { padding: space(4), paddingTop: 0, gap: space(3) },
  listWithBar: { paddingBottom: space(20) },
  empty: { textAlign: 'center', color: colors.muted, marginTop: space(16) },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    padding: space(4),
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  bottomBarBtn: { flex: 1 },
});
