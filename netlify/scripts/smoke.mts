import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { PDFDocument } from 'pdf-lib';
import type { ClaimDoc } from '@jep/shared';
import { toArrayBuffer } from '../lib/bytes';
import { DriveClient } from '../lib/drive';
import { env } from '../lib/env';
import { getAdminApp } from '../lib/firebaseAdmin';
import { CLAIM_SEQ_DOC, COL } from '../lib/firestore';
import { createTokenProvider, SCOPES } from '../lib/googleAuth';
import { SheetsClient } from '../lib/sheets';

const base = env('SMOKE_BASE_URL').replace(/\/$/, '');
const app = getAdminApp();
const auth = getAuth(app);
const db = getFirestore(app);
const getToken = createTokenProvider({
  clientEmail: env('GOOGLE_SA_EMAIL'),
  privateKey: env('GOOGLE_SA_PRIVATE_KEY').replace(/\\n/g, '\n'),
  scopes: [SCOPES.drive, SCOPES.sheets],
});
const drive = new DriveClient(getToken);
const sheets = new SheetsClient(getToken, env('GOOGLE_SHEET_ID'));

const UID = 'smoke-test-admin';
const EMAIL = 'smoke-test@jepventures.invalid';
const BANK = { bankName: 'Smoke Bank', accountHolder: 'Smoke Account', accountNumber: '0000 1111' };
const step = (s: string) => console.log(`→ ${s}`);

async function idToken(): Promise<string> {
  const custom = await auth.createCustomToken(UID);
  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${env('FIREBASE_WEB_API_KEY')}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }) },
  );
  const j = (await r.json()) as { idToken?: string };
  if (!j.idToken) throw new Error(`signInWithCustomToken failed: ${JSON.stringify(j)}`);
  return j.idToken;
}

async function waitForPdf(claimId: string, requestIdNot: string | null): Promise<ClaimDoc> {
  for (let i = 0; i < 60; i++) {
    const c = (await db.collection(COL.claims).doc(claimId).get()).data() as ClaimDoc;
    if (c.pdf.requestId !== requestIdNot && c.pdf.status === 'ready') return c;
    if (c.pdf.status === 'failed') throw new Error(`PDF failed: ${c.pdf.error}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error('Timed out waiting for PDF');
}

async function bigPdf(): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  d.addPage().drawText('Smoke test large attachment');
  await d.attach(randomBytes(7 * 1024 * 1024), 'padding.bin', { mimeType: 'application/octet-stream' });
  return d.save();
}

step('health');
const health = (await (await fetch(`${base}/.netlify/functions/health`)).json()) as { assets: { font: boolean; logo: boolean } };
if (!health.assets.font || !health.assets.logo) throw new Error(`Assets missing on server: ${JSON.stringify(health)}`);

step('seed smoke admin');
await auth.getUser(UID).catch(() => auth.createUser({ uid: UID, email: EMAIL, emailVerified: true, displayName: 'Smoke Test' }));
const now = Timestamp.now();
await db.collection(COL.users).doc(UID).set({
  email: EMAIL, name: 'Smoke Test 测试', position: 'QA', role: 'admin', active: true, bank: BANK,
  authProvider: 'password', createdAt: now, updatedAt: now,
});
const token = await idToken();
const call = async <T,>(fn: string, body: unknown): Promise<T> => {
  const r = await fetch(`${base}/.netlify/functions/${fn}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${fn} → ${r.status} ${JSON.stringify(j)}`);
  return j as T;
};

const counterRef = db.collection(COL.counters).doc(CLAIM_SEQ_DOC);
const counterBefore = (await counterRef.get()).data()?.next as number;
const claimId = db.collection(COL.claims).doc().id;
let claim: ClaimDoc | null = null;
let uploadFolderId: string | null = null;

try {
  step('session');
  await call('session', {});

  step('upload attachments (jpg + 7MB pdf) directly to Drive');
  const files = [
    { name: 'receipt.jpg', mimeType: 'image/jpeg', data: new Uint8Array(readFileSync('test/fixtures/receipt.jpg')) },
    { name: 'big.pdf', mimeType: 'application/pdf', data: await bigPdf() },
  ];
  const sess = await call<{ folderId: string; uploads: { uploadUrl: string }[] }>('drive-upload-session', {
    claimId, files: files.map((f) => ({ name: f.name, mimeType: f.mimeType, size: f.data.length })),
  });
  uploadFolderId = sess.folderId;
  const ids: string[] = [];
  for (const [i, f] of files.entries()) {
    const r = await fetch(sess.uploads[i]!.uploadUrl, { method: 'PUT', headers: { 'Content-Type': f.mimeType }, body: toArrayBuffer(f.data) });
    if (!r.ok) throw new Error(`Drive PUT failed ${r.status} ${await r.text()}`);
    ids.push(((await r.json()) as { id: string }).id);
  }

  const submitBody = {
    claimId, items: [{ description: 'Smoke test 停车费', amountCents: 1050 }], payment: BANK,
    attachmentIds: ids, resubmit: false, saveBankToProfile: false,
  };
  step('submit → wait for draft PDF');
  await call('submit-claim', submitBody);
  claim = await waitForPdf(claimId, null);
  if (claim.pdf.fileName !== `${claim.refNo}-Smoke Account-10.50.pdf`) throw new Error(`Bad draft name ${claim.pdf.fileName}`);

  step('file-proxy streams the 7MB attachment');
  const pr = await fetch(`${base}/.netlify/functions/file-proxy?claimId=${claimId}&fileId=${ids[1]}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const got = new Uint8Array(await pr.arrayBuffer());
  if (!pr.ok || got.length !== files[1]!.data.length) throw new Error(`file-proxy returned ${pr.status}, ${got.length} bytes`);

  step('reject → resubmit → wait for new draft');
  await call('review-claim', { claimId, decision: 'reject', reason: 'smoke' });
  const prevReq = claim.pdf.requestId;
  await call('submit-claim', { ...submitBody, resubmit: true });
  claim = await waitForPdf(claimId, prevReq);

  step('approve → wait for final PDF');
  const approved = await call<{ refNo: string }>('review-claim', { claimId, decision: 'approve' });
  claim = await waitForPdf(claimId, claim.pdf.requestId);
  if (claim.pdf.fileName !== `${approved.refNo}-Smoke Account-10.50.pdf`) throw new Error(`Bad final name ${claim.pdf.fileName}`);

  step('mark paid');
  await call('mark-paid', { claimId, paidDate: '2026-09-26', reference: 'SMOKE' });

  console.log(`\n✅ Smoke test passed. Final PDF: https://drive.google.com/file/d/${claim.pdf.driveFileId}/view`);
  console.log('   Open it now if you want to eyeball it — it is trashed during cleanup.');
} finally {
  step('cleanup');
  const c = (await db.collection(COL.claims).doc(claimId).get()).data() as ClaimDoc | undefined;
  if (c?.pdf.driveFileId) await drive.trash(c.pdf.driveFileId).catch(() => undefined);
  const folderId = c?.attachmentsFolderId ?? uploadFolderId;
  if (folderId) await drive.trash(folderId).catch(() => undefined);
  await sheets.deleteClaimRow(claimId).catch(() => undefined);
  await db.collection(COL.claims).doc(claimId).delete();
  const after = (await counterRef.get()).data()?.next as number;
  if (after === counterBefore + 1) await counterRef.update({ next: counterBefore });
  else if (after !== counterBefore) console.warn(`⚠ counter moved from ${counterBefore} to ${after}; not restoring`);
  await db.collection(COL.users).doc(UID).delete();
  await auth.deleteUser(UID).catch(() => undefined);
}
