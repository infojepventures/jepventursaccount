import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { SHEET_HEADERS } from '../lib/claimRow';
import { DriveClient, SPREADSHEET_MIME } from '../lib/drive';
import { env } from '../lib/env';
import { getAdminApp } from '../lib/firebaseAdmin';
import { CLAIM_SEQ_DOC, COL } from '../lib/firestore';
import { createTokenProvider, SCOPES } from '../lib/googleAuth';
import { SheetsClient } from '../lib/sheets';

const INITIAL_ADMINS = ['wailoong8278.jcim@jcikl.cc', 'info.jepventures@gmail.com'];
const ROOT_NAME = 'JEP Claims';
const SHEET_NAME = 'JEP Claims Register';

const getToken = createTokenProvider({
  clientEmail: env('GOOGLE_SA_EMAIL'),
  privateKey: env('GOOGLE_SA_PRIVATE_KEY').replace(/\\n/g, '\n'),
  scopes: [SCOPES.drive, SCOPES.sheets],
});
const drive = new DriveClient(getToken);

const rootId = await drive.findOrCreateFolder(env('GOOGLE_SHARED_DRIVE_ID'), ROOT_NAME);
console.log(`✔ Root folder "${ROOT_NAME}": ${rootId}`);

const sheetId =
  (await drive.findChild(rootId, SHEET_NAME, SPREADSHEET_MIME)) ??
  (await drive.createEmpty(SHEET_NAME, SPREADSHEET_MIME, rootId));
await new SheetsClient(getToken, sheetId).setupSheet(SHEET_HEADERS);
console.log(`✔ Sheet "${SHEET_NAME}": ${sheetId}`);

const db = getFirestore(getAdminApp());
const counter = db.collection(COL.counters).doc(CLAIM_SEQ_DOC);
if (!(await counter.get()).exists) {
  await counter.set({ next: 1 });
  console.log('✔ counters/claimSeq initialised to 1');
} else {
  console.log(`✔ counters/claimSeq already at ${(await counter.get()).data()?.next}`);
}

for (const email of INITIAL_ADMINS) {
  const existing = await db.collection(COL.users).where('email', '==', email).limit(1).get();
  if (existing.empty) {
    await db.collection(COL.invites).doc(email).set({ role: 'admin', invitedByUid: 'setup', invitedAt: Timestamp.now() });
    console.log(`✔ Admin invite: ${email}`);
  } else {
    console.log(`✔ Admin user already exists: ${email}`);
  }
}

console.log(`\nAdd to netlify/.env and Netlify env vars:\nGOOGLE_ROOT_FOLDER_ID=${rootId}\nGOOGLE_SHEET_ID=${sheetId}`);
