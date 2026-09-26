import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { receiptStatus, type ReceiptStatus } from '../claims/receiptStatus';
import type { AnyAttachment } from '../claims/types';
import { api } from '../lib/apiInstance';
import { colors, radius, space } from '../ui/theme';

// ID tokens expire after 1 hour; refresh well before that for a screen left open a while.
const HEADERS_REFRESH_MS = 30 * 60 * 1000;

function useAuthHeaders() {
  const [headers, setHeaders] = useState<Record<string, string> | null>(null);
  const refresh = useCallback(() => {
    api.authHeaders().then(setHeaders).catch(() => setHeaders(null));
  }, []);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, HEADERS_REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh]);
  return { headers, refresh };
}

export function AttachmentList({
  claimId,
  items,
  onRemove,
  onRetry,
}: {
  claimId?: string;
  items: AnyAttachment[];
  onRemove?: (key: string) => void;
  onRetry?: (key: string, step: 'upload' | 'analyze') => void;
}) {
  const router = useRouter();
  const { headers, refresh } = useAuthHeaders();
  const [retried, setRetried] = useState<Set<string>>(new Set());

  const retryOnce = useCallback((key: string) => {
    setRetried((prev) => {
      if (prev.has(key)) return prev;
      refresh();
      return new Set(prev).add(key);
    });
  }, [refresh]);

  return (
    <View style={styles.grid}>
      {items.map((a) => {
        const isImage = a.mimeType !== 'application/pdf';
        const remoteUri = a.kind === 'remote' && claimId ? api.fileUrl(claimId, a.driveFileId) : null;
        const open = () => {
          if (a.kind === 'remote' && claimId) {
            router.push({
              pathname: '/viewer',
              params: { claimId, fileId: a.driveFileId, mimeType: a.mimeType, name: a.name },
            });
          } else if (a.kind === 'local') {
            // Not submitted yet: preview the picked file straight from the device.
            router.push({ pathname: '/viewer', params: { localUri: a.uri, mimeType: a.mimeType, name: a.name } });
          }
        };
        return (
          <Pressable key={a.key} style={styles.tile} onPress={open} accessibilityLabel={`Open ${a.name}`}>
            {isImage && a.kind === 'local' ? (
              <Image source={{ uri: a.uri }} style={styles.thumb} contentFit="cover" />
            ) : isImage && remoteUri && headers ? (
              <Image
                source={{ uri: remoteUri, headers }}
                style={styles.thumb}
                contentFit="cover"
                onError={() => retryOnce(a.key)}
              />
            ) : (
              <View style={[styles.thumb, styles.pdf]}>
                <Ionicons name="document-text-outline" size={28} color={colors.muted} />
              </View>
            )}
            <Text numberOfLines={1} style={styles.name}>{a.name}</Text>
            {a.kind === 'local' ? <StatusLine status={receiptStatus(a)} onRetry={onRetry ? (step) => onRetry(a.key, step) : undefined} /> : null}
            {a.kind === 'local' && a.uploadedId ? <Ionicons name="checkmark-circle" size={16} color={colors.success} style={styles.ok} /> : null}
            {onRemove ? (
              <Pressable hitSlop={10} style={styles.remove} onPress={() => onRemove(a.key)} accessibilityLabel={`Remove ${a.name}`}>
                <Ionicons name="close-circle" size={22} color={colors.text} />
              </Pressable>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const TONE_COLOR: Record<ReceiptStatus['tone'], string> = {
  busy: colors.muted,
  success: colors.success,
  muted: colors.muted,
  danger: colors.danger,
};
const TONE_ICON: Partial<Record<ReceiptStatus['tone'], keyof typeof Ionicons.glyphMap>> = {
  success: 'checkmark-circle',
  muted: 'remove-circle-outline',
  danger: 'alert-circle',
};

function StatusLine({ status, onRetry }: { status: ReceiptStatus; onRetry?: (step: 'upload' | 'analyze') => void }) {
  const color = TONE_COLOR[status.tone];
  const icon = TONE_ICON[status.tone];
  return (
    <View style={styles.status}>
      {status.progress !== undefined ? (
        <View style={styles.bar}><View style={[styles.fill, { width: `${Math.round(status.progress * 100)}%` }]} /></View>
      ) : null}
      <View style={styles.statusRow}>
        {status.tone === 'busy' ? <ActivityIndicator size={10} color={color} /> : icon ? <Ionicons name={icon} size={12} color={color} /> : null}
        <Text style={[styles.statusText, { color }]} numberOfLines={2}>{status.label}</Text>
      </View>
      {status.retry && onRetry ? (
        <Pressable hitSlop={8} onPress={() => onRetry(status.retry!)} accessibilityLabel="Retry">
          <Text style={styles.retry}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space(3) },
  tile: { width: 96, gap: space(1) },
  thumb: { width: 96, height: 96, borderRadius: radius, backgroundColor: colors.border },
  pdf: { alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 11, color: colors.muted },
  status: { gap: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusText: { flex: 1, fontSize: 10 },
  retry: { fontSize: 11, fontWeight: '600', color: colors.info },
  bar: { height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: colors.primary },
  ok: { position: 'absolute', left: 4, top: 4 },
  remove: { position: 'absolute', right: -6, top: -6, backgroundColor: colors.card, borderRadius: 11 },
});
