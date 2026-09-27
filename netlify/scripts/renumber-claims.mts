/**
 * One-off: renumber every claim to PR-JEP-{submission yyyyMM}-{NNNN} (0001 in submission order),
 * set counters/claimSeq to continue after the last number, and regenerate each claim's PDF here (which also
 * renames the PDF to {ref}-{holder}-{amount}-{status}.pdf, renames its receipts folder, and updates the Sheet row).
 *
 *   npm run renumber -w @jep/netlify -- --dry-run     # show old -> new, change nothing
 *   npm run renumber -w @jep/netlify                  # do it
 *
 * Run it right after the numbering-on-submit server code is deployed, while nobody is submitting.
 * Needs netlify/.env (service account, Drive, Sheet).
 */
import { Timestamp } from 'firebase-admin/firestore';
import type { ClaimDoc } from '@jep/shared';
import { getDeps } from '../lib/deps';
import { COL } from '../lib/firestore';
import { claimSeqRef } from '../lib/refNumbers';
import { planRenumber } from '../lib/renumber';
import { generatePdf } from '../lib/services/generatePdf';

const dryRun = process.argv.includes('--dry-run');
const deps = getDeps();
const snap = await deps.db.collection(COL.claims).get();
const claims = snap.docs.map((d) => ({ id: d.id, ...(d.data() as ClaimDoc) }));
const plan = planRenumber(claims.map((c) => ({ id: c.id, submittedAt: c.submittedAt.toDate(), refNo: c.refNo })));

for (const c of plan.changes) console.log(`${c.from.padEnd(28)} -> ${c.refNo}   (${c.id})`);
console.log(`counters/claimSeq -> next ${plan.nextCounter}`);
if (dryRun) {
  console.log('Dry run: nothing changed.');
  process.exit(0);
}

const now = Timestamp.fromDate(deps.now());
const batch = deps.db.batch();
for (const c of plan.changes) batch.update(deps.db.collection(COL.claims).doc(c.id), { refNo: c.refNo, updatedAt: now });
batch.set(claimSeqRef(deps.db), { next: plan.nextCounter }, { merge: true });
await batch.commit();
console.log(`✔ Renumbered ${plan.changes.length} claims.`);

let failed = 0;
for (const c of plan.changes) {
  const requestId = deps.newId();
  const ref = deps.db.collection(COL.claims).doc(c.id);
  const cur = (await ref.get()).data() as ClaimDoc;
  await ref.update({ pdf: { ...cur.pdf, status: 'generating', requestId, requestedAt: Timestamp.fromDate(deps.now()), error: null } });
  const result = await generatePdf(deps, c.id, requestId);
  if (result !== 'done') failed++;
  console.log(`${result === 'done' ? '✔' : '✖'} PDF ${c.refNo}: ${result}`);
}
if (failed) {
  console.log(`${failed} PDF(s) failed; open those claims in the app and tap Regenerate PDF.`);
  process.exit(1);
}
console.log('✔ All PDFs regenerated.');
