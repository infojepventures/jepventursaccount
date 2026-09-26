import { useRef, useState } from 'react';
import { Alert, StyleSheet, Switch, Text, View } from 'react-native';
import { formatRM, MAX_ATTACHMENTS, parseAmountToCents } from '@jep/shared';
import { applySuggestion } from '../claims/applySuggestion';
import { draftErrors, draftTotalCents, emptyItem, itemErrors, type ClaimDraft, type DraftItem } from '../claims/draft';
import { orderByItem, receiptsForItem, unlinkedReceipts } from '../claims/itemReceipts';
import { recognizeText } from '../claims/ocr';
import { pickFromCamera, pickFromLibrary, pickPdfs } from '../claims/pickers';
import { putFile } from '../claims/putFile';
import { runSubmitFlow, uploadPendingAttachments } from '../claims/submitFlow';
import type { AnyAttachment, LocalAttachment } from '../claims/types';
import { friendlyMessage } from '../lib/api';
import { api } from '../lib/apiInstance';
import { Button } from '../ui/Button';
import { Screen } from '../ui/Screen';
import { Section } from '../ui/Section';
import { TextField } from '../ui/TextField';
import { colors, space } from '../ui/theme';
import { AttachmentList } from './AttachmentList';
import { ItemTabs, type ItemTab } from './ItemTabs';

