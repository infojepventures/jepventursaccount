import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { formatRM, MAX_ATTACHMENTS } from '@jep/shared';
import { draftErrors, draftTotalCents, emptyItem, type ClaimDraft, type DraftItem } from '../claims/draft';
import { pickFromCamera, pickFromLibrary, pickPdfs } from '../claims/pickers';
import { putFile } from '../claims/putFile';
import { runSubmitFlow } from '../claims/submitFlow';
import type { AnyAttachment, LocalAttachment } from '../claims/types';
import { friendlyMessage } from '../lib/api';
import { api } from '../lib/apiInstance';
import { Button } from '../ui/Button';
import { Screen } from '../ui/Screen';
import { Section } from '../ui/Section';
import { TextField } from '../ui/TextField';
import { colors, space } from '../ui/theme';
import { AttachmentList } from './AttachmentList';

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

  const errors = draftErrors(draft, attachments.length);
  const remaining = MAX_ATTACHMENTS - attachments.length;

  const setItem = (key: string, patch: Partial<DraftItem>) =>
    setDraft((d) => ({ ...d, items: d.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) }));
  const setBank = (patch: Partial<ClaimDraft['bank']>) => setDraft((d) => ({ ...d, bank: { ...d.bank, ...patch } }));
  const addFiles = async (pick: () => Promise<LocalAttachment[]>) => {
    try {
      const picked = await pick();
      setAttachments((a) => [...a, ...picked].slice(0, MAX_ATTACHMENTS));
    } catch (e) {
      Alert.alert('Could not add file', friendlyMessage(e));
    }
  };
  const patchAttachment = (key: string, patch: Partial<LocalAttachment>) =>
    setAttachments((list) => list.map((a) => (a.key === key && a.kind === 'local' ? { ...a, ...patch } : a)));

  const submit = async () => {
    setShowErrors(true);
    if (errors.length) {
      Alert.alert('Please fix these first', errors.join('\n'));
      return;
    }
    setSubmitting(true);
    try {
      await runSubmitFlow({ api, putFile }, { claimId: p.claimId, draft, attachments, resubmit: p.resubmit }, patchAttachment);
      p.onSubmitted(p.claimId);
    } catch (e) {
      Alert.alert('Not submitted', friendlyMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen>
      <Section
        title="Items"
        right={<Text style={styles.total}>{formatRM(draftTotalCents(draft))}</Text>}
      >
        {draft.items.map((item, i) => (
          <View key={item.key} style={styles.item}>
            <View style={styles.itemHead}>
              <Text style={styles.itemNo}>Item {i + 1}</Text>
              {draft.items.length > 1 ? (
                <Pressable onPress={() => setDraft((d) => ({ ...d, items: d.items.filter((x) => x.key !== item.key) }))}>
                  <Text style={styles.remove}>Remove</Text>
                </Pressable>
              ) : null}
            </View>
            <TextField
              label="Doc No. (optional)"
              value={item.reference}
              onChangeText={(t) => setItem(item.key, { reference: t })}
              autoCapitalize="characters"
              placeholder="e.g. ICS-000024"
            />
            <TextField
              label="Description / purpose"
              value={item.description}
              onChangeText={(t) => setItem(item.key, { description: t })}
              placeholder="e.g. Parking at client office"
            />
            <TextField
              label="Amount (RM)"
              value={item.amount}
              onChangeText={(t) => setItem(item.key, { amount: t })}
              keyboardType="decimal-pad"
              placeholder="0.00"
            />
          </View>
        ))}
        <Button title="Add item" variant="secondary" icon="add" onPress={() => setDraft((d) => ({ ...d, items: [...d.items, emptyItem()] }))} />
      </Section>

      <Section title={`Receipts (${attachments.length}/${MAX_ATTACHMENTS})`}>
        {attachments.length ? (
          <AttachmentList
            claimId={p.claimId}
            items={attachments}
            onRemove={submitting ? undefined : (key) => setAttachments((a) => a.filter((x) => x.key !== key))}
          />
        ) : (
          <Text style={styles.hint}>Add at least one photo or PDF of your receipt.</Text>
        )}
        <View style={styles.row}>
          <View style={styles.flex}><Button title="Camera" icon="camera-outline" variant="secondary" disabled={remaining <= 0 || submitting} onPress={() => addFiles(pickFromCamera)} /></View>
          <View style={styles.flex}><Button title="Photos" icon="images-outline" variant="secondary" disabled={remaining <= 0 || submitting} onPress={() => addFiles(() => pickFromLibrary(remaining))} /></View>
          <View style={styles.flex}><Button title="PDF" icon="document-outline" variant="secondary" disabled={remaining <= 0 || submitting} onPress={() => addFiles(() => pickPdfs(remaining))} /></View>
        </View>
      </Section>

      <Section title="Pay to">
        <TextField label="Bank" value={draft.bank.bankName} onChangeText={(t) => setBank({ bankName: t })} />
        <TextField label="Account holder" value={draft.bank.accountHolder} onChangeText={(t) => setBank({ accountHolder: t })} autoCapitalize="words" />
        <TextField label="Account number" value={draft.bank.accountNumber} onChangeText={(t) => setBank({ accountNumber: t })} keyboardType="number-pad" />
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
  item: { gap: space(2), paddingBottom: space(3), borderBottomWidth: 1, borderBottomColor: colors.border },
  itemHead: { flexDirection: 'row', justifyContent: 'space-between' },
  itemNo: { fontWeight: '700', color: colors.text },
  remove: { color: colors.danger, fontWeight: '600' },
  hint: { color: colors.muted },
  row: { flexDirection: 'row', gap: space(2) },
  flex: { flex: 1 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  switchLabel: { fontSize: 15, color: colors.text },
  errors: { color: colors.danger, fontSize: 13, lineHeight: 20 },
});
