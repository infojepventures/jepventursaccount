import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ClaimRow } from '../data/useClaims';
import { buildWhatsAppBatchText } from '../files/claimShareText';
import { shareTextToWhatsApp } from '../files/shareFile';
import { Button } from '../ui/Button';
import { colors, space } from '../ui/theme';
import { useBusy } from '../ui/useBusy';
import { computeSelectedClaims, isShareable, MAX_SHARE_TEXT_LENGTH, pruneSelectedIds } from './batchShareSelection';

export { computeSelectedClaims, isShareable, MAX_SHARE_TEXT_LENGTH, pruneSelectedIds };

export interface BatchShareSelection {
  selectMode: boolean;
  /** Exits select mode and clears the current selection. */
  exit: () => void;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  /** Selects every currently-shareable row. */
  selectAll: () => void;
  /**
   * Long-press entry point: enters select mode and, if the given claim is currently shareable,
   * selects it too. A long-press on a claim whose PDF isn't ready still enters select mode, but
   * that claim itself stays unselected.
   */
  selectViaLongPress: (claim: ClaimRow) => void;
  selectedClaims: ClaimRow[];
  /** Builds the WhatsApp batch text for the current selection and shares it, then exits select mode. */
  share: () => void;
  busy: boolean;
  isShareable: (c: ClaimRow) => boolean;
}

/**
 * Shared multi-select + WhatsApp batch-share state for a claims list. `resetKey` identifies the
 * currently visible segment/filter: selection is only meaningful for the list it was made against,
 * so select mode and the selection are cleared whenever `resetKey` changes.
 */
export function useBatchShareSelection(rows: ClaimRow[], resetKey: string): BatchShareSelection {
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busy, run] = useBusy();

  useEffect(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, [resetKey]);

  useEffect(() => {
    setSelectedIds((prev) => pruneSelectedIds(prev, rows));
  }, [rows]);

  const exit = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const toggle = (id: string) => {
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

  const selectViaLongPress = (claim: ClaimRow) => {
    setSelectMode(true);
    if (!isShareable(claim)) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.add(claim.id);
      return next;
    });
  };

  const selectedClaims = computeSelectedClaims(rows, selectedIds);

  const share = () =>
    run(async () => {
      if (selectedClaims.length === 0) return;
      const text = buildWhatsAppBatchText(selectedClaims);
      if (text.length > MAX_SHARE_TEXT_LENGTH) {
        Alert.alert('Too many claims selected — please share in smaller batches.');
        return;
      }
      await shareTextToWhatsApp(text);
      exit();
    });

  return {
    selectMode,
    exit,
    isSelected: (id) => selectedIds.has(id),
    toggle,
    selectAll,
    selectViaLongPress,
    selectedClaims,
    share,
    busy,
    isShareable,
  };
}

/**
 * The "Select all" / "Cancel" row (with the current selected count) shown while select mode is
 * active. Select mode itself is only entered via a long-press on a card, so this renders nothing
 * otherwise.
 */
export function BatchSelectToolbar({
  selectMode,
  count,
  onSelectAll,
  onCancel,
}: {
  selectMode: boolean;
  count: number;
  onSelectAll: () => void;
  onCancel: () => void;
}) {
  if (!selectMode) return null;
  return (
    <View style={styles.selectRow}>
      <Text style={styles.selectCount}>{count} selected</Text>
      <Pressable onPress={onSelectAll} style={styles.selectAllBtn}>
        <Text style={styles.selectAllText}>Select all</Text>
      </Pressable>
      <Pressable onPress={onCancel} style={styles.selectAllBtn}>
        <Text style={styles.selectAllText}>Cancel</Text>
      </Pressable>
    </View>
  );
}

/**
 * Hint shown above the list, outside select mode, pointing people at the long-press gesture.
 * `visible` should be false whenever the list is empty or select mode is active.
 */
export function BatchHint({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return <Text style={styles.hint}>Long-press a claim to select several and share to WhatsApp.</Text>;
}

/** Sticky bottom bar with "Cancel" and "WhatsApp (n)", shown while select mode is active. */
export function BatchShareBar({
  count,
  busy,
  onCancel,
  onShare,
}: {
  count: number;
  busy: boolean;
  onCancel: () => void;
  onShare: () => void;
}) {
  return (
    <View style={styles.bottomBar}>
      <View style={styles.bottomBarBtn}>
        <Button title="Cancel" variant="secondary" onPress={onCancel} />
      </View>
      <View style={styles.bottomBarBtn}>
        <Button
          title={`WhatsApp (${count})`}
          icon="logo-whatsapp"
          loading={busy}
          disabled={count === 0}
          onPress={onShare}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  selectRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space(3), paddingBottom: space(1) },
  selectCount: { flex: 1, color: colors.muted },
  selectAllBtn: { paddingVertical: space(2), paddingHorizontal: space(1) },
  selectAllText: { color: colors.primary, fontWeight: '600' },
  hint: { color: colors.muted, fontSize: 12, paddingHorizontal: space(4), paddingBottom: space(2) },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    padding: space(4),
    // Clear the raised centre New Claim button, which overlaps the top of the tab bar by ~28px.
    paddingBottom: space(4) + 28,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  bottomBarBtn: { flex: 1 },
});