export function ClaimForm(p: {
  claimId: string;
  resubmit: boolean;
  initialDraft: ClaimDraft;
  initialAttachments: AnyAttachment[];
  showSaveBank: boolean;
  submitLabel: string;
  onSubmitted: (claimId: string) => void;
}) {
  const [draft, setDraft] = useState<ClaimDraft>(p.initialDraft);
  const [attachments, setAttachments] = useState<AnyAttachment[]>(p.initialAttachments);
  const [submitting, setSubmitting] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [aiFields, setAiFields] = useState<Set<string>>(new Set());
  const [activeKey, setActiveKey] = useState(p.initialDraft.items[0]?.key ?? '');
  const payeeEditedByUser = useRef(false);
  // Latest draft for async OCR callbacks: applySuggestion must run outside a setState updater so its
  // AI-filled field keys are available synchronously (React may defer updaters).
  const draftRef = useRef(draft);
  draftRef.current = draft;
  // Receipts removed from the form. An upload still in flight when removed is discarded once it lands.
  const removedKeys = useRef(new Set<string>());

  const errors = draftErrors(draft, attachments.length);
  const remaining = MAX_ATTACHMENTS - attachments.length;
  const activeIndex = Math.max(0, draft.items.findIndex((i) => i.key === activeKey));
  const active = draft.items[activeIndex]!;

  const clearAiFields = (keys: string[]) =>
    setAiFields((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(prev);
      let changed = false;
      for (const k of keys) if (next.delete(k)) changed = true;
      return changed ? next : prev;
    });

  const setItem = (key: string, patch: Partial<DraftItem>) => {
    setDraft((d) => ({ ...d, items: d.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) }));
    clearAiFields(Object.keys(patch).map((field) => `item:${key}:${field}`));
  };
  const setBank = (patch: Partial<ClaimDraft['bank']>) => {
    payeeEditedByUser.current = true;
    setDraft((d) => ({ ...d, bank: { ...d.bank, ...patch } }));
    clearAiFields(Object.keys(patch).map((field) => `bank:${field}`));
  };

  const patchAttachment = (key: string, patch: Partial<LocalAttachment>) =>
    setAttachments((list) => list.map((a) => (a.key === key && a.kind === 'local' ? { ...a, ...patch } : a)));

  /** Reads a receipt and overwrites its own item's fields (and the payee) with what it found. */
  const analyzeAttachment = async (key: string, fileId: string, mimeType: string, uri: string, itemKey: string) => {
    const isPdf = mimeType === 'application/pdf';
    patchAttachment(key, { analyzeStage: isPdf ? 'reading' : 'scanning', analyzeError: undefined, filledCount: undefined });
    try {
      // PDFs are text-extracted server-side; images need on-device OCR text sent along.
      const text = isPdf ? undefined : (await recognizeText(uri)) ?? undefined;
      patchAttachment(key, { analyzeStage: 'reading' });
      const { suggestion } = await api.analyzeAttachment({ claimId: p.claimId, fileId, ...(text ? { text } : {}) });
      if (removedKeys.current.has(key)) return; // removed while being read: don't fill the form from it
      const result = applySuggestion(draftRef.current, itemKey, suggestion, { payeeEditedByUser: payeeEditedByUser.current });
      draftRef.current = result.draft;
      setDraft(result.draft);
      if (result.aiFields.size) setAiFields((prev) => new Set([...prev, ...result.aiFields]));
      patchAttachment(key, { analyzeStage: undefined, analyzed: true, filledCount: result.aiFields.size });
    } catch {
      patchAttachment(key, { analyzeStage: undefined, analyzed: true, analyzeError: "Couldn't read" });
    }
  };

  /** Uploads `files` straight away and analyses each one as soon as its upload finishes. */
  const uploadAndAnalyze = async (files: LocalAttachment[]) => {
    const byKey = new Map(files.map((f) => [f.key, f]));
    const onAttachmentUpdate = (key: string, patch: Partial<LocalAttachment>) => {
      if (removedKeys.current.has(key)) {
        if (patch.uploadedId) discardFromDrive([patch.uploadedId]);
        return;
      }
      patchAttachment(key, patch);
      const file = patch.uploadedId ? byKey.get(key) : undefined;
      if (file) void analyzeAttachment(key, patch.uploadedId!, file.mimeType, file.uri, file.itemKey ?? '');
    };
    try {
      await uploadPendingAttachments(api, putFile, p.claimId, files, onAttachmentUpdate);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Upload failed';
      for (const file of files) patchAttachment(file.key, { error: message, progress: undefined });
    }
  };

  /** Adds receipts under the item whose tab was open when the picker was launched. */
  const addFiles = async (pick: () => Promise<LocalAttachment[]>) => {
    const itemKey = active.key;
    try {
      const picked = (await pick()).map((f) => ({ ...f, itemKey }));
      if (picked.length === 0) return;
      setAttachments((a) => [...a, ...picked].slice(0, MAX_ATTACHMENTS));
      await uploadAndAnalyze(picked);
    } catch (e) {
      Alert.alert('Could not add file', friendlyMessage(e));
    }
  };

  /** Best effort: anything missed here is trashed by the server's daily cleanup of unsubmitted uploads. */
  const discardFromDrive = (fileIds: string[]) => {
    api.discardUpload({ claimId: p.claimId, fileIds }).catch(() => {});
  };

  const removeAttachment = (key: string) => {
    const a = attachments.find((x) => x.key === key);
    removedKeys.current.add(key);
    setAttachments((list) => list.filter((x) => x.key !== key));
    // Saved attachments of a claim being resubmitted stay until the resubmission replaces them.
    if (a?.kind === 'local' && a.uploadedId) discardFromDrive([a.uploadedId]);
  };

  const retryAttachment = (key: string, step: 'upload' | 'analyze') => {
    const a = attachments.find((x): x is LocalAttachment => x.key === key && x.kind === 'local');
    if (!a) return;
    if (step === 'upload') {
      patchAttachment(key, { error: undefined, progress: undefined });
      void uploadAndAnalyze([{ ...a, error: undefined }]);
    } else if (a.uploadedId) {
      void analyzeAttachment(key, a.uploadedId, a.mimeType, a.uri, a.itemKey ?? '');
    }
  };

  const addItem = () => {
    const item = emptyItem();
    setDraft((d) => ({ ...d, items: [...d.items, item] }));
    setActiveKey(item.key);
  };

  const removeItem = (key: string) => {
    const index = draft.items.findIndex((i) => i.key === key);
    const receipts = receiptsForItem(attachments, key);
    const doRemove = () => {
      for (const r of receipts) removeAttachment(r.key);
      setDraft((d) => ({ ...d, items: d.items.filter((i) => i.key !== key) }));
      const next = draft.items[index + 1] ?? draft.items[index - 1];
      if (next) setActiveKey(next.key);
    };
    Alert.alert(
      `Remove item ${index + 1}?`,
      receipts.length ? `Its ${receipts.length} receipt${receipts.length === 1 ? '' : 's'} will be removed too.` : undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: doRemove },
      ],
    );
  };

  const submit = async () => {
    setShowErrors(true);
    if (errors.length) {
      const firstBad = draft.items.find((i) => itemErrors(i).length);
      if (firstBad) setActiveKey(firstBad.key);
      Alert.alert('Please fix these first', errors.join('\n'));
      return;
    }
    setSubmitting(true);
    try {
      // Item by item, so the merged PDF's receipts follow the items.
      const ordered = orderByItem(attachments, draft.items);
      await runSubmitFlow({ api, putFile }, { claimId: p.claimId, draft, attachments: ordered, resubmit: p.resubmit }, patchAttachment);
      p.onSubmitted(p.claimId);
    } catch (e) {
      Alert.alert('Not submitted', friendlyMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  const tabs: ItemTab[] = draft.items.map((item) => {
    const receipts = receiptsForItem(attachments, item.key);
    const cents = parseAmountToCents(item.amount);
    return {
      key: item.key,
      amountLabel: cents !== null && cents > 0 ? formatRM(cents) : '—',
      receiptCount: receipts.length,
      busy: receipts.some((r) => r.kind === 'local' && !r.error && (!r.uploadedId || r.analyzeStage !== undefined)),
      hasError: showErrors && itemErrors(item).length > 0,
    };
  });
  const activeReceipts = receiptsForItem(attachments, active.key);
  const otherReceipts = unlinkedReceipts(attachments, draft.items);
  const activeErrors = showErrors ? itemErrors(active) : [];

  return (
    <Screen>
      <Section
        title={`Items (${draft.items.length})`}
        right={<Text style={styles.total}>{formatRM(draftTotalCents(draft))}</Text>}
      >
        <ItemTabs tabs={tabs} activeKey={active.key} onSelect={setActiveKey} onAdd={submitting ? undefined : addItem} />

        <View style={styles.item}>
          <TextField
            label="Doc No. (optional)"
            value={active.reference}
            onChangeText={(t) => setItem(active.key, { reference: t })}
            autoCapitalize="characters"
            placeholder="e.g. ICS-000024"
            badge={aiFields.has(`item:${active.key}:reference`) ? 'AI' : undefined}
          />
          <TextField
            label="Description / purpose"
            value={active.description}
            onChangeText={(t) => setItem(active.key, { description: t })}
            placeholder="e.g. Parking at client office"
            badge={aiFields.has(`item:${active.key}:description`) ? 'AI' : undefined}
          />
          <TextField
            label="Amount (RM)"
            value={active.amount}
            onChangeText={(t) => setItem(active.key, { amount: t })}
            keyboardType="decimal-pad"
            placeholder="0.00"
            badge={aiFields.has(`item:${active.key}:amount`) ? 'AI' : undefined}
          />
          {activeErrors.length ? <Text style={styles.errors}>{activeErrors.join('\n')}</Text> : null}
        </View>

        <View style={styles.receipts}>
          <View style={styles.receiptsHead}>
            <Text style={styles.subTitle}>Receipts for item {activeIndex + 1}</Text>
            <Text style={styles.count}>{attachments.length}/{MAX_ATTACHMENTS} in claim</Text>
          </View>
          {activeReceipts.length ? (
            <AttachmentList
              claimId={p.claimId}
              items={activeReceipts}
              onRemove={submitting ? undefined : removeAttachment}
              onRetry={submitting ? undefined : retryAttachment}
            />
          ) : (
            <Text style={styles.hint}>Add this item's receipt. Its details fill in automatically.</Text>
          )}
          <View style={styles.row}>
            <View style={styles.flex}><Button title="Camera" icon="camera-outline" variant="secondary" disabled={remaining <= 0 || submitting} onPress={() => addFiles(pickFromCamera)} /></View>
            <View style={styles.flex}><Button title="Photos" icon="images-outline" variant="secondary" disabled={remaining <= 0 || submitting} onPress={() => addFiles(() => pickFromLibrary(remaining))} /></View>
            <View style={styles.flex}><Button title="PDF" icon="document-outline" variant="secondary" disabled={remaining <= 0 || submitting} onPress={() => addFiles(() => pickPdfs(remaining))} /></View>
          </View>
        </View>

        {draft.items.length > 1 ? (
          <Button title={`Remove item ${activeIndex + 1}`} icon="trash-outline" variant="danger" disabled={submitting} onPress={() => removeItem(active.key)} />
        ) : null}
      </Section>

      {otherReceipts.length ? (
        <Section title={`Other receipts (${otherReceipts.length})`}>
          <Text style={styles.hint}>Receipts already on this claim. Remove any you are replacing.</Text>
          <AttachmentList
            claimId={p.claimId}
            items={otherReceipts}
            onRemove={submitting ? undefined : removeAttachment}
            onRetry={submitting ? undefined : retryAttachment}
          />
        </Section>
      ) : null}

      <Section title="Pay to">
        <TextField
          label="Bank"
          value={draft.bank.bankName}
          onChangeText={(t) => setBank({ bankName: t })}
          badge={aiFields.has('bank:bankName') ? 'AI' : undefined}
        />
        <TextField
          label="Account holder"
          value={draft.bank.accountHolder}
          onChangeText={(t) => setBank({ accountHolder: t })}
          autoCapitalize="words"
          badge={aiFields.has('bank:accountHolder') ? 'AI' : undefined}
        />
        <TextField
          label="Account number"
          value={draft.bank.accountNumber}
          onChangeText={(t) => setBank({ accountNumber: t })}
          keyboardType="number-pad"
          badge={aiFields.has('bank:accountNumber') ? 'AI' : undefined}
        />
        {p.showSaveBank ? (
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Also save to my profile</Text>
            <Switch value={draft.saveBankToProfile} onValueChange={(v) => setDraft((d) => ({ ...d, saveBankToProfile: v }))} />
          </View>
        ) : null}
      </Section>

      {showErrors && errors.length ? <Text style={styles.errors}>{errors.join('\n')}</Text> : null}
      <Button title={p.submitLabel} onPress={submit} loading={submitting} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  total: { fontSize: 18, fontWeight: '800', color: colors.text },
  item: { gap: space(2) },
  receipts: { gap: space(2), paddingTop: space(3), borderTopWidth: 1, borderTopColor: colors.border },
  receiptsHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  subTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  count: { fontSize: 12, color: colors.muted },
  hint: { color: colors.muted },
  row: { flexDirection: 'row', gap: space(2) },
  flex: { flex: 1 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  switchLabel: { fontSize: 15, color: colors.text },
  errors: { color: colors.danger, fontSize: 13, lineHeight: 20 },
});
