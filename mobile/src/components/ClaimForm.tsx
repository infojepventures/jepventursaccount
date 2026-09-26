import { useRef, useState } from 'react';
import { Alert, StyleSheet, Switch, Text, View } from 'react-native';
import { formatRM, MAX_ATTACHMENTS, parseAmountToCents } from '@jep/shared';
import { applySuggestion } from '../claims/applySuggestion';
import { claimSummary } from '../claims/claimSummary';
import { draftErrors, emptyItem, itemErrors, type ClaimDraft, type DraftItem } from '../claims/draft';
import { orderByItem, receiptsForItem, unlinkedReceipts } from '../claims/itemReceipts';
import { recordPayeeChange, removePayeeSources, type PayeeHistory } from '../claims/payeeHistory';
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
import { ClaimSummaryCard } from './ClaimSummaryCard';
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
  // Receipts that overwrote Pay to, so removing one can put back the details from before it.
  const payeeHistory = useRef<PayeeHistory>([]);
  // Latest attachments, for callbacks that outlive a render (upload/OCR completions, the remove-item dialog).
  // Every change goes through updateAttachments so this never lags behind state.
  const attachmentsRef = useRef(attachments);
  const updateAttachments = (fn: (list: AnyAttachment[]) => AnyAttachment[]) => {
    attachmentsRef.current = fn(attachmentsRef.current);
    setAttachments(attachmentsRef.current);
  };

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
    updateAttachments((list) => list.map((a) => (a.key === key && a.kind === 'local' ? { ...a, ...patch } : a)));
  const findLocal = (key: string) => attachmentsRef.current.find((x): x is LocalAttachment => x.key === key && x.kind === 'local');

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
      const before = draftRef.current;
      const opts = { payeeEditedByUser: payeeEditedByUser.current };
      const result = applySuggestion(before, itemKey, suggestion, opts);
      if (result.draft.bank !== before.bank) payeeHistory.current = recordPayeeChange(payeeHistory.current, key, before.bank);
      draftRef.current = result.draft;
      // Re-apply on the latest state (applySuggestion is pure and deterministic) so a keystroke queued since
      // the last render isn't overwritten.
      setDraft((d) => applySuggestion(d, itemKey, suggestion, opts).draft);
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
      // Only files that didn't make it: ones already uploaded in this batch keep their status.
      const message = e instanceof Error ? e.message : 'Upload failed';
      for (const file of files) if (!findLocal(file.key)?.uploadedId) patchAttachment(file.key, { error: message, progress: undefined });
    }
  };

  /** Adds receipts under the item whose tab was open when the picker was launched. */
  const addFiles = async (pick: () => Promise<LocalAttachment[]>) => {
    const itemKey = active.key;
    try {
      const picked = (await pick()).map((f) => ({ ...f, itemKey }));
      // Cap against the latest count (the picker may ignore its limit, or a second pick may have landed).
      const accepted = picked.slice(0, Math.max(0, MAX_ATTACHMENTS - attachmentsRef.current.length));
      if (accepted.length < picked.length) {
        Alert.alert('Receipt limit reached', `A claim can have up to ${MAX_ATTACHMENTS} receipts. ${picked.length - accepted.length} not added.`);
      }
      if (accepted.length === 0) return;
      updateAttachments((a) => [...a, ...accepted]);
      await uploadAndAnalyze(accepted);
    } catch (e) {
      Alert.alert('Could not add file', friendlyMessage(e));
    }
  };

  /** Best effort. For a claim that is never submitted the server's daily cleanup catches anything missed. */
  const discardFromDrive = (fileIds: string[]) => {
    api.discardUpload({ claimId: p.claimId, fileIds }).catch(() => {});
  };

  const removeAttachment = (key: string) => {
    const a = attachmentsRef.current.find((x) => x.key === key);
    removedKeys.current.add(key);
    updateAttachments((list) => list.filter((x) => x.key !== key));
    // Saved attachments of a claim being resubmitted stay until the resubmission replaces them.
    if (a?.kind === 'local' && a.uploadedId) discardFromDrive([a.uploadedId]);
    restorePayee(key);
  };

  /** If the removed receipt's details are what Pay to shows, put back what was there before it. */
  const restorePayee = (key: string) => {
    const { history, restore } = removePayeeSources(payeeHistory.current, [key]);
    payeeHistory.current = history;
    if (!restore || payeeEditedByUser.current) return; // never undo the user's own typing
    draftRef.current = { ...draftRef.current, bank: restore };
    setDraft((d) => ({ ...d, bank: restore }));
    if (history.length === 0) clearAiFields(['bank:bankName', 'bank:accountHolder', 'bank:accountNumber']);
  };

  const retryAttachment = (key: string, step: 'upload' | 'analyze') => {
    const a = findLocal(key);
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
      // Re-read at confirm time: uploads may have finished (or receipts been added) while the dialog was open.
      for (const r of receiptsForItem(attachmentsRef.current, key)) removeAttachment(r.key);
      const items = draftRef.current.items;
      const at = items.findIndex((i) => i.key === key);
      const next = items[at + 1] ?? items[at - 1];
      setDraft((d) => ({ ...d, items: d.items.filter((i) => i.key !== key) }));
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
    if (claimSummary(draft, attachmentsRef.current).busyReceipts > 0) {
      // Submitting now would upload in-flight files a second time and skip the details still being read.
      Alert.alert('Receipts still loading', 'Wait until every receipt has finished uploading and reading, then submit.');
      return;
    }
    setSubmitting(true);
    try {
      // Item by item, so the merged PDF's receipts follow the items.
      const ordered = orderByItem(attachmentsRef.current, draft.items);
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
      <ClaimSummaryCard summary={claimSummary(draft, attachments)} onJumpToItem={setActiveKey} />

      <Section title={`Items (${draft.items.length})`}>
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
