import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { allowedActions, formatRM, formatYmd, formatYmdHms, isValidYmd, PDF_STUCK_AFTER_MS } from '@jep/shared';
import { useAuth } from '../../../auth/AuthProvider';
import { remoteAttachments } from '../../../claims/draft';
import { AttachmentList } from '../../../components/AttachmentList';
import { useClaim } from '../../../data/useClaims';
import { shareClaimFile } from '../../../files/shareFile';
import { api } from '../../../lib/apiInstance';
import { Button } from '../../../ui/Button';
import { PromptModal } from '../../../ui/PromptModal';
import { Screen } from '../../../ui/Screen';
import { Section } from '../../../ui/Section';
import { StatusBadge } from '../../../ui/StatusBadge';
import { colors, space } from '../../../ui/theme';
import { useBusy } from '../../../ui/useBusy';

const ACTION_LABEL: Record<string, string> = {
  submit: 'Submitted', resubmit: 'Resubmitted', cancel: 'Withdrawn', approve: 'Approved',
  reject: 'Rejected', mark_paid: 'Marked paid', pdf_regenerate: 'PDF regenerated',
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value || '-'}</Text>
    </View>
  );
}

export default function ClaimDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user, isAdmin } = useAuth();
  const { data: claim, loading } = useClaim(id);
  const [busy, run] = useBusy();
  const [modal, setModal] = useState<'reject' | 'paid' | null>(null);

  if (loading) return <ActivityIndicator style={{ marginTop: space(10) }} color={colors.primary} />;
  if (!claim) return <Screen><Text>Claim not found or you do not have access.</Text></Screen>;

  const actions = allowedActions({ status: claim.status, isApplicant: claim.applicant.uid === user?.uid, isAdmin });
  const can = (a: (typeof actions)[number]) => actions.includes(a);
  const pdfStuck =
    claim.pdf.status === 'generating' &&
    (!claim.pdf.requestedAt || Date.now() - claim.pdf.requestedAt.toDate().getTime() > PDF_STUCK_AFTER_MS);
  const confirm = (title: string, message: string, fn: () => Promise<unknown>, destructive = false) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: title, style: destructive ? 'destructive' : 'default', onPress: () => void run(async () => { await fn(); }) },
    ]);

  return (
    <>
      <Stack.Screen options={{ title: claim.refNo }} />
      <Screen>
        <View style={styles.header}>
          <StatusBadge status={claim.status} />
          <Text style={styles.total}>{formatRM(claim.totalCents)}</Text>
          <Text style={styles.muted}>Submitted {formatYmdHms(claim.submittedAt.toDate())}</Text>
        </View>

        {claim.status === 'rejected' && claim.review?.reason ? (
          <View style={styles.rejectBox}>
            <Text style={styles.rejectTitle}>Rejected by {claim.review.byName}</Text>
            <Text style={styles.rejectText}>{claim.review.reason}</Text>
          </View>
        ) : null}

        <Section title="Payment request PDF">
          {claim.pdf.status === 'generating' ? (
            <>
              <View style={styles.inline}><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>Generating PDF…</Text></View>
              {pdfStuck ? (
                <>
                  <Text style={{ color: colors.danger }}>PDF is taking too long. It may be stuck.</Text>
                  {can('regenerate_pdf') ? (
                    <Button
                      title="Regenerate PDF"
                      variant="secondary"
                      loading={busy}
                      onPress={() => run(async () => { await api.regeneratePdf({ claimId: claim.id }); })}
                    />
                  ) : null}
                </>
              ) : null}
            </>
          ) : claim.pdf.status === 'ready' && claim.pdf.driveFileId ? (
            <View style={styles.pdfActions}>
              <Button
                title="View PDF"
                icon="document-text-outline"
                variant="secondary"
                onPress={() =>
                  router.push({
                    pathname: '/viewer',
                    params: { claimId: claim.id, fileId: claim.pdf.driveFileId!, mimeType: 'application/pdf', name: claim.pdf.fileName ?? 'claim.pdf' },
                  })
                }
              />
              <Button
                title="WhatsApp"
                icon="logo-whatsapp"
                variant="secondary"
                loading={busy}
                onPress={() =>
                  run(async () => {
                    await shareClaimFile({
                      claimId: claim.id,
                      fileId: claim.pdf.driveFileId!,
                      name: claim.pdf.fileName ?? 'claim.pdf',
                      mimeType: 'application/pdf',
                      target: 'whatsapp',
                    });
                  })
                }
              />
            </View>
          ) : (
            <>
              <Text style={{ color: colors.danger }}>PDF generation failed: {claim.pdf.error}</Text>
              {can('regenerate_pdf') ? (
                <Button title="Regenerate PDF" variant="secondary" loading={busy} onPress={() => run(async () => { await api.regeneratePdf({ claimId: claim.id }); })} />
              ) : null}
            </>
          )}
        </Section>

        <Section title="Applicant">
          <Row label="Name" value={claim.applicant.name} />
          <Row label="Position" value={claim.applicant.position} />
        </Section>

        <Section title="Items">
          {claim.items.map((it, i) => (
            <Row key={i} label={`${i + 1}. ${it.description}`} value={formatRM(it.amountCents)} />
          ))}
          <Row label="Total" value={formatRM(claim.totalCents)} />
        </Section>

        <Section title="Pay to">
          <Row label="Bank" value={claim.payment.bankName} />
          <Row label="Account holder" value={claim.payment.accountHolder} />
          <Row label="Account number" value={claim.payment.accountNumber} />
          {claim.paidInfo ? <Row label="Paid on" value={`${claim.paidInfo.paidDate} ${claim.paidInfo.reference}`.trim()} /> : null}
        </Section>

        <Section title={`Receipts (${claim.attachments.length})`}>
          <AttachmentList claimId={claim.id} items={remoteAttachments(claim)} />
        </Section>

        <Section title="History">
          {claim.history.map((h, i) => (
            <Row key={i} label={`${ACTION_LABEL[h.action] ?? h.action} · ${h.byName}`} value={`${formatYmdHms(h.at.toDate())}${h.note ? `\n${h.note}` : ''}`} />
          ))}
        </Section>

        <View style={styles.actions}>
          {can('approve') ? (
            <Button title="Approve" icon="checkmark" loading={busy} onPress={() => confirm('Approve', 'This assigns the next PR number and generates the final PDF.', () => api.reviewClaim({ claimId: claim.id, decision: 'approve' }))} />
          ) : null}
          {can('reject') ? <Button title="Reject" variant="danger" disabled={busy} onPress={() => setModal('reject')} /> : null}
          {can('mark_paid') ? <Button title="Mark as paid" icon="cash-outline" disabled={busy} onPress={() => setModal('paid')} /> : null}
          {can('resubmit') ? (
            <Button title="Edit & resubmit" icon="create-outline" onPress={() => router.push({ pathname: '/claim/[id]/edit', params: { id: claim.id } })} />
          ) : null}
          {can('cancel') ? (
            <Button title="Withdraw claim" variant="danger" loading={busy} onPress={() => confirm('Withdraw', 'Withdraw this claim? This cannot be undone.', () => api.cancelClaim({ claimId: claim.id }), true)} />
          ) : null}
        </View>
      </Screen>

      <PromptModal
        visible={modal === 'reject'}
        title="Reject claim"
        message="The applicant will see this reason and can fix and resubmit."
        fields={[{ key: 'reason', label: 'Reason', multiline: true }]}
        confirmLabel="Reject"
        destructive
        onCancel={() => setModal(null)}
        onConfirm={async (v) => {
          const reason = String(v.reason ?? '').trim();
          if (!reason) throw new Error('Please enter a reason.');
          await api.reviewClaim({ claimId: claim.id, decision: 'reject', reason });
          setModal(null);
        }}
      />
      <PromptModal
        visible={modal === 'paid'}
        title="Mark as paid"
        fields={[
          { key: 'paidDate', label: 'Paid date (yyyy-MM-dd)', initial: formatYmd(new Date()), keyboardType: 'numbers-and-punctuation', autoCapitalize: 'none' },
          { key: 'reference', label: 'Payment reference (optional)', placeholder: 'e.g. IBG ref', autoCapitalize: 'none' },
        ]}
        confirmLabel="Mark paid"
        onCancel={() => setModal(null)}
        onConfirm={async (v) => {
          const paidDate = String(v.paidDate ?? '').trim();
          if (!isValidYmd(paidDate)) throw new Error('Enter the date as yyyy-MM-dd.');
          await api.markPaid({ claimId: claim.id, paidDate, reference: String(v.reference ?? '').trim() });
          setModal(null);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'flex-start', gap: space(1) },
  total: { fontSize: 32, fontWeight: '800', color: colors.text },
  muted: { color: colors.muted },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  pdfActions: { gap: space(3) },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: space(3) },
  label: { flex: 1, color: colors.muted },
  value: { flex: 1, textAlign: 'right', color: colors.text, fontWeight: '500' },
  rejectBox: { backgroundColor: '#FEF3F2', borderRadius: 12, padding: space(4), gap: space(1) },
  rejectTitle: { color: colors.danger, fontWeight: '700' },
  rejectText: { color: colors.text },
  actions: { gap: space(3) },
});
