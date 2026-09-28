import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { extractPaymentSlipFromText, formatYmd, isValidYmd, type PaymentSlipSuggestion } from '@jep/shared';
import { recognizeText } from '../claims/ocr';
import { applyPaymentSuggestion, uploadPaymentSlip, type PaidFields } from '../claims/paymentSlip';
import { extractPdfText } from '../claims/pdfText';
import { pickFromCamera, pickFromLibrary, pickPdfs } from '../claims/pickers';
import { putFile } from '../claims/putFile';
import type { LocalAttachment } from '../claims/types';
import { friendlyMessage } from '../lib/api';
import { api } from '../lib/apiInstance';
import { Button } from '../ui/Button';
import { TextField } from '../ui/TextField';
import { colors, radius, space } from '../ui/theme';
import { useBusy } from '../ui/useBusy';

interface Slip {
  file: LocalAttachment;
  uploadedId?: string;
  progress: number;
  uploadError?: string;
  /** 'scanning' on the device, 'reading' on the server (scanned PDFs), then a result line. */
  reading?: 'scanning' | 'reading';
  note?: string;
}

/**
 * Mark as paid: optionally attach the bank transfer slip, which is uploaded next to the receipts and read (on the
 * device, or on the server for a scanned PDF) to fill in the paid date and payment reference.
 */
