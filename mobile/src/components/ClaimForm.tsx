import { useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import {
  extractSuggestionFromText, formatRM, MAX_ATTACHMENTS, parseAmountToCents, validateBank, type AttachmentSuggestion, type BankDetails,
} from '@jep/shared';
import { applySuggestion } from '../claims/applySuggestion';
import { extractPdfText } from '../claims/pdfText';
import { claimSummary } from '../claims/claimSummary';
import { draftErrors, draftIsDirty, emptyItem, itemErrors, type ClaimDraft, type DraftItem } from '../claims/draft';
import { orderByItem, receiptsForItem, unlinkedReceipts } from '../claims/itemReceipts';
import { payeeChoices } from '../claims/split';
import { recordPayeeChange, removePayeeSources, type PayeeHistory } from '../claims/payeeHistory';
import { recognizeText } from '../claims/ocr';
import { pickFromCamera, pickFromLibrary, pickPdfs } from '../claims/pickers';
import { putFile } from '../claims/putFile';
import { runSplitSubmit, uploadPendingAttachments, type SubmittedGroup } from '../claims/submitFlow';
import type { AnyAttachment, LocalAttachment } from '../claims/types';
import { friendlyMessage } from '../lib/api';
import { api } from '../lib/apiInstance';
import { newClaimId } from '../lib/firebase';
import { Button } from '../ui/Button';
import { Screen } from '../ui/Screen';
import { Section } from '../ui/Section';
import { TextField } from '../ui/TextField';
import { colors, space } from '../ui/theme';
import { AttachmentList } from './AttachmentList';
import { ClaimSummaryCard } from './ClaimSummaryCard';
import { ItemPayee } from './ItemPayee';
import { ItemTabs, type ItemTab } from './ItemTabs';

export function ClaimForm(p: {
  claimId: string;
  resubmit: boolean;
  initialDraft: ClaimDraft;
  initialAttachments: AnyAttachment[];
  submitLabel: string;
  /** One id, or several when items paying different people were submitted as separate claims. */
  onSubmitted: (claimIds: string[]) => void;
  /** Shows a discard button while the form has changes; called after they (and new uploads) are thrown away. */
  onDiscarded?: () => void;
  discardLabel?: string;
}) {
  const [draft, setDraft] = useState<ClaimDraft>(p.initialDraft);
  const [attachments, setAttachments] = useState<AnyAttachment[]>(p.initialAttachments);
  const [submitting, setSubmitting] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [aiFields, setAiFields] = useState<Set<string>>(new Set());
  const [activeKey, setActiveKey] = useState(p.initialDraft.items[0]?.key ?? '');
  // Items whose payee the user edited (or reset): a receipt read later never overwrites that.
  const payeeEdited = useRef(new Set<string>());
  // Latest draft for async OCR callbacks: applySuggestion must run outside a setState updater so its
  // AI-filled field keys are available synchronously (React may defer updaters).
  const draftRef = useRef(draft);
  draftRef.current = draft;
  // Receipts removed from the form. An upload still in flight when removed is discarded once it lands.
  const removedKeys = useRef(new Set<string>());
  // Per item: receipts that overwrote its payee, so removing one can put back what was there before it.
  const payeeHistories = useRef(new Map<string, PayeeHistory>());
  // Latest attachments, for callbacks that outlive a render (upload/OCR completions, the remove-item dialog).
  // Every change goes through updateAttachments so this never lags behind state.
  const attachmentsRef = useRef(attachments);
  const updateAttachments = (fn: (list: AnyAttachment[]) => AnyAttachment[]) => {
    attachmentsRef.current = fn(attachmentsRef.current);
    setAttachments(attachmentsRef.current);
  };

  const errors = draftErrors(draft, attachments, { resubmit: p.resubmit });
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
  const payeeBadges = (itemKey: string) => ['bankName', 'accountHolder', 'accountNumber'].map((f) => `item:${itemKey}:payee:${f}`);
  /** Gives an item its own payee (a copy of the default to edit) or edits it; the user's edits always win. */
  const setItemPayee = (itemKey: string, patch: Partial<BankDetails>) => {
    payeeEdited.current.add(itemKey);
    setDraft((d) => ({
      ...d,
      items: d.items.map((i) => (i.key === itemKey ? { ...i, payee: { ...(i.payee ?? d.bank), ...patch } } : i)),
    }));
    clearAiFields(Object.keys(patch).map((field) => `item:${itemKey}:payee:${field}`));
  };
  /** One-tap choice of a payee another item already uses (or the default). */
  const pickPayee = (itemKey: string, payee: BankDetails, isDefault: boolean) => {
    if (isDefault) return useDefaultPayee(itemKey);
    payeeEdited.current.add(itemKey);
    setDraft((d) => ({ ...d, items: d.items.map((i) => (i.key === itemKey ? { ...i, payee: { ...payee } } : i)) }));
    clearAiFields(payeeBadges(itemKey));
  };
  /** Every item pays what this item pays (its own payee, or the default). */
  const applyPayeeToAll = (itemKey: string) => {
    const source = draftRef.current.items.find((i) => i.key === itemKey);
    if (!source) return;
    const payee = source.payee ? { ...source.payee } : null;
    for (const i of draftRef.current.items) payeeEdited.current.add(i.key);
    setDraft((d) => ({ ...d, items: d.items.map((i) => ({ ...i, payee: payee ? { ...payee } : null })) }));
    clearAiFields(draftRef.current.items.filter((i) => i.key !== itemKey).flatMap((i) => payeeBadges(i.key)));
  };
  const useDefaultPayee = (itemKey: string) => {
    payeeEdited.current.add(itemKey);
    setDraft((d) => ({ ...d, items: d.items.map((i) => (i.key === itemKey ? { ...i, payee: null } : i)) }));
    clearAiFields(payeeBadges(itemKey));
  };

  const patchAttachment = (key: string, patch: Partial<LocalAttachment>) =>
    updateAttachments((list) => list.map((a) => (a.key === key && a.kind === 'local' ? { ...a, ...patch } : a)));
  const findLocal = (key: string) => attachmentsRef.current.find((x): x is LocalAttachment => x.key === key && x.kind === 'local');

  // Per receipt: 'server' once on-device reading found no text (a scanned PDF), so the server analyses it as
  // soon as its upload lands; 'done' once it has been read.
  const analysisOutcome = useRef(new Map<string, 'done' | 'server'>());

  /** Overwrites the receipt's own item's fields (and the payee) with what was read from it. */
  const applyReceiptSuggestion = (key: string, itemKey: string, suggestion: AttachmentSuggestion) => {
    const before = draftRef.current;
    const opts = { payeeEditedByUser: payeeEdited.current.has(itemKey) };
    const result = applySuggestion(before, itemKey, suggestion, opts);
    const payeeBefore = before.items.find((i) => i.key === itemKey)?.payee ?? null;
    const payeeAfter = result.draft.items.find((i) => i.key === itemKey)?.payee ?? null;
    if (payeeAfter !== payeeBefore) {
      payeeHistories.current.set(itemKey, recordPayeeChange(payeeHistories.current.get(itemKey) ?? [], key, payeeBefore));
    }
    draftRef.current = result.draft;
    // Re-apply on the latest state (applySuggestion is pure and deterministic) so a keystroke queued since
    // the last render isn't overwritten.
    setDraft((d) => applySuggestion(d, itemKey, suggestion, opts).draft);
    if (result.aiFields.size) setAiFields((prev) => new Set([...prev, ...result.aiFields]));
    patchAttachment(key, { analyzeStage: undefined, analyzed: true, filledCount: result.aiFields.size });
  };

  /**
   * Reads a receipt on the device right after it is picked, in parallel with its upload: ML Kit OCR for photos,
   * the PDF's text layer for PDFs, then the shared extraction rules. Only a PDF with no text (scanned) waits for
   * its upload and goes to the server.
   */
  const analyzeLocally = async (file: LocalAttachment) => {
    const { key, uri, mimeType } = file;
    const itemKey = file.itemKey ?? '';
    const isPdf = mimeType === 'application/pdf';
    analysisOutcome.current.delete(key);
    patchAttachment(key, { analyzeStage: 'scanning', analyzeError: undefined, filledCount: undefined });
    const text = isPdf ? await extractPdfText(uri) : await recognizeText(uri);
    if (removedKeys.current.has(key)) return; // removed while being read: don't fill the form from it
    if (text) {
      analysisOutcome.current.set(key, 'done');
      applyReceiptSuggestion(key, itemKey, extractSuggestionFromText(text));
      return;
    }
    if (!isPdf) {
      analysisOutcome.current.set(key, 'done');
      patchAttachment(key, { analyzeStage: undefined, analyzed: true, filledCount: 0 });
      return;
    }
    analysisOutcome.current.set(key, 'server');
    patchAttachment(key, { analyzeStage: 'reading' });
    const uploadedId = findLocal(key)?.uploadedId;
    if (uploadedId) void analyzeOnServer(key, uploadedId, itemKey);
  };

  /** Server-side reading of an uploaded PDF (text layer, or Document AI when configured). */
  const analyzeOnServer = async (key: string, fileId: string, itemKey: string) => {
    analysisOutcome.current.set(key, 'done');
    patchAttachment(key, { analyzeStage: 'reading', analyzeError: undefined });
    try {
      const { suggestion } = await api.analyzeAttachment({ claimId: p.claimId, fileId });
      if (removedKeys.current.has(key)) return;
      applyReceiptSuggestion(key, itemKey, suggestion);
    } catch {
      patchAttachment(key, { analyzeStage: undefined, analyzed: true, analyzeError: "Couldn't read" });
    }
  };

  /** Uploads `files` straight away; a scanned PDF is analysed on the server once its upload lands. */
  const uploadAndAnalyze = async (files: LocalAttachment[]) => {
    const byKey = new Map(files.map((f) => [f.key, f]));
    const onAttachmentUpdate = (key: string, patch: Partial<LocalAttachment>) => {
      if (removedKeys.current.has(key)) {
        if (patch.uploadedId) discardFromDrive([patch.uploadedId]);
        return;
      }
      patchAttachment(key, patch);
      const file = patch.uploadedId ? byKey.get(key) : undefined;
      if (file && analysisOutcome.current.get(key) === 'server') void analyzeOnServer(key, patch.uploadedId!, file.itemKey ?? '');
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
      for (const file of accepted) void analyzeLocally(file);
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
    if (a?.itemKey) restorePayee(key, a.itemKey);
  };

  /** If the removed receipt's details are what the item's Pay to shows, put back what was there before it. */
  const restorePayee = (key: string, itemKey: string) => {
    const { history, restore } = removePayeeSources(payeeHistories.current.get(itemKey) ?? [], [key]);
    payeeHistories.current.set(itemKey, history);
    if (!restore || payeeEdited.current.has(itemKey)) return; // never undo the user's own typing
    const items = draftRef.current.items.map((i) => (i.key === itemKey ? { ...i, payee: restore.value } : i));
    draftRef.current = { ...draftRef.current, items };
    setDraft((d) => ({ ...d, items: d.items.map((i) => (i.key === itemKey ? { ...i, payee: restore.value } : i)) }));
    if (history.length === 0) clearAiFields(payeeBadges(itemKey));
  };

  const retryAttachment = (key: string, step: 'upload' | 'analyze') => {
    const a = findLocal(key);
    if (!a) return;
    if (step === 'upload') {
      patchAttachment(key, { error: undefined, progress: undefined });
      void uploadAndAnalyze([{ ...a, error: undefined }]);
    } else {
      void analyzeLocally(a);
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

  const hasNewReceipts = attachments.some((a) => a.kind === 'local');
  const canDiscard = !!p.onDiscarded && (hasNewReceipts || draftIsDirty(p.initialDraft, draft));

  /** Throws the draft away: receipts added in this form are removed from Drive (in-flight ones once they land). */
  const discard = () => {
    const added = attachmentsRef.current.filter((a): a is LocalAttachment => a.kind === 'local');
    Alert.alert(
      p.resubmit ? 'Discard your changes?' : 'Discard this claim?',
      added.length ? `The ${added.length} receipt${added.length === 1 ? '' : 's'} you added will be deleted.` : undefined,
      [
        { text: 'Keep editing', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            for (const a of added) removedKeys.current.add(a.key);
            const uploaded = added.map((a) => a.uploadedId).filter((id): id is string => !!id);
            if (uploaded.length) discardFromDrive(uploaded);
            p.onDiscarded?.();
          },
        },
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
    const done: string[] = [];
    // A split-off claim is final: take its items and receipts out of the form (so a retry after a later failure
    // only sends the rest) and drop the originals it re-uploaded from this form's upload folder.
    const onGroupSubmitted = (g: SubmittedGroup) => {
      done.push(g.claimId);
      if (g.claimId === p.claimId) return;
      if (g.movedUploadIds.length) discardFromDrive(g.movedUploadIds);
      for (const k of g.attachmentKeys) removedKeys.current.add(k);
      const gone = new Set(g.itemKeys);
      updateAttachments((list) => list.filter((a) => !g.attachmentKeys.includes(a.key)));
      draftRef.current = { ...draftRef.current, items: draftRef.current.items.filter((i) => !gone.has(i.key)) };
      setDraft((d) => ({ ...d, items: d.items.filter((i) => !gone.has(i.key)) }));
      const next = draftRef.current.items[0];
      if (next) setActiveKey(next.key);
    };
    try {
      // Item by item, so the merged PDF's receipts follow the items.
      const ordered = orderByItem(attachmentsRef.current, draft.items);
      const ids = await runSplitSubmit(
        { api, putFile, newClaimId },
        { claimId: p.claimId, draft, attachments: ordered, resubmit: p.resubmit },
        patchAttachment,
        onGroupSubmitted,
      );
      p.onSubmitted(ids);
    } catch (e) {
      const partial = done.length
        ? `${done.length} claim${done.length === 1 ? ' was' : 's were'} submitted; the rest are still here. `
        : '';
      Alert.alert('Not submitted', `${partial}${friendlyMessage(e)}`);
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
      hasError: showErrors && (itemErrors(item).length > 0 || (!!item.payee && validateBank(item.payee).length > 0)),
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

        <ItemPayee
          payee={active.payee ?? draft.bank}
          own={!!active.payee}
          hasDefault={validateBank(draft.bank).length === 0}
          choices={payeeChoices(draft, active.key)}
          onPick={(payee, isDefault) => pickPayee(active.key, payee, isDefault)}
          onApplyToAll={draft.items.length > 1 ? () => applyPayeeToAll(active.key) : undefined}
          badge={(field) => (aiFields.has(`item:${active.key}:payee:${field}`) ? 'AI' : undefined)}
          onChange={(patch) => setItemPayee(active.key, patch)}
          onUseOwn={() => setItemPayee(active.key, {})}
          onUseDefault={() => useDefaultPayee(active.key)}
          disabled={submitting}
        />

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


      {showErrors && errors.length ? <Text style={styles.errors}>{errors.join('\n')}</Text> : null}
      <Button title={p.submitLabel} onPress={submit} loading={submitting} />
      {canDiscard && !submitting ? (
        <Button title={p.discardLabel ?? 'Discard draft'} variant="ghost" icon="trash-outline" onPress={discard} />
      ) : null}
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
  errors: { color: colors.danger, fontSize: 13, lineHeight: 20 },
});
