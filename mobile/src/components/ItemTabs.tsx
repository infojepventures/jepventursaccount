import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space } from '../ui/theme';

export interface ItemTab {
  key: string;
  /** e.g. "RM 12.50", or "—" while no amount is entered. */
  amountLabel: string;
  receiptCount: number;
  busy: boolean;
  hasError: boolean;
}

/** Horizontally scrolling tabs, one per claim item, plus a trailing "+" tab that adds an item. */
export function ItemTabs(p: {
  tabs: ItemTab[];
  activeKey: string;
  onSelect: (key: string) => void;
  onAdd?: () => void;
}) {
  const scroll = useRef<ScrollView>(null);
  const offsets = useRef(new Map<string, number>());

  // Keep the active tab in view (e.g. after adding an 8th item, or jumping to an item with an error).
  useEffect(() => {
    const x = offsets.current.get(p.activeKey);
    if (x !== undefined) scroll.current?.scrollTo({ x: Math.max(0, x - space(4)), animated: true });
  }, [p.activeKey]);

  return (
    <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
      {p.tabs.map((t, i) => {
        const active = t.key === p.activeKey;
        return (
          <Pressable
            key={t.key}
            onLayout={(e) => offsets.current.set(t.key, e.nativeEvent.layout.x)}
            onPress={() => p.onSelect(t.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`Item ${i + 1}, ${t.amountLabel}, ${t.receiptCount} receipts${t.hasError ? ', needs attention' : ''}`}
            style={[styles.tab, active && styles.tabActive, t.hasError && !active && styles.tabError]}
          >
            <View style={styles.tabHead}>
              <Text style={[styles.tabTitle, active && styles.textActive]}>Item {i + 1}</Text>
              {t.hasError ? <View style={styles.errorDot} /> : null}
            </View>
            <Text style={[styles.tabAmount, active && styles.textActive]} numberOfLines={1}>{t.amountLabel}</Text>
            <View style={styles.tabMeta}>
              <Ionicons name={t.busy ? 'sync-outline' : 'receipt-outline'} size={11} color={active ? colors.primaryText : colors.muted} />
              <Text style={[styles.tabMetaText, active && styles.textActive]}>{t.receiptCount}</Text>
            </View>
          </Pressable>
        );
      })}
      {p.onAdd ? (
        <Pressable onPress={p.onAdd} accessibilityRole="button" accessibilityLabel="Add item" style={[styles.tab, styles.addTab]}>
          <Ionicons name="add" size={22} color={colors.text} />
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: { gap: space(2), paddingVertical: 2 },
  tab: {
    minWidth: 88,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    gap: 2,
  },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabError: { borderColor: colors.danger },
  tabHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tabTitle: { fontSize: 12, fontWeight: '700', color: colors.muted },
  tabAmount: { fontSize: 14, fontWeight: '700', color: colors.text },
  tabMeta: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  tabMetaText: { fontSize: 11, color: colors.muted },
  textActive: { color: colors.primaryText },
  errorDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.danger },
  addTab: { minWidth: 56, alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed' },
});
