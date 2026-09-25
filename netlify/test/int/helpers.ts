import { readFileSync } from 'node:fs';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { PDFDocument } from 'pdf-lib';
import type { BankDetails, UserDoc } from '@jep/shared';
import { loadActor, type Actor } from '../../lib/actor';
import { loadPdfAssets } from '../../lib/assets';
import type { Deps } from '../../lib/deps';
import { getAdminApp } from '../../lib/firebaseAdmin';
import { CLAIM_SEQ_DOC, COL } from '../../lib/firestore';
import { createUploadSessions } from '../../lib/services/uploadSession';
import { submitClaim } from '../../lib/services/submitClaim';
import { FakeDrive, FakeSheets } from '../fakes';

const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-jep';

export async function resetEmulators(): Promise<void> {
  const fs = process.env.FIRESTORE_EMULATOR_HOST;
  const auth = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (!fs || !auth) throw new Error('Run integration tests with `npm run test:int` from the repo root');
  await fetch(`http://${fs}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://${auth}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
}

export const BANK: BankDetails = { bankName: 'Maybank', accountHolder: 'Tan Ah Kow', accountNumber: '1234 5678 9012' };

export function makeTestDeps() {
  const app = getAdminApp();
  const drive = new FakeDrive();
  const sheets = new FakeSheets();
  const triggered: { claimId: string; requestId: string }[] = [];
  let now = new Date('2026-09-25T04:00:00Z');
  let n = 0;
  const deps: Deps = {
    db: getFirestore(app),
    auth: getAuth(app),
    drive,
    sheets,
    rootFolderId: 'root',
    now: () => now,
    newId: () => `req_${++n}`,
    triggerPdf: async (claimId, requestId) => {
      triggered.push({ claimId, requestId });
    },
    loadPdfAssets,
  };
  return {
    deps,
    drive,
    sheets,
    triggered,
    setNow: (d: Date) => {
      now = d;
    },
  };
}
export type TestKit = ReturnType<typeof makeTestDeps>;

export async function seedUser(deps: Deps, uid: string, overrides: Partial<UserDoc> = {}): Promise<void> {
  const now = Timestamp.fromDate(deps.now());
  const doc: UserDoc = {
    email: `${uid}@example.com`,
    name: `User ${uid}`,
    position: 'Executive',
    role: 'member',
    active: true,
    bank: BANK,
    authProvider: 'password',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  await deps.db.collection(COL.users).doc(uid).set(doc);
}

export async function seedActor(deps: Deps, uid: string, overrides: Partial<UserDoc> = {}): Promise<Actor> {
  await seedUser(deps, uid, overrides);
  return loadActor(deps, uid);
}

export async function seedCounter(deps: Deps, next = 1): Promise<void> {
  await deps.db.collection(COL.counters).doc(CLAIM_SEQ_DOC).set({ next });
}

export const newClaimId = (deps: Deps) => deps.db.collection(COL.claims).doc().id;
export const jpgBytes = () => new Uint8Array(readFileSync('test/fixtures/receipt.jpg'));
export const pngBytes = () => new Uint8Array(readFileSync('test/fixtures/receipt.png'));
export async function pdfBytes(pages = 1): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage();
  return d.save();
}

export interface TestFile {
  name: string;
  mimeType: string;
  data: Uint8Array;
}
export const jpgFile = (name = 'receipt.jpg'): TestFile => ({ name, mimeType: 'image/jpeg', data: jpgBytes() });

export async function uploadFiles(t: TestKit, actor: Actor, claimId: string, files: TestFile[]): Promise<string[]> {
  const res = await createUploadSessions(t.deps, actor, {
    claimId,
    files: files.map((f) => ({ name: f.name, mimeType: f.mimeType, size: f.data.length })),
  });
  return res.uploads.map((u, i) => t.drive.completeUpload(u.uploadUrl, files[i]!.data));
}

export async function submitNewClaim(
  t: TestKit,
  actor: Actor,
  opts: { files?: TestFile[]; amounts?: number[] } = {},
): Promise<{ claimId: string; attachmentIds: string[] }> {
  const claimId = newClaimId(t.deps);
  const attachmentIds = await uploadFiles(t, actor, claimId, opts.files ?? [jpgFile()]);
  await submitClaim(t.deps, actor, {
    claimId,
    items: (opts.amounts ?? [1050, 13950]).map((amountCents, i) => ({ description: `Item ${i + 1}`, amountCents })),
    payment: BANK,
    attachmentIds,
    resubmit: false,
    saveBankToProfile: false,
  });
  return { claimId, attachmentIds };
}