export function MarkPaidModal(p: { visible: boolean; claimId: string; initialFile?: LocalAttachment | null; onClose: () => void }) {
  const [fields, setFields] = useState<PaidFields>({ paidDate: formatYmd(new Date()), reference: '' });
  const [slip, setSlip] = useState<Slip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, run] = useBusy();
  const current = useRef<string | null>(null);
  const edited = useRef(new Set<keyof PaidFields>());
  const router = useRouter();
  // The dialog steps aside while the slip is open in the viewer, and comes back (as it was) on return.
  const [previewing, setPreviewing] = useState(false);
  useFocusEffect(useCallback(() => setPreviewing(false), []));

  const preview = (file: LocalAttachment) => {
    setPreviewing(true);
    router.push({ pathname: '/viewer', params: { localUri: file.uri, mimeType: file.mimeType, name: file.name } });
  };

  useEffect(() => {
    if (!p.visible) return;
    setFields({ paidDate: formatYmd(new Date()), reference: '' });
    setSlip(null);
    setError(null);
    current.current = null;
    edited.current = new Set();
    // A slip shared from another app starts uploading and being read straight away.
    const shared = p.initialFile;
    if (shared) void choose(() => Promise.resolve([shared]));
  }, [p.visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (key: string, change: Partial<Slip>) =>
    setSlip((s) => (s && s.file.key === key ? { ...s, ...change } : s));

  const discard = (fileId: string | undefined) => {
    if (fileId) void api.discardUpload({ claimId: p.claimId, fileIds: [fileId], purpose: 'paymentSlip' }).catch(() => {});
  };

  const fill = (key: string, s: PaymentSlipSuggestion) => {
    if (current.current !== key) return;
    // What the admin typed by hand wins over the slip.
    const found = { ...s };
    if (edited.current.has('paidDate')) delete found.paidDate;
    if (edited.current.has('reference')) delete found.reference;
    const filled = (found.paidDate ? 1 : 0) + (found.reference ? 1 : 0);
    setFields((f) => applyPaymentSuggestion(f, found).fields);
    patch(key, { reading: undefined, note: filled ? `Filled ${filled} field${filled > 1 ? 's' : ''} from the slip` : "Couldn't find the date or reference; please type them" });
  };

  const readOnServer = async (key: string, fileId: string) => {
    patch(key, { reading: 'reading' });
    try {
      const { payment } = await api.analyzeAttachment({ claimId: p.claimId, fileId, purpose: 'paymentSlip' });
      fill(key, payment ?? {});
    } catch {
      patch(key, { reading: undefined, note: "Couldn't read the slip; please type the details" });
    }
  };

  const choose = async (pick: () => Promise<LocalAttachment[]>) => {
    const [file] = await pick();
    if (!file) return;
    discard(slip?.uploadedId);
    current.current = file.key;
    setError(null);
    setSlip({ file, progress: 0, reading: 'scanning' });

    const isPdf = file.mimeType === 'application/pdf';
    // Upload and on-device reading run side by side; only a PDF with no text layer waits for the upload.
    const upload = uploadPaymentSlip(api, putFile, p.claimId, file, (progress) => patch(file.key, { progress }))
      .then((id) => {
        if (current.current !== file.key) {
          discard(id);
          return null;
        }
        patch(file.key, { uploadedId: id, progress: 1 });
        return id;
      })
      .catch((e: unknown) => {
        patch(file.key, { uploadError: e instanceof Error ? e.message : 'Upload failed' });
        return null;
      });

    const text = isPdf ? await extractPdfText(file.uri) : await recognizeText(file.uri);
    if (text) return fill(file.key, extractPaymentSlipFromText(text));
    if (!isPdf) return fill(file.key, {});
    const id = await upload;
    if (id) await readOnServer(file.key, id);
    else patch(file.key, { reading: undefined });
  };

  const removeSlip = () => {
    discard(slip?.uploadedId);
    current.current = null;
    setSlip(null);
  };

  const cancel = () => {
    discard(slip?.uploadedId);
    current.current = null;
    p.onClose();
  };

  const confirm = () =>
    run(async () => {
      setError(null);
      const paidDate = fields.paidDate.trim();
      if (!isValidYmd(paidDate)) return setError('Enter the paid date as yyyy-MM-dd.');
      if (slip && !slip.uploadedId) {
        return setError(slip.uploadError ? 'The slip failed to upload. Remove it or pick it again.' : 'Please wait for the slip to finish uploading.');
      }
      try {
        await api.markPaid({ claimId: p.claimId, paidDate, reference: fields.reference.trim(), slipFileId: slip?.uploadedId });
        current.current = null;
        p.onClose();
      } catch (e) {
        setError(friendlyMessage(e));
      }
    });

  const setField = (key: keyof PaidFields) => (t: string) => {
    edited.current.add(key);
    setFields((f) => ({ ...f, [key]: t }));
  };

  const status = !slip
    ? null
    : slip.uploadError
      ? `Upload failed: ${slip.uploadError}`
      : slip.reading === 'scanning'
        ? 'Reading the slip…'
        : slip.reading === 'reading'
          ? 'Reading the slip on the server…'
          : !slip.uploadedId
            ? `Uploading… ${Math.round(slip.progress * 100)}%`
            : (slip.note ?? 'Uploaded');

  return (
    <Modal visible={p.visible && !previewing} transparent animationType="fade" onRequestClose={cancel}>
      <View style={styles.backdrop}>
        <ScrollView contentContainerStyle={styles.center} keyboardShouldPersistTaps="handled">
          <View style={styles.sheet}>
            <Text style={styles.title}>Mark as paid</Text>
            <Text style={styles.message}>Attach the bank transfer slip to fill in the date and reference (optional).</Text>

            {slip ? (
              <View style={styles.slip}>
                <Pressable accessibilityRole="button" accessibilityLabel="View slip" onPress={() => preview(slip.file)}>
                  {slip.file.mimeType === 'application/pdf' ? (
                    <Text style={styles.pdfBadge}>PDF</Text>
                  ) : (
                    <Image source={{ uri: slip.file.uri }} style={styles.thumb} />
                  )}
                </Pressable>
                <Pressable style={styles.flex} onPress={() => preview(slip.file)}>
                  <Text style={styles.slipName} numberOfLines={1}>{slip.file.name}</Text>
                  <Text style={styles.tapHint}>Tap to view</Text>
                  <View style={styles.inline}>
                    {slip.reading || (!slip.uploadedId && !slip.uploadError) ? <ActivityIndicator size="small" color={colors.primary} /> : null}
                    <Text style={[styles.slipStatus, slip.uploadError ? { color: colors.danger } : null]}>{status}</Text>
                  </View>
                </Pressable>
                <Button title="Remove" variant="secondary" disabled={busy} onPress={removeSlip} />
              </View>
            ) : null}

            <View style={styles.row}>
              <View style={styles.flex}><Button title="Camera" icon="camera-outline" variant="secondary" disabled={busy} onPress={() => void choose(pickFromCamera)} /></View>
              <View style={styles.flex}><Button title="Photos" icon="images-outline" variant="secondary" disabled={busy} onPress={() => void choose(() => pickFromLibrary(1))} /></View>
              <View style={styles.flex}><Button title="PDF" icon="document-outline" variant="secondary" disabled={busy} onPress={() => void choose(() => pickPdfs(1))} /></View>
            </View>

            <TextField
              label="Paid on (yyyy-MM-dd)"
              value={fields.paidDate}
              onChangeText={setField('paidDate')}
              keyboardType="numbers-and-punctuation"
              autoCapitalize="none"
            />
            <TextField
              label="Payment ref (optional)"
              placeholder="e.g. bank reference number"
              value={fields.reference}
              onChangeText={setField('reference')}
              autoCapitalize="none"
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}

            <View style={styles.row}>
              <View style={styles.flex}><Button title="Cancel" variant="secondary" disabled={busy} onPress={cancel} /></View>
              <View style={styles.flex}><Button title="Mark paid" loading={busy} onPress={() => void confirm()} /></View>
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  center: { flexGrow: 1, justifyContent: 'center', padding: space(5) },
  sheet: { backgroundColor: colors.card, borderRadius: radius, padding: space(5), gap: space(3) },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  message: { fontSize: 14, color: colors.muted },
  row: { flexDirection: 'row', gap: space(2) },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space(1) },
  flex: { flex: 1 },
  slip: { flexDirection: 'row', alignItems: 'center', gap: space(3), borderWidth: 1, borderColor: colors.border, borderRadius: radius, padding: space(2) },
  thumb: { width: 48, height: 48, borderRadius: 6, backgroundColor: colors.border },
  pdfBadge: { width: 48, height: 48, borderRadius: 6, backgroundColor: colors.border, textAlign: 'center', textAlignVertical: 'center', fontWeight: '700', color: colors.muted },
  slipName: { color: colors.text, fontWeight: '500' },
  tapHint: { color: colors.primary, fontSize: 12 },
  slipStatus: { color: colors.muted, fontSize: 12, flexShrink: 1 },
  error: { color: colors.danger, fontSize: 13 },
});
