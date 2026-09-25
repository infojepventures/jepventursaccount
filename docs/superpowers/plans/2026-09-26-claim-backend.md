# JEP Claim System — Backend (Plan 1 of 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared domain package and the Netlify Functions backend for the JEP Ventures claim system: claim lifecycle, numbering, Drive storage, Sheet mirror, and merged PDF generation.

**Architecture:** An npm-workspaces monorepo. `shared/` holds pure TypeScript domain logic used by both the backend and (in Plan 2) the Expo app. `netlify/` holds thin Netlify Function wrappers over testable service functions. The services take a `Deps` object (Firestore, Auth, Drive, Sheets, clock, PDF trigger), so integration tests can run against the Firebase Emulator with in-memory Drive and Sheets fakes. PDFs are built with pdf-lib, using a Noto Sans SC variable font that is pre-subset with HarfBuzz (`subset-font`).

**Tech Stack:** Node 22, TypeScript ~5.9.3, Vitest 5, firebase-admin 14, jose 6, pdf-lib 1.17 + @pdf-lib/fontkit, subset-font 2.9, Netlify Functions (v2 syntax, esbuild bundler), firebase-tools 15 (emulators), @firebase/rules-unit-testing 5, pdfjs-dist 6 (tests only).

**Spec:** `docs/superpowers/specs/2026-09-25-claim-system-design.md`

## Global Constraints

- Repo root: `C:\Users\User\Documents\Cursor projects\JEP Ventures\Account` (its own git repo, remote `https://github.com/infojepventures/jepventursaccount.git`). Branch `main`. Do not push unless the user asks.
- Every commit message ends with a blank line and then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Shell: Git Bash on Windows. Before any `npm run test:int`, run `export PATH="/c/Program Files/Android/Android Studio/jbr/bin:$PATH"` (the Firestore emulator needs Java).
- Firebase project: `jepventuresaccount`. Emulator project: `demo-jep`.
- Shared Drive ID: `0ABnERw4RUzYbUk9PVA`. Root folder name: `JEP Claims`. Sheet name: `JEP Claims Register`, tab `Claims`.
- All dates and months use Malaysia time (UTC+8, no DST).
- Money is always integer cents (`amountCents`, `totalCents`).
- Draft ref: `PR-JEP-{yyyyMM}-draft`, using the submission month. Final ref: `PR-JEP-{yyyyMM}-{NNN}`, using the approval month and a global counter `counters/claimSeq.next` that never resets. NNN is zero-padded to 3 digits.
- PDF file name: `{refNo}-{accountHolder}-{total 2dp}.pdf`, for example `PR-JEP-202609-005-Tan Ah Kow-150.00.pdf`.
- Attachments: 1 to 10 per claim, each ≤ 10MB, of type `image/jpeg`, `image/png`, or `application/pdf`.
- Letterhead text, verbatim: `JEP VENTURES SDN BHD (1521088-K)` and `D-2-15, Pusat Komersial Jalan Kuching, No. 115, Jalan Kepayang, Off Jalan Kuching, 51200 Kuala Lumpur, W.P. Kuala Lumpur`.
- Initial admins: `wailoong8278.jcim@jcikl.cc` and `info.jepventures@gmail.com`.
- Server env vars: `FIREBASE_PROJECT_ID`, `GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY`, `GOOGLE_SHARED_DRIVE_ID`, `GOOGLE_ROOT_FOLDER_ID`, `GOOGLE_SHEET_ID`, `INTERNAL_FUNCTION_SECRET`, and optionally `FUNCTIONS_BASE_URL`. A single service account (the Firebase Admin SDK key) is used for Firestore, Drive, and Sheets, to stay under the 4KB Lambda env limit.
- Never commit secrets: `netlify/.env` and `*.json` service-account keys are gitignored.
- Status mismatches return HTTP 409 `STATUS_CHANGED`. Role or ownership failures return 403 `FORBIDDEN`.

## File Structure

```
package.json, tsconfig.base.json, .gitignore, .nvmrc, netlify.toml, firebase.json, .firebaserc
firebase/firestore.rules, firebase/firestore.indexes.json
shared/            @jep/shared — pure domain logic (no I/O)
  src/dates.ts money.ts refNo.ts fileName.ts validation.ts status.ts profile.ts types.ts api.ts index.ts
  test/*.test.ts
netlify/           @jep/netlify — backend
  assets/fonts/NotoSansSC-VF.ttf, assets/fonts/OFL.txt, assets/logo-black.png
  lib/env.ts bytes.ts firebaseAdmin.ts googleAuth.ts drive.ts sheets.ts claimRow.ts assets.ts
  lib/errors.ts http.ts firestore.ts actor.ts claimAccess.ts deps.ts
  lib/pdf/wrapText.ts lib/pdf/buildClaimPdf.ts
  lib/services/sheetSync.ts pdfTrigger.ts session.ts attachmentsFolder.ts uploadSession.ts
               submitClaim.ts generatePdf.ts reviewClaim.ts claimActions.ts fileAccess.ts adminUsers.ts
  functions/*.mts   thin HTTP wrappers
  scripts/pdf-sample.mts setup.mts smoke.mts
  types/subset-font.d.ts
  test/fakes.ts test/pdfText.ts test/fixtures/receipt.jpg receipt.png
  test/unit/*.test.ts  test/int/*.int.test.ts  test/int/helpers.ts
  vitest.config.ts vitest.int.config.ts public/index.html
```

---

### Task 1: Monorepo scaffold + shared dates and money

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.gitignore`, `.nvmrc`
- Create: `shared/package.json`, `shared/tsconfig.json`, `shared/src/dates.ts`, `shared/src/money.ts`, `shared/src/index.ts`
- Test: `shared/test/dates.test.ts`, `shared/test/money.test.ts`

**Interfaces:**
- Produces: `formatYyyyMm(d: Date): string`, `formatYmd(d: Date): string`, `formatYmdHms(d: Date): string`, `isValidYmd(s: string): boolean`, `parseAmountToCents(input: string): number | null`, `formatCents(cents: number): string`, `formatRM(cents: number): string`, `sumCents(items: { amountCents: number }[]): number`

- [ ] **Step 1: Create the root files**

`package.json`:
```json
{
  "name": "jep-claims",
  "private": true,
  "type": "module",
  "workspaces": ["shared", "netlify"],
  "scripts": {
    "typecheck": "npm run typecheck --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "test:int": "firebase emulators:exec --project demo-jep --only auth,firestore \"npm run test:int -w @jep/netlify\""
  },
  "devDependencies": {
    "firebase-tools": "^15.31.0",
    "typescript": "~5.9.3"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": []
  }
}
```

`.gitignore`:
```
node_modules/
.netlify/
netlify/.env
netlify/tmp/
*.log
.DS_Store
*-firebase-adminsdk-*.json
service-account*.json
firebase-debug.log
firestore-debug.log
ui-debug.log
```

`.nvmrc`:
```
22
```

- [ ] **Step 2: Create the shared package skeleton**

`shared/package.json`:
```json
{
  "name": "@jep/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json"
  },
  "devDependencies": {
    "vitest": "^5.0.2"
  }
}
```

`shared/tsconfig.json`:
```json
{
  "extends": "../tsconfig.base.json",
  "include": ["src", "test"]
}
```

Run: `npm install`
Expected: installs without errors and creates `package-lock.json`.

- [ ] **Step 3: Write the failing tests**

`shared/test/dates.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { formatYmd, formatYmdHms, formatYyyyMm, isValidYmd } from '../src/dates';

describe('dates (Malaysia time, UTC+8)', () => {
  it('uses the MYT month boundary', () => {
    expect(formatYyyyMm(new Date('2026-09-30T15:59:59Z'))).toBe('202609');
    expect(formatYyyyMm(new Date('2026-09-30T16:00:00Z'))).toBe('202610');
  });

  it('formats date and date-time in MYT', () => {
    const d = new Date('2026-09-25T15:05:43Z');
    expect(formatYmd(d)).toBe('2026-09-25');
    expect(formatYmdHms(d)).toBe('2026-09-25 23:05:43');
  });

  it('validates yyyy-MM-dd strings', () => {
    expect(isValidYmd('2026-02-28')).toBe(true);
    expect(isValidYmd('2026-02-30')).toBe(false);
    expect(isValidYmd('26-2-1')).toBe(false);
  });
});
```

`shared/test/money.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { formatCents, formatRM, parseAmountToCents, sumCents } from '../src/money';

describe('money', () => {
  it('parses user input into cents', () => {
    expect(parseAmountToCents('150')).toBe(15000);
    expect(parseAmountToCents('150.5')).toBe(15050);
    expect(parseAmountToCents(' 1,234.56 ')).toBe(123456);
    expect(parseAmountToCents('0.1')).toBe(10);
    expect(parseAmountToCents('1.234')).toBeNull();
    expect(parseAmountToCents('abc')).toBeNull();
    expect(parseAmountToCents('')).toBeNull();
    expect(parseAmountToCents('-5')).toBeNull();
  });

  it('formats cents', () => {
    expect(formatCents(15000)).toBe('150.00');
    expect(formatCents(5)).toBe('0.05');
    expect(formatRM(123456789)).toBe('RM 1,234,567.89');
    expect(formatRM(200)).toBe('RM 2.00');
  });

  it('sums item amounts', () => {
    expect(sumCents([{ amountCents: 1050 }, { amountCents: 4550 }])).toBe(5600);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm test -w @jep/shared`
Expected: FAIL, because `../src/dates` and `../src/money` cannot be resolved.

- [ ] **Step 5: Implement**

`shared/src/dates.ts`:
```ts
// Malaysia is UTC+8 all year (no DST), so a fixed offset is exact.
const MYT_OFFSET_MS = 8 * 60 * 60 * 1000;

function mytParts(d: Date) {
  const m = new Date(d.getTime() + MYT_OFFSET_MS);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return {
    yyyy: String(m.getUTCFullYear()),
    MM: p2(m.getUTCMonth() + 1),
    dd: p2(m.getUTCDate()),
    HH: p2(m.getUTCHours()),
    mm: p2(m.getUTCMinutes()),
    ss: p2(m.getUTCSeconds()),
  };
}

export function formatYyyyMm(d: Date): string {
  const p = mytParts(d);
  return `${p.yyyy}${p.MM}`;
}

export function formatYmd(d: Date): string {
  const p = mytParts(d);
  return `${p.yyyy}-${p.MM}-${p.dd}`;
}

export function formatYmdHms(d: Date): string {
  const p = mytParts(d);
  return `${p.yyyy}-${p.MM}-${p.dd} ${p.HH}:${p.mm}:${p.ss}`;
}

export function isValidYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
```

`shared/src/money.ts`:
```ts
export function parseAmountToCents(input: string): number | null {
  const s = input.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const dot = s.indexOf('.');
  const whole = dot === -1 ? s : s.slice(0, dot);
  const frac = dot === -1 ? '' : s.slice(dot + 1);
  const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function formatRM(cents: number): string {
  const s = formatCents(cents);
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  const dot = body.indexOf('.');
  const grouped = body.slice(0, dot).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `RM ${neg ? '-' : ''}${grouped}${body.slice(dot)}`;
}

export function sumCents(items: { amountCents: number }[]): number {
  return items.reduce((sum, i) => sum + i.amountCents, 0);
}
```

`shared/src/index.ts`:
```ts
export * from './dates';
export * from './money';
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test -w @jep/shared && npm run typecheck -w @jep/shared`
Expected: all tests PASS and tsc exits 0.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json .gitignore .nvmrc shared
git commit -m "feat(shared): scaffold monorepo with MYT dates and cents money helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Shared ref numbers and file names

**Files:**
- Create: `shared/src/refNo.ts`, `shared/src/fileName.ts`
- Modify: `shared/src/index.ts`
- Test: `shared/test/refNo.test.ts`, `shared/test/fileName.test.ts`

**Interfaces:**
- Consumes: `formatYyyyMm`, `formatCents` (Task 1)
- Produces: `REF_PREFIX = 'PR-JEP'`, `draftRefNo(submittedAt: Date): string`, `finalRefNo(approvedAt: Date, seq: number): string`, `isDraftRefNo(refNo: string): boolean`, `refNoYear(refNo: string): string`, `sanitizeFileNamePart(input: string): string`, `claimPdfFileName(refNo: string, accountHolder: string, totalCents: number): string`

- [ ] **Step 1: Write the failing tests**

`shared/test/refNo.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { draftRefNo, finalRefNo, isDraftRefNo, refNoYear } from '../src/refNo';

describe('refNo', () => {
  it('builds the draft ref from the submission month', () => {
    expect(draftRefNo(new Date('2026-09-25T04:00:00Z'))).toBe('PR-JEP-202609-draft');
  });

  it('builds the final ref from the approval month and global sequence', () => {
    expect(finalRefNo(new Date('2026-10-01T01:00:00Z'), 6)).toBe('PR-JEP-202610-006');
    expect(finalRefNo(new Date('2026-10-01T01:00:00Z'), 1234)).toBe('PR-JEP-202610-1234');
    expect(() => finalRefNo(new Date(), 0)).toThrow();
  });

  it('detects drafts and extracts the year', () => {
    expect(isDraftRefNo('PR-JEP-202609-draft')).toBe(true);
    expect(isDraftRefNo('PR-JEP-202609-005')).toBe(false);
    expect(refNoYear('PR-JEP-202610-006')).toBe('2026');
    expect(refNoYear('PR-JEP-202701-draft')).toBe('2027');
    expect(() => refNoYear('nope')).toThrow();
  });
});
```

`shared/test/fileName.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { claimPdfFileName, sanitizeFileNamePart } from '../src/fileName';

describe('fileName', () => {
  it('builds the PDF file name', () => {
    expect(claimPdfFileName('PR-JEP-202609-005', 'Tan Ah Kow', 15000)).toBe(
      'PR-JEP-202609-005-Tan Ah Kow-150.00.pdf',
    );
    expect(claimPdfFileName('PR-JEP-202609-draft', 'Tan Ah Kow', 15000)).toBe(
      'PR-JEP-202609-draft-Tan Ah Kow-150.00.pdf',
    );
  });

  it('removes illegal characters and collapses whitespace', () => {
    expect(sanitizeFileNamePart('A/B: "C"  D')).toBe('AB C D');
    expect(claimPdfFileName('PR-JEP-202609-005', ' / ', 100)).toBe('PR-JEP-202609-005-Unknown-1.00.pdf');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @jep/shared`
Expected: FAIL, because the modules cannot be resolved.

- [ ] **Step 3: Implement**

`shared/src/refNo.ts`:
```ts
import { formatYyyyMm } from './dates';

export const REF_PREFIX = 'PR-JEP';

export function draftRefNo(submittedAt: Date): string {
  return `${REF_PREFIX}-${formatYyyyMm(submittedAt)}-draft`;
}

export function finalRefNo(approvedAt: Date, seq: number): string {
  if (!Number.isSafeInteger(seq) || seq < 1) throw new Error(`Invalid claim sequence ${seq}`);
  return `${REF_PREFIX}-${formatYyyyMm(approvedAt)}-${String(seq).padStart(3, '0')}`;
}

export function isDraftRefNo(refNo: string): boolean {
  return refNo.endsWith('-draft');
}

export function refNoYear(refNo: string): string {
  const m = /^PR-JEP-(\d{4})\d{2}-/.exec(refNo);
  if (!m || !m[1]) throw new Error(`Invalid refNo ${refNo}`);
  return m[1];
}
```

`shared/src/fileName.ts`:
```ts
import { formatCents } from './money';

export function sanitizeFileNamePart(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/[/\\:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim();
}

export function claimPdfFileName(refNo: string, accountHolder: string, totalCents: number): string {
  const holder = sanitizeFileNamePart(accountHolder) || 'Unknown';
  return `${refNo}-${holder}-${formatCents(totalCents)}.pdf`;
}
```

`shared/src/index.ts`:
```ts
export * from './dates';
export * from './money';
export * from './refNo';
export * from './fileName';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @jep/shared && npm run typecheck -w @jep/shared`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared
git commit -m "feat(shared): add ref number and PDF file name helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Shared types, API contract, validation, status rules, profile check

**Files:**
- Create: `shared/src/types.ts`, `shared/src/api.ts`, `shared/src/validation.ts`, `shared/src/status.ts`, `shared/src/profile.ts`
- Modify: `shared/src/index.ts`
- Test: `shared/test/validation.test.ts`, `shared/test/status.test.ts`

**Interfaces:**
- Produces, as types: `TimestampLike`, `Role`, `ClaimStatus`, `PdfStatus`, `BankDetails`, `ClaimItem`, `Attachment`, `PdfInfo`, `HistoryAction`, `HistoryEntry`, `ReviewInfo`, `PaidInfo`, `ClaimDoc`, `UserDoc`, `InviteDoc`, and the API types listed in `api.ts` below.
- Produces, as values: `API` (function names), `MAX_ITEMS`, `MIN_ATTACHMENTS`, `MAX_ATTACHMENTS`, `MAX_ATTACHMENT_BYTES`, `MAX_ITEM_AMOUNT_CENTS`, `ALLOWED_ATTACHMENT_MIME`, `isAllowedMime`, `isValidClaimId`, `validateItems`, `validateBank`, `validateAttachmentMeta`, `CLAIM_RULES`, `canPerform`, `allowedActions`, `isProfileComplete`.

- [ ] **Step 1: Write types and API contract (no tests; they are type-only)**

`shared/src/types.ts`:
```ts
import type { AttachmentMime } from './validation';

/** Structural type satisfied by both firebase-admin and firebase JS SDK Timestamps. */
export interface TimestampLike {
  toDate(): Date;
  toMillis(): number;
}

export type Role = 'member' | 'admin';
export type ClaimStatus = 'submitted' | 'approved' | 'paid' | 'rejected' | 'cancelled';
export type PdfStatus = 'generating' | 'ready' | 'failed';

export interface BankDetails {
  bankName: string;
  accountHolder: string;
  accountNumber: string;
}

export interface ClaimItem {
  description: string;
  amountCents: number;
}

export interface Attachment {
  driveFileId: string;
  name: string;
  mimeType: AttachmentMime;
  size: number;
}

export interface PdfInfo {
  status: PdfStatus;
  /** Identifies the latest generation request; stale background runs compare against it. */
  requestId: string;
  driveFileId: string | null;
  fileName: string | null;
  error: string | null;
}

export type HistoryAction =
  | 'submit'
  | 'resubmit'
  | 'cancel'
  | 'approve'
  | 'reject'
  | 'mark_paid'
  | 'pdf_regenerate';

export interface HistoryEntry {
  action: HistoryAction;
  byUid: string;
  byName: string;
  at: TimestampLike;
  note: string | null;
}

export interface ReviewInfo {
  byUid: string;
  byName: string;
  at: TimestampLike;
  /** Set only when rejected. */
  reason: string | null;
}

export interface PaidInfo {
  byUid: string;
  byName: string;
  at: TimestampLike;
  /** yyyy-MM-dd */
  paidDate: string;
  reference: string;
}

export interface ClaimDoc {
  refNo: string;
  status: ClaimStatus;
  applicant: { uid: string; name: string; position: string };
  items: ClaimItem[];
  totalCents: number;
  payment: BankDetails;
  attachments: Attachment[];
  attachmentsFolderId: string;
  pdf: PdfInfo;
  review: ReviewInfo | null;
  paidInfo: PaidInfo | null;
  history: HistoryEntry[];
  submittedAt: TimestampLike;
  resubmittedAt: TimestampLike | null;
  sheetSynced: boolean;
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
}

export interface UserDoc {
  email: string;
  name: string;
  position: string;
  role: Role;
  active: boolean;
  bank: BankDetails | null;
  authProvider: 'google' | 'password';
  createdAt: TimestampLike;
  updatedAt: TimestampLike;
}

export interface InviteDoc {
  role: Role;
  invitedByUid: string;
  invitedAt: TimestampLike;
}
```

`shared/src/api.ts`:
```ts
import type { BankDetails, ClaimItem, ClaimStatus, Role } from './types';

/** Netlify function names, called as `${base}/.netlify/functions/${name}`. */
export const API = {
  session: 'session',
  uploadSession: 'drive-upload-session',
  submitClaim: 'submit-claim',
  reviewClaim: 'review-claim',
  cancelClaim: 'cancel-claim',
  markPaid: 'mark-paid',
  regeneratePdf: 'regenerate-pdf',
  fileProxy: 'file-proxy',
  adminUsers: 'admin-users',
  resyncSheet: 'resync-sheet',
  health: 'health',
} as const;

export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_INVITED'
  | 'INACTIVE'
  | 'NOT_FOUND'
  | 'INVALID_INPUT'
  | 'STATUS_CHANGED'
  | 'FILE_TOO_LARGE'
  | 'METHOD_NOT_ALLOWED'
  | 'INTERNAL';

export interface ApiErrorBody {
  error: ErrorCode;
  message: string;
}

export interface SessionResponse {
  uid: string;
  role: Role;
  profileComplete: boolean;
}

export interface UploadFileMeta {
  name: string;
  mimeType: string;
  size: number;
}

export interface UploadSessionRequest {
  claimId: string;
  files: UploadFileMeta[];
}

export interface UploadSessionResponse {
  folderId: string;
  /** Same order as the request files. PUT the raw bytes to uploadUrl; the JSON response has `id`. */
  uploads: { name: string; uploadUrl: string }[];
}

export interface SubmitClaimRequest {
  claimId: string;
  items: ClaimItem[];
  payment: BankDetails;
  /** Drive file IDs to keep/attach, in display order. */
  attachmentIds: string[];
  resubmit: boolean;
  saveBankToProfile: boolean;
}

export interface SubmitClaimResponse {
  claimId: string;
}

export interface ReviewClaimRequest {
  claimId: string;
  decision: 'approve' | 'reject';
  reason?: string;
}

export interface ReviewClaimResponse {
  status: ClaimStatus;
  refNo: string;
}

export interface ClaimIdRequest {
  claimId: string;
}

export interface StatusResponse {
  status: ClaimStatus;
}

export interface MarkPaidRequest {
  claimId: string;
  /** yyyy-MM-dd */
  paidDate: string;
  reference: string;
}

export type AdminUsersRequest =
  | { action: 'invite'; email: string; role: Role }
  | { action: 'deleteInvite'; email: string }
  | { action: 'createPasswordUser'; email: string; password: string; name: string; role: Role }
  | { action: 'setRole'; uid: string; role: Role }
  | { action: 'setActive'; uid: string; active: boolean };

export interface AdminUsersResponse {
  ok: true;
  uid?: string;
}

export interface ResyncSheetResponse {
  synced: number;
  failed: number;
}
```

- [ ] **Step 2: Write the failing tests**

`shared/test/validation.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  isValidClaimId,
  validateAttachmentMeta,
  validateBank,
  validateItems,
} from '../src/validation';
import { isProfileComplete } from '../src/profile';

const bank = { bankName: 'Maybank', accountHolder: 'Tan Ah Kow', accountNumber: '1234 5678 9012' };

describe('validateItems', () => {
  it('requires at least one item', () => {
    expect(validateItems([])).toEqual(['At least one item is required']);
    expect(validateItems(undefined)).toEqual(['At least one item is required']);
  });
  it('accepts valid items', () => {
    expect(validateItems([{ description: 'Parking', amountCents: 1000 }])).toEqual([]);
  });
  it('reports each invalid field', () => {
    expect(validateItems([{ description: ' ', amountCents: 0 }])).toEqual([
      'Item 1: description is required',
      'Item 1: amount must be greater than 0',
    ]);
    expect(validateItems([{ description: 'x', amountCents: 10.5 }])).toEqual([
      'Item 1: amount must be greater than 0',
    ]);
  });
});

describe('validateBank', () => {
  it('accepts valid details', () => {
    expect(validateBank(bank)).toEqual([]);
  });
  it('reports missing and malformed fields', () => {
    expect(validateBank({ bankName: '', accountHolder: 'x', accountNumber: '12ab' })).toEqual([
      'Bank name is required',
      'Account number must be 4-30 digits',
    ]);
    expect(validateBank(null)).toEqual(['Bank details are required']);
  });
});

describe('validateAttachmentMeta', () => {
  const ok = { name: 'r.jpg', mimeType: 'image/jpeg', size: 1000 };
  it('enforces count limits', () => {
    expect(validateAttachmentMeta([])).toEqual(['Attach 1 to 10 files']);
    expect(validateAttachmentMeta(Array(11).fill(ok))).toEqual(['Attach 1 to 10 files']);
    expect(validateAttachmentMeta([ok])).toEqual([]);
  });
  it('enforces type and size', () => {
    expect(validateAttachmentMeta([{ name: 'a.gif', mimeType: 'image/gif', size: 10 }])).toEqual([
      'a.gif: only JPG, PNG or PDF files are allowed',
    ]);
    expect(
      validateAttachmentMeta([{ name: 'big.pdf', mimeType: 'application/pdf', size: 11 * 1024 * 1024 }]),
    ).toEqual(['big.pdf: file is larger than 10MB']);
  });
});

describe('isValidClaimId', () => {
  it('accepts 20-char Firestore auto IDs only', () => {
    expect(isValidClaimId('abcdefghij0123456789')).toBe(true);
    expect(isValidClaimId('short')).toBe(false);
    expect(isValidClaimId('abcdefghij012345678/')).toBe(false);
    expect(isValidClaimId(42)).toBe(false);
  });
});

describe('isProfileComplete', () => {
  it('needs name, position and valid bank details', () => {
    expect(isProfileComplete({ name: 'Tan', position: 'Exec', bank })).toBe(true);
    expect(isProfileComplete({ name: 'Tan', position: '', bank })).toBe(false);
    expect(isProfileComplete({ name: 'Tan', position: 'Exec', bank: null })).toBe(false);
  });
});
```

`shared/test/status.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { allowedActions, canPerform } from '../src/status';

const applicant = { isApplicant: true, isAdmin: false };
const admin = { isApplicant: false, isAdmin: true };

describe('canPerform', () => {
  it('lets only the applicant cancel a submitted claim', () => {
    expect(canPerform('cancel', { status: 'submitted', ...applicant })).toBe(true);
    expect(canPerform('cancel', { status: 'approved', ...applicant })).toBe(false);
    expect(canPerform('cancel', { status: 'submitted', ...admin })).toBe(false);
  });
  it('lets only admins approve/reject submitted claims', () => {
    expect(canPerform('approve', { status: 'submitted', ...admin })).toBe(true);
    expect(canPerform('approve', { status: 'submitted', ...applicant })).toBe(false);
    expect(canPerform('reject', { status: 'approved', ...admin })).toBe(false);
  });
  it('lets only the applicant resubmit a rejected claim', () => {
    expect(canPerform('resubmit', { status: 'rejected', ...applicant })).toBe(true);
    expect(canPerform('resubmit', { status: 'rejected', ...admin })).toBe(false);
  });
  it('lets admins mark approved claims paid', () => {
    expect(canPerform('mark_paid', { status: 'approved', ...admin })).toBe(true);
    expect(canPerform('mark_paid', { status: 'submitted', ...admin })).toBe(false);
  });
  it('allows PDF regeneration for applicant or admin except on cancelled claims', () => {
    expect(canPerform('regenerate_pdf', { status: 'paid', ...applicant })).toBe(true);
    expect(canPerform('regenerate_pdf', { status: 'cancelled', ...admin })).toBe(false);
  });
});

describe('allowedActions', () => {
  it('lists actions in rule order', () => {
    expect(allowedActions({ status: 'submitted', isApplicant: true, isAdmin: true })).toEqual([
      'cancel',
      'approve',
      'reject',
      'regenerate_pdf',
    ]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -w @jep/shared`
Expected: FAIL, because the modules cannot be resolved.

- [ ] **Step 4: Implement**

`shared/src/validation.ts`:
```ts
export const MAX_ITEMS = 50;
export const MIN_ATTACHMENTS = 1;
export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ITEM_AMOUNT_CENTS = 100_000_000; // RM 1,000,000 per line
export const ALLOWED_ATTACHMENT_MIME = ['image/jpeg', 'image/png', 'application/pdf'] as const;
export type AttachmentMime = (typeof ALLOWED_ATTACHMENT_MIME)[number];

const isStr = (v: unknown): v is string => typeof v === 'string';

export function isAllowedMime(m: string): m is AttachmentMime {
  return (ALLOWED_ATTACHMENT_MIME as readonly string[]).includes(m);
}

export function isValidClaimId(id: unknown): id is string {
  return isStr(id) && /^[A-Za-z0-9]{20}$/.test(id);
}

export function validateItems(items: unknown): string[] {
  if (!Array.isArray(items) || items.length === 0) return ['At least one item is required'];
  if (items.length > MAX_ITEMS) return [`At most ${MAX_ITEMS} items are allowed`];
  const errors: string[] = [];
  items.forEach((item: unknown, i) => {
    const n = i + 1;
    if (!item || typeof item !== 'object') {
      errors.push(`Item ${n}: invalid`);
      return;
    }
    const { description, amountCents } = item as Record<string, unknown>;
    if (!isStr(description) || description.trim() === '') errors.push(`Item ${n}: description is required`);
    else if (description.length > 300) errors.push(`Item ${n}: description is too long`);
    if (
      typeof amountCents !== 'number' ||
      !Number.isInteger(amountCents) ||
      amountCents <= 0 ||
      amountCents > MAX_ITEM_AMOUNT_CENTS
    ) {
      errors.push(`Item ${n}: amount must be greater than 0`);
    }
  });
  return errors;
}

export function validateBank(bank: unknown): string[] {
  if (!bank || typeof bank !== 'object') return ['Bank details are required'];
  const { bankName, accountHolder, accountNumber } = bank as Record<string, unknown>;
  const errors: string[] = [];
  if (!isStr(bankName) || !bankName.trim()) errors.push('Bank name is required');
  else if (bankName.length > 100) errors.push('Bank name is too long');
  if (!isStr(accountHolder) || !accountHolder.trim()) errors.push('Account holder is required');
  else if (accountHolder.length > 100) errors.push('Account holder is too long');
  if (!isStr(accountNumber) || !accountNumber.trim()) errors.push('Account number is required');
  else if (!/^[0-9][0-9 -]{2,28}[0-9]$/.test(accountNumber.trim())) {
    errors.push('Account number must be 4-30 digits');
  }
  return errors;
}

export function validateAttachmentMeta(files: unknown): string[] {
  if (!Array.isArray(files) || files.length < MIN_ATTACHMENTS || files.length > MAX_ATTACHMENTS) {
    return [`Attach ${MIN_ATTACHMENTS} to ${MAX_ATTACHMENTS} files`];
  }
  const errors: string[] = [];
  files.forEach((f: unknown, i) => {
    const { name, mimeType, size } = (f ?? {}) as Record<string, unknown>;
    const label = isStr(name) && name.trim() ? name : `File ${i + 1}`;
    if (!isStr(name) || !name.trim() || name.length > 200) errors.push(`${label}: invalid file name`);
    if (!isStr(mimeType) || !isAllowedMime(mimeType)) {
      errors.push(`${label}: only JPG, PNG or PDF files are allowed`);
    }
    if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) errors.push(`${label}: invalid size`);
    else if (size > MAX_ATTACHMENT_BYTES) errors.push(`${label}: file is larger than 10MB`);
  });
  return errors;
}
```

`shared/src/status.ts`:
```ts
import type { ClaimStatus } from './types';

export type ClaimAction = 'cancel' | 'approve' | 'reject' | 'resubmit' | 'mark_paid' | 'regenerate_pdf';

export interface ClaimRule {
  from: readonly ClaimStatus[];
  who: 'applicant' | 'admin' | 'applicantOrAdmin';
  to: ClaimStatus | null;
}

export const CLAIM_RULES: Record<ClaimAction, ClaimRule> = {
  cancel: { from: ['submitted'], who: 'applicant', to: 'cancelled' },
  approve: { from: ['submitted'], who: 'admin', to: 'approved' },
  reject: { from: ['submitted'], who: 'admin', to: 'rejected' },
  resubmit: { from: ['rejected'], who: 'applicant', to: 'submitted' },
  mark_paid: { from: ['approved'], who: 'admin', to: 'paid' },
  regenerate_pdf: { from: ['submitted', 'approved', 'paid', 'rejected'], who: 'applicantOrAdmin', to: null },
};

export interface ClaimActionCtx {
  status: ClaimStatus;
  isApplicant: boolean;
  isAdmin: boolean;
}

export function roleAllows(rule: ClaimRule, ctx: Omit<ClaimActionCtx, 'status'>): boolean {
  if (rule.who === 'admin') return ctx.isAdmin;
  if (rule.who === 'applicant') return ctx.isApplicant;
  return ctx.isApplicant || ctx.isAdmin;
}

export function canPerform(action: ClaimAction, ctx: ClaimActionCtx): boolean {
  const rule = CLAIM_RULES[action];
  return roleAllows(rule, ctx) && rule.from.includes(ctx.status);
}

export function allowedActions(ctx: ClaimActionCtx): ClaimAction[] {
  return (Object.keys(CLAIM_RULES) as ClaimAction[]).filter((a) => canPerform(a, ctx));
}
```

`shared/src/profile.ts`:
```ts
import type { BankDetails } from './types';
import { validateBank } from './validation';

export function isProfileComplete(u: { name: string; position: string; bank: BankDetails | null }): boolean {
  return !!u.name.trim() && !!u.position.trim() && !!u.bank && validateBank(u.bank).length === 0;
}
```

`shared/src/index.ts`:
```ts
export * from './dates';
export * from './money';
export * from './refNo';
export * from './fileName';
export * from './validation';
export * from './status';
export * from './profile';
export * from './types';
export * from './api';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -w @jep/shared && npm run typecheck -w @jep/shared`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add shared
git commit -m "feat(shared): add domain types, API contract, validation and status rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 4: Netlify package scaffold + Google service-account token provider

**Files:**
- Create: `netlify/package.json`, `netlify/tsconfig.json`, `netlify/vitest.config.ts`, `netlify/vitest.int.config.ts`, `netlify/types/subset-font.d.ts`
- Create: `netlify/lib/env.ts`, `netlify/lib/bytes.ts`, `netlify/lib/googleAuth.ts`
- Test: `netlify/test/unit/googleAuth.test.ts`

**Interfaces:**
- Produces: `env(name: string): string`, `toArrayBuffer(u8: Uint8Array): ArrayBuffer`, `SCOPES = { drive, sheets }`, `type TokenProvider = () => Promise<string>`, `createTokenProvider(opts: { clientEmail: string; privateKey: string; scopes: string[]; fetchImpl?: typeof fetch }): TokenProvider`

- [ ] **Step 1: Create the package files**

`netlify/package.json`:
```json
{
  "name": "@jep/netlify",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:int": "vitest run --config vitest.int.config.ts",
    "typecheck": "tsc -p tsconfig.json",
    "pdf:sample": "tsx scripts/pdf-sample.mts",
    "setup": "tsx --env-file=.env scripts/setup.mts",
    "smoke": "tsx --env-file=.env scripts/smoke.mts"
  },
  "dependencies": {
    "@jep/shared": "*",
    "@pdf-lib/fontkit": "^1.1.1",
    "firebase-admin": "^14.5.0",
    "jose": "^6.2.12",
    "pdf-lib": "^1.17.1",
    "subset-font": "^2.9.0"
  },
  "devDependencies": {
    "@firebase/rules-unit-testing": "^5.0.2",
    "@netlify/functions": "^6.0.0",
    "@types/node": "^22.0.0",
    "firebase": "^12.19.0",
    "pdfjs-dist": "^6.3.289",
    "tsx": "^4.23.15",
    "vitest": "^5.0.2"
  }
}
```

`netlify/tsconfig.json`:
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["lib", "functions", "scripts", "test", "types", "*.ts"]
}
```

`netlify/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/unit/**/*.test.ts'], testTimeout: 30000 },
});
```

`netlify/vitest.int.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

// Integration tests share one emulator, so files must not run in parallel.
export default defineConfig({
  test: {
    include: ['test/int/**/*.int.test.ts'],
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
```

`netlify/types/subset-font.d.ts` (the package ships no types):
```ts
declare module 'subset-font' {
  interface SubsetFontOptions {
    targetFormat?: 'sfnt' | 'truetype' | 'woff' | 'woff2';
    variationAxes?: Record<string, number | { min: number; max: number; default?: number }>;
  }
  export default function subsetFont(
    font: Buffer | Uint8Array,
    text: string,
    options?: SubsetFontOptions,
  ): Promise<Buffer>;
}
```

The root `package.json` already lists `"netlify"` in `workspaces` (Task 1).

Run: `npm install`
Expected: installs successfully.

- [ ] **Step 2: Write the failing test**

`netlify/test/unit/googleAuth.test.ts`:
```ts
import { decodeJwt, exportPKCS8, generateKeyPair } from 'jose';
import { describe, expect, it, vi } from 'vitest';
import { createTokenProvider, SCOPES } from '../../lib/googleAuth';

describe('createTokenProvider', () => {
  it('exchanges a signed JWT for an access token and caches it', async () => {
    const { privateKey } = await generateKeyPair('RS256', { extractable: true });
    const pem = await exportPKCS8(privateKey);
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      const claims = decodeJwt(body.get('assertion')!);
      expect(claims.iss).toBe('sa@test.iam.gserviceaccount.com');
      expect(claims.scope).toBe(`${SCOPES.drive} ${SCOPES.sheets}`);
      return new Response(JSON.stringify({ access_token: 'tok-1', expires_in: 3600 }), { status: 200 });
    });
    const getToken = createTokenProvider({
      clientEmail: 'sa@test.iam.gserviceaccount.com',
      privateKey: pem,
      scopes: [SCOPES.drive, SCOPES.sheets],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await getToken()).toBe('tok-1');
    expect(await getToken()).toBe('tok-1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('throws a descriptive error when Google rejects the request', async () => {
    const { privateKey } = await generateKeyPair('RS256', { extractable: true });
    const getToken = createTokenProvider({
      clientEmail: 'sa@test',
      privateKey: await exportPKCS8(privateKey),
      scopes: [SCOPES.drive],
      fetchImpl: (async () => new Response('{"error":"invalid_grant"}', { status: 400 })) as unknown as typeof fetch,
    });
    await expect(getToken()).rejects.toThrow(/invalid_grant/);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -w @jep/netlify`
Expected: FAIL, because `../../lib/googleAuth` is not found.

- [ ] **Step 4: Implement**

`netlify/lib/env.ts`:
```ts
export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}
```

`netlify/lib/bytes.ts`:
```ts
/** Copies a Uint8Array view into a standalone ArrayBuffer (a BodyInit that TS accepts). */
export function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}
```

`netlify/lib/googleAuth.ts`:
```ts
import { SignJWT, importPKCS8 } from 'jose';

export const SCOPES = {
  drive: 'https://www.googleapis.com/auth/drive',
  sheets: 'https://www.googleapis.com/auth/spreadsheets',
} as const;

export type TokenProvider = () => Promise<string>;

export function createTokenProvider(opts: {
  clientEmail: string;
  privateKey: string;
  scopes: string[];
  fetchImpl?: typeof fetch;
}): TokenProvider {
  const doFetch = opts.fetchImpl ?? fetch;
  let cached: { token: string; expiresAt: number } | null = null;

  return async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    if (cached && cached.expiresAt - 60 > nowSec) return cached.token;

    const key = await importPKCS8(opts.privateKey, 'RS256');
    const assertion = await new SignJWT({ scope: opts.scopes.join(' ') })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(opts.clientEmail)
      .setAudience('https://oauth2.googleapis.com/token')
      .setIssuedAt(nowSec)
      .setExpirationTime(nowSec + 3600)
      .sign(key);

    const res = await doFetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    });
    const text = await res.text();
    let data: { access_token?: string; expires_in?: number } = {};
    try {
      data = JSON.parse(text);
    } catch {
      // non-JSON error body; reported below
    }
    if (!res.ok || !data.access_token) {
      throw new Error(`Google token request failed: ${res.status} ${text}`);
    }
    cached = { token: data.access_token, expiresAt: nowSec + (data.expires_in ?? 3600) };
    return cached.token;
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -w @jep/netlify && npm run typecheck -w @jep/netlify`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json netlify
git commit -m "feat(netlify): scaffold backend package with service-account token provider

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Drive client

**Files:**
- Create: `netlify/lib/drive.ts`
- Test: `netlify/test/unit/drive.test.ts`

**Interfaces:**
- Consumes: `TokenProvider`, `toArrayBuffer` (Task 4)
- Produces:
```ts
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const SPREADSHEET_MIME = 'application/vnd.google-apps.spreadsheet';
export interface DriveFileMeta { id: string; name: string; mimeType: string; size: number; parents: string[]; trashed: boolean }
export interface DriveApi {
  findChild(parentId: string, name: string, mimeType: string): Promise<string | null>;
  createEmpty(name: string, mimeType: string, parentId: string): Promise<string>;
  findOrCreateFolder(parentId: string, name: string): Promise<string>;
  createResumableUpload(p: { name: string; mimeType: string; size: number; parentId: string }): Promise<string>;
  getFile(fileId: string): Promise<DriveFileMeta | null>;
  download(fileId: string): Promise<Uint8Array>;
  downloadResponse(fileId: string): Promise<Response>;
  upload(p: { name: string; mimeType: string; parentId: string; data: Uint8Array }): Promise<{ id: string }>;
  trash(fileId: string): Promise<void>;
}
export class DriveClient implements DriveApi { constructor(getToken: TokenProvider, fetchImpl?: typeof fetch) }
```

- [ ] **Step 1: Write the failing test**

`netlify/test/unit/drive.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { DriveClient, FOLDER_MIME } from '../../lib/drive';

function fakeFetch(responses: Response[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error(`Unexpected fetch ${String(url)}`);
    return next;
  }) as unknown as typeof fetch;
  return { calls, impl };
}

const token = async () => 'tok';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('DriveClient', () => {
  it('finds a child with an escaped query across shared drives', async () => {
    const f = fakeFetch([json({ files: [{ id: 'F1' }] })]);
    const drive = new DriveClient(token, f.impl);
    expect(await drive.findChild('P1', "Tan's", FOLDER_MIME)).toBe('F1');
    const url = new URL(f.calls[0]!.url);
    expect(url.searchParams.get('q')).toBe(
      `name='Tan\\'s' and 'P1' in parents and mimeType='${FOLDER_MIME}' and trashed=false`,
    );
    expect(url.searchParams.get('supportsAllDrives')).toBe('true');
    expect(url.searchParams.get('includeItemsFromAllDrives')).toBe('true');
    expect(new Headers(f.calls[0]!.init.headers).get('Authorization')).toBe('Bearer tok');
  });

  it('creates the folder when it does not exist', async () => {
    const f = fakeFetch([json({ files: [] }), json({ id: 'NEW' })]);
    const drive = new DriveClient(token, f.impl);
    expect(await drive.findOrCreateFolder('P1', '2026')).toBe('NEW');
    expect(JSON.parse(String(f.calls[1]!.init.body))).toEqual({ name: '2026', mimeType: FOLDER_MIME, parents: ['P1'] });
  });

  it('creates a resumable upload session and returns its Location', async () => {
    const f = fakeFetch([new Response(null, { status: 200, headers: { Location: 'https://upload/session1' } })]);
    const drive = new DriveClient(token, f.impl);
    const url = await drive.createResumableUpload({ name: 'r.jpg', mimeType: 'image/jpeg', size: 123, parentId: 'P1' });
    expect(url).toBe('https://upload/session1');
    const headers = new Headers(f.calls[0]!.init.headers);
    expect(headers.get('X-Upload-Content-Type')).toBe('image/jpeg');
    expect(headers.get('X-Upload-Content-Length')).toBe('123');
    expect(f.calls[0]!.url).toContain('uploadType=resumable');
    expect(f.calls[0]!.url).toContain('supportsAllDrives=true');
  });

  it('returns null for a missing file and parses size as a number', async () => {
    const f = fakeFetch([
      json({ error: 'nf' }, 404),
      json({ id: 'A', name: 'a.pdf', mimeType: 'application/pdf', size: '2048', parents: ['P1'] }),
    ]);
    const drive = new DriveClient(token, f.impl);
    expect(await drive.getFile('missing')).toBeNull();
    expect(await drive.getFile('A')).toEqual({
      id: 'A',
      name: 'a.pdf',
      mimeType: 'application/pdf',
      size: 2048,
      parents: ['P1'],
      trashed: false,
    });
  });

  it('uploads bytes through a resumable session', async () => {
    const f = fakeFetch([
      new Response(null, { status: 200, headers: { Location: 'https://upload/s2' } }),
      json({ id: 'UP1' }),
    ]);
    const drive = new DriveClient(token, f.impl);
    const res = await drive.upload({
      name: 'x.pdf',
      mimeType: 'application/pdf',
      parentId: 'P1',
      data: new Uint8Array([1, 2, 3]),
    });
    expect(res).toEqual({ id: 'UP1' });
    expect(f.calls[1]!.url).toBe('https://upload/s2');
    expect(f.calls[1]!.init.method).toBe('PUT');
  });

  it('trashes files with a PATCH', async () => {
    const f = fakeFetch([json({ id: 'A' })]);
    await new DriveClient(token, f.impl).trash('A');
    expect(f.calls[0]!.init.method).toBe('PATCH');
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({ trashed: true });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @jep/netlify`
Expected: FAIL, because `../../lib/drive` is not found.

- [ ] **Step 3: Implement**

`netlify/lib/drive.ts`:
```ts
import { toArrayBuffer } from './bytes';
import type { TokenProvider } from './googleAuth';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const SPREADSHEET_MIME = 'application/vnd.google-apps.spreadsheet';

export interface DriveFileMeta {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  parents: string[];
  trashed: boolean;
}

export interface DriveApi {
  findChild(parentId: string, name: string, mimeType: string): Promise<string | null>;
  createEmpty(name: string, mimeType: string, parentId: string): Promise<string>;
  findOrCreateFolder(parentId: string, name: string): Promise<string>;
  createResumableUpload(p: { name: string; mimeType: string; size: number; parentId: string }): Promise<string>;
  getFile(fileId: string): Promise<DriveFileMeta | null>;
  download(fileId: string): Promise<Uint8Array>;
  downloadResponse(fileId: string): Promise<Response>;
  upload(p: { name: string; mimeType: string; parentId: string; data: Uint8Array }): Promise<{ id: string }>;
  trash(fileId: string): Promise<void>;
}

const escapeQ = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export class DriveClient implements DriveApi {
  constructor(
    private readonly getToken: TokenProvider,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async req(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${await this.getToken()}`);
    return this.fetchImpl(url, { ...init, headers });
  }

  private async json<T>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await this.req(url, init);
    if (!res.ok) throw new Error(`Drive ${init.method ?? 'GET'} failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  async findChild(parentId: string, name: string, mimeType: string): Promise<string | null> {
    const q = `name='${escapeQ(name)}' and '${escapeQ(parentId)}' in parents and mimeType='${escapeQ(mimeType)}' and trashed=false`;
    const params = new URLSearchParams({
      q,
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      corpora: 'allDrives',
      fields: 'files(id)',
      pageSize: '1',
    });
    const data = await this.json<{ files: { id: string }[] }>(`${API}/files?${params}`);
    return data.files[0]?.id ?? null;
  }

  async createEmpty(name: string, mimeType: string, parentId: string): Promise<string> {
    const data = await this.json<{ id: string }>(`${API}/files?supportsAllDrives=true&fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType, parents: [parentId] }),
    });
    return data.id;
  }

  async findOrCreateFolder(parentId: string, name: string): Promise<string> {
    return (await this.findChild(parentId, name, FOLDER_MIME)) ?? this.createEmpty(name, FOLDER_MIME, parentId);
  }

  async createResumableUpload(p: { name: string; mimeType: string; size: number; parentId: string }): Promise<string> {
    const res = await this.req(
      `${UPLOAD}/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,mimeType,size`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': p.mimeType,
          'X-Upload-Content-Length': String(p.size),
        },
        body: JSON.stringify({ name: p.name, parents: [p.parentId] }),
      },
    );
    const location = res.headers.get('location');
    if (!res.ok || !location) throw new Error(`Drive resumable session failed: ${res.status} ${await res.text()}`);
    return location;
  }

  async getFile(fileId: string): Promise<DriveFileMeta | null> {
    const res = await this.req(
      `${API}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=id,name,mimeType,size,parents,trashed`,
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Drive getFile failed: ${res.status} ${await res.text()}`);
    const d = (await res.json()) as {
      id: string;
      name: string;
      mimeType: string;
      size?: string;
      parents?: string[];
      trashed?: boolean;
    };
    return {
      id: d.id,
      name: d.name,
      mimeType: d.mimeType,
      size: Number(d.size ?? 0),
      parents: d.parents ?? [],
      trashed: d.trashed ?? false,
    };
  }

  async downloadResponse(fileId: string): Promise<Response> {
    const res = await this.req(`${API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`);
    if (!res.ok) throw new Error(`Drive download failed: ${res.status} ${await res.text()}`);
    return res;
  }

  async download(fileId: string): Promise<Uint8Array> {
    return new Uint8Array(await (await this.downloadResponse(fileId)).arrayBuffer());
  }

  async upload(p: { name: string; mimeType: string; parentId: string; data: Uint8Array }): Promise<{ id: string }> {
    // Resumable rather than multipart: merged PDFs can exceed the 5MB multipart limit.
    const url = await this.createResumableUpload({
      name: p.name,
      mimeType: p.mimeType,
      size: p.data.length,
      parentId: p.parentId,
    });
    const res = await this.fetchImpl(url, {
      method: 'PUT',
      headers: { 'Content-Type': p.mimeType },
      body: toArrayBuffer(p.data),
    });
    if (!res.ok) throw new Error(`Drive upload failed: ${res.status} ${await res.text()}`);
    const d = (await res.json()) as { id: string };
    return { id: d.id };
  }

  async trash(fileId: string): Promise<void> {
    await this.json(`${API}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=id`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @jep/netlify && npm run typecheck -w @jep/netlify`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add netlify
git commit -m "feat(netlify): add Shared Drive client with resumable uploads

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Sheets client + claim row mapping

**Files:**
- Create: `netlify/lib/sheets.ts`, `netlify/lib/claimRow.ts`
- Test: `netlify/test/unit/sheets.test.ts`, `netlify/test/unit/claimRow.test.ts`

**Interfaces:**
- Consumes: `TokenProvider` (Task 4); from shared, `ClaimDoc`, `TimestampLike`, `formatYmdHms`, `formatCents`
- Produces:
```ts
export const SHEET_TAB = 'Claims';
export type SheetRow = (string | number)[];
export interface SheetsApi {
  upsertClaimRow(claimId: string, row: SheetRow): Promise<void>;
  deleteClaimRow(claimId: string): Promise<void>;
}
export class SheetsClient implements SheetsApi {
  constructor(getToken: TokenProvider, spreadsheetId: string, fetchImpl?: typeof fetch);
  setupSheet(headers: string[]): Promise<void>;
}
export const SHEET_HEADERS: string[]; // 19 columns
export function toSheetRow(claimId: string, c: ClaimDoc): SheetRow;
```

- [ ] **Step 1: Write the failing tests**

`netlify/test/unit/sheets.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { SheetsClient } from '../../lib/sheets';

function fakeFetch(responses: unknown[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: decodeURIComponent(String(url)), init });
    return new Response(JSON.stringify(responses.shift() ?? {}), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

describe('SheetsClient', () => {
  it('updates the existing row for a claim', async () => {
    const f = fakeFetch([{ values: [['Claim ID'], ['aaa'], ['bbb']] }, {}]);
    await new SheetsClient(async () => 't', 'SHEET', f.impl).upsertClaimRow('bbb', ['bbb', 'x']);
    expect(f.calls[0]!.url).toContain('/SHEET/values/Claims!A:A');
    expect(f.calls[1]!.url).toContain('/values/Claims!A3?valueInputOption=RAW');
    expect(f.calls[1]!.init.method).toBe('PUT');
    expect(JSON.parse(String(f.calls[1]!.init.body))).toEqual({ values: [['bbb', 'x']] });
  });

  it('appends when the claim is not in the sheet', async () => {
    const f = fakeFetch([{ values: [['Claim ID']] }, {}]);
    await new SheetsClient(async () => 't', 'SHEET', f.impl).upsertClaimRow('ccc', ['ccc']);
    expect(f.calls[1]!.url).toContain('/values/Claims!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS');
    expect(f.calls[1]!.init.method).toBe('POST');
  });

  it('deletes a claim row by index', async () => {
    const f = fakeFetch([
      { values: [['Claim ID'], ['aaa']] },
      { sheets: [{ properties: { sheetId: 7, title: 'Claims' } }] },
      {},
    ]);
    await new SheetsClient(async () => 't', 'SHEET', f.impl).deleteClaimRow('aaa');
    expect(JSON.parse(String(f.calls[2]!.init.body))).toEqual({
      requests: [{ deleteDimension: { range: { sheetId: 7, dimension: 'ROWS', startIndex: 1, endIndex: 2 } } }],
    });
  });
});
```

`netlify/test/unit/claimRow.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { ClaimDoc, TimestampLike } from '@jep/shared';
import { SHEET_HEADERS, toSheetRow } from '../../lib/claimRow';

const ts = (iso: string): TimestampLike => ({ toDate: () => new Date(iso), toMillis: () => Date.parse(iso) });

const claim: ClaimDoc = {
  refNo: 'PR-JEP-202609-005',
  status: 'paid',
  applicant: { uid: 'u1', name: 'Tan Ah Kow', position: 'Executive' },
  items: [
    { description: 'Parking', amountCents: 1000 },
    { description: 'Lunch', amountCents: 4550 },
  ],
  totalCents: 5550,
  payment: { bankName: 'Maybank', accountHolder: 'Tan Ah Kow', accountNumber: '0123 4567' },
  attachments: [],
  attachmentsFolderId: 'FOLDER1',
  pdf: { status: 'ready', requestId: 'r', driveFileId: 'PDF1', fileName: 'x.pdf', error: null },
  review: { byUid: 'a1', byName: 'Boss', at: ts('2026-09-26T02:00:00Z'), reason: null },
  paidInfo: { byUid: 'a1', byName: 'Boss', at: ts('2026-09-27T02:00:00Z'), paidDate: '2026-09-27', reference: 'IBG123' },
  history: [],
  submittedAt: ts('2026-09-25T04:00:00Z'),
  resubmittedAt: null,
  sheetSynced: true,
  createdAt: ts('2026-09-25T04:00:00Z'),
  updatedAt: ts('2026-09-27T02:00:00Z'),
};

describe('toSheetRow', () => {
  it('maps every header column', () => {
    const row = toSheetRow('CID', claim);
    expect(row).toHaveLength(SHEET_HEADERS.length);
    expect(row).toEqual([
      'CID',
      'PR-JEP-202609-005',
      'paid',
      '2026-09-25 12:00:00',
      'Tan Ah Kow',
      'Executive',
      '1. Parking RM10.00; 2. Lunch RM45.50',
      55.5,
      'Maybank',
      'Tan Ah Kow',
      '0123 4567',
      'Boss',
      '2026-09-26 10:00:00',
      '',
      '2026-09-27',
      'IBG123',
      'https://drive.google.com/file/d/PDF1/view',
      'https://drive.google.com/drive/folders/FOLDER1',
      '2026-09-27 10:00:00',
    ]);
  });

  it('omits the PDF link until the PDF is ready', () => {
    const row = toSheetRow('CID', { ...claim, pdf: { ...claim.pdf, status: 'generating' } });
    expect(row[16]).toBe('');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @jep/netlify`
Expected: FAIL, because the modules are not found.

- [ ] **Step 3: Implement**

`netlify/lib/sheets.ts`:
```ts
import type { TokenProvider } from './googleAuth';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';
export const SHEET_TAB = 'Claims';
export type SheetRow = (string | number)[];

export interface SheetsApi {
  upsertClaimRow(claimId: string, row: SheetRow): Promise<void>;
  deleteClaimRow(claimId: string): Promise<void>;
}

const range = (a1: string) => encodeURIComponent(`${SHEET_TAB}!${a1}`);

export class SheetsClient implements SheetsApi {
  constructor(
    private readonly getToken: TokenProvider,
    private readonly spreadsheetId: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${await this.getToken()}`);
    if (init.body) headers.set('Content-Type', 'application/json');
    const res = await this.fetchImpl(`${API}/${this.spreadsheetId}${path}`, { ...init, headers });
    if (!res.ok) throw new Error(`Sheets ${init.method ?? 'GET'} ${path} failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  private async findRow(claimId: string): Promise<number | null> {
    const d = await this.call<{ values?: string[][] }>(`/values/${range('A:A')}`);
    const idx = (d.values ?? []).findIndex((r) => r[0] === claimId);
    return idx === -1 ? null : idx + 1;
  }

  private async tabs(): Promise<{ sheetId: number; title: string }[]> {
    const d = await this.call<{ sheets: { properties: { sheetId: number; title: string } }[] }>(
      '?fields=sheets.properties',
    );
    return d.sheets.map((s) => s.properties);
  }

  async upsertClaimRow(claimId: string, row: SheetRow): Promise<void> {
    const n = await this.findRow(claimId);
    const body = JSON.stringify({ values: [row] });
    if (n) {
      await this.call(`/values/${range(`A${n}`)}?valueInputOption=RAW`, { method: 'PUT', body });
    } else {
      await this.call(`/values/${range('A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
        method: 'POST',
        body,
      });
    }
  }

  async deleteClaimRow(claimId: string): Promise<void> {
    const n = await this.findRow(claimId);
    if (!n) return;
    const tab = (await this.tabs()).find((s) => s.title === SHEET_TAB);
    if (!tab) throw new Error(`Sheet tab ${SHEET_TAB} not found`);
    await this.call(':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          { deleteDimension: { range: { sheetId: tab.sheetId, dimension: 'ROWS', startIndex: n - 1, endIndex: n } } },
        ],
      }),
    });
  }

  /** Renames the first tab to "Claims", freezes row 1 and writes the header row. Safe to re-run. */
  async setupSheet(headers: string[]): Promise<void> {
    const first = (await this.tabs())[0];
    if (!first) throw new Error('Spreadsheet has no tabs');
    await this.call(':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          {
            updateSheetProperties: {
              properties: { sheetId: first.sheetId, title: SHEET_TAB, gridProperties: { frozenRowCount: 1 } },
              fields: 'title,gridProperties.frozenRowCount',
            },
          },
        ],
      }),
    });
    await this.call(`/values/${range('A1')}?valueInputOption=RAW`, {
      method: 'PUT',
      body: JSON.stringify({ values: [headers] }),
    });
  }
}
```

`netlify/lib/claimRow.ts`:
```ts
import { formatCents, formatYmdHms, type ClaimDoc, type TimestampLike } from '@jep/shared';
import type { SheetRow } from './sheets';

export const SHEET_HEADERS = [
  'Claim ID',
  'Ref No',
  'Status',
  'Submitted At',
  'Applicant',
  'Position',
  'Items',
  'Total (RM)',
  'Bank',
  'Account Holder',
  'Account Number',
  'Reviewed By',
  'Reviewed At',
  'Reject Reason',
  'Paid Date',
  'Payment Ref',
  'PDF Link',
  'Attachments Folder Link',
  'Updated At',
];

const ts = (t: TimestampLike | null | undefined) => (t ? formatYmdHms(t.toDate()) : '');

export function toSheetRow(claimId: string, c: ClaimDoc): SheetRow {
  return [
    claimId,
    c.refNo,
    c.status,
    ts(c.submittedAt),
    c.applicant.name,
    c.applicant.position,
    c.items.map((it, i) => `${i + 1}. ${it.description} RM${formatCents(it.amountCents)}`).join('; '),
    c.totalCents / 100,
    c.payment.bankName,
    c.payment.accountHolder,
    c.payment.accountNumber,
    c.review?.byName ?? '',
    ts(c.review?.at),
    c.review?.reason ?? '',
    c.paidInfo?.paidDate ?? '',
    c.paidInfo?.reference ?? '',
    c.pdf.status === 'ready' && c.pdf.driveFileId ? `https://drive.google.com/file/d/${c.pdf.driveFileId}/view` : '',
    `https://drive.google.com/drive/folders/${c.attachmentsFolderId}`,
    ts(c.updatedAt),
  ];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @jep/netlify && npm run typecheck -w @jep/netlify`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add netlify
git commit -m "feat(netlify): add Sheets client and claim row mapping

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: PDF builder (letterhead, tables, merged receipts, CJK font)

**Files:**
- Create: `netlify/assets/fonts/NotoSansSC-VF.ttf`, `netlify/assets/fonts/OFL.txt`, `netlify/assets/logo-black.png` (downloaded or copied)
- Create: `netlify/test/fixtures/receipt.jpg`, `netlify/test/fixtures/receipt.png` (generated or copied)
- Create: `netlify/lib/assets.ts`, `netlify/lib/pdf/wrapText.ts`, `netlify/lib/pdf/buildClaimPdf.ts`, `netlify/scripts/pdf-sample.mts`, `netlify/test/pdfText.ts`
- Test: `netlify/test/unit/wrapText.test.ts`, `netlify/test/unit/buildClaimPdf.test.ts`

**Interfaces:**
- Consumes: from shared, `formatCents`, `formatRM`, `formatYmd`, `formatYmdHms`, `isDraftRefNo`, `ClaimDoc`
- Produces:
```ts
// assets.ts
export interface PdfAssets { fontBytes: Uint8Array; logoPng: Uint8Array }
export const FONT_REL = 'netlify/assets/fonts/NotoSansSC-VF.ttf';
export const LOGO_REL = 'netlify/assets/logo-black.png';
export function resolveAsset(rel: string): string | null;
export function loadPdfAssets(): Promise<PdfAssets>;
// pdf/wrapText.ts
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[];
// pdf/buildClaimPdf.ts
export const COMPANY: { name: string; address: string };
export interface ClaimPdfInput {
  refNo: string; isDraft: boolean;
  applicant: { name: string; position: string };
  date: string;                 // yyyy-MM-dd
  items: { description: string; amountCents: number }[];
  totalCents: number;
  payment: { bankName: string; accountHolder: string; accountNumber: string };
  approval: { byName: string; date: string } | null;
  generatedAt: string;          // yyyy-MM-dd HH:mm:ss
}
export interface PdfAttachment { mimeType: string; data: Uint8Array }
export function buildClaimPdf(input: ClaimPdfInput, attachments: PdfAttachment[], assets: PdfAssets): Promise<Uint8Array>;
export function toPdfInput(c: ClaimDoc, now: Date): ClaimPdfInput;
```

Background: pdf-lib's built-in `subset: true` drops CJK glyphs. Verified on 2026-09-25: Noto Sans SC rendered blank. The working approach is to subset first with HarfBuzz (`subset-font`, `targetFormat: 'truetype'`, `variationAxes: { wght: 400 | 700 }`) on the **variable TTF** from google/fonts, then `embedFont(bytes, { subset: false })`. Output is about 7KB per font.

- [ ] **Step 1: Add the binary assets and fixtures**

```bash
mkdir -p netlify/assets/fonts netlify/test/fixtures
curl -L -o netlify/assets/fonts/NotoSansSC-VF.ttf "https://github.com/google/fonts/raw/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf"
curl -L -o netlify/assets/fonts/OFL.txt "https://github.com/google/fonts/raw/main/ofl/notosanssc/OFL.txt"
cp assets/brand/logo-black.png netlify/assets/logo-black.png
cp assets/brand/logo-black.png netlify/test/fixtures/receipt.png
python -c "import pymupdf; p=pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0,0,300,400), 0); p.clear_with(230); p.save('netlify/test/fixtures/receipt.jpg')"
ls -la netlify/assets/fonts netlify/test/fixtures
```
Expected: `NotoSansSC-VF.ttf` is about 17.7MB, and `receipt.jpg` is about 2KB. If `pymupdf` is missing, run `pip install pymupdf` first.

- [ ] **Step 2: Write the failing tests**

`netlify/test/pdfText.ts`:
```ts
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** Extracts the text of one page (1-based) as a single space-joined string. */
export async function extractText(bytes: Uint8Array, pageNumber: number): Promise<string> {
  const pdf = await getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false }).promise;
  const page = await pdf.getPage(pageNumber);
  const content = await page.getTextContent();
  return content.items.map((i) => ('str' in i ? i.str : '')).join(' ');
}
```

`netlify/test/unit/wrapText.test.ts`:
```ts
import { PDFDocument, StandardFonts, type PDFFont } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { wrapText } from '../../lib/pdf/wrapText';

describe('wrapText', () => {
  let font: PDFFont;
  beforeAll(async () => {
    font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
  });
  const w = (s: string) => font.widthOfTextAtSize(s, 10);

  it('wraps on spaces', () => {
    expect(wrapText('aaa bbb ccc', font, 10, w('aaa bbb'))).toEqual(['aaa bbb', 'ccc']);
  });
  it('hard-breaks tokens longer than the line', () => {
    const lines = wrapText('abcdefghij', font, 10, w('abcd'));
    expect(lines.join('')).toBe('abcdefghij');
    expect(lines.every((l) => w(l) <= w('abcd'))).toBe(true);
  });
  it('keeps explicit newlines as separate lines', () => {
    expect(wrapText('one\ntwo', font, 10, 500)).toEqual(['one', 'two']);
  });
  it('returns one empty line for empty text', () => {
    expect(wrapText('', font, 10, 100)).toEqual(['']);
  });
});
```

`netlify/test/unit/buildClaimPdf.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { loadPdfAssets } from '../../lib/assets';
import { buildClaimPdf, type ClaimPdfInput } from '../../lib/pdf/buildClaimPdf';
import { extractText } from '../pdfText';

const input: ClaimPdfInput = {
  refNo: 'PR-JEP-202609-draft',
  isDraft: true,
  applicant: { name: '陈大文 Tan Ah Kow', position: 'Operations Executive' },
  date: '2026-09-25',
  items: [
    { description: '停车费 Parking at KLCC', amountCents: 1050 },
    { description: 'Lunch with client', amountCents: 13950 },
  ],
  totalCents: 15000,
  payment: { bankName: 'Maybank', accountHolder: 'Tan Ah Kow', accountNumber: '1234 5678 9012' },
  approval: null,
  generatedAt: '2026-09-25 12:00:00',
};

async function twoPagePdf() {
  const d = await PDFDocument.create();
  d.addPage();
  d.addPage();
  return d.save();
}

describe('buildClaimPdf', () => {
  it('puts the form first, then one page per image and every PDF page', async () => {
    const bytes = await buildClaimPdf(
      input,
      [
        { mimeType: 'image/jpeg', data: readFileSync('test/fixtures/receipt.jpg') },
        { mimeType: 'image/png', data: readFileSync('test/fixtures/receipt.png') },
        { mimeType: 'application/pdf', data: await twoPagePdf() },
      ],
      await loadPdfAssets(),
    );
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(5);
    expect(bytes.length).toBeLessThan(500_000);
    const text = await extractText(bytes, 1);
    expect(text).toContain('PAYMENT REQUEST');
    expect(text).toContain('REF: PR-JEP-202609-draft');
    expect(text).toContain('DRAFT');
    expect(text).toContain('陈大文');
    expect(text).toContain('停车费');
    expect(text).toContain('RM 150.00');
    expect(text).toContain('JEP VENTURES SDN BHD (1521088-K)');
  });

  it('shows the approval block and no draft marker on the final version', async () => {
    const bytes = await buildClaimPdf(
      { ...input, refNo: 'PR-JEP-202610-006', isDraft: false, approval: { byName: 'Boss', date: '2026-10-01' } },
      [],
      await loadPdfAssets(),
    );
    const text = await extractText(bytes, 1);
    expect(text).toContain('REF: PR-JEP-202610-006');
    expect(text).not.toContain('DRAFT');
    expect(text).toContain('Approved by');
    expect(text).toContain('Boss');
  });

  it('continues long item lists on extra form pages', async () => {
    const items = Array.from({ length: 50 }, (_, i) => ({
      description: `Item ${i + 1} ` + 'long description '.repeat(6),
      amountCents: 100,
    }));
    const bytes = await buildClaimPdf({ ...input, items, totalCents: 5000 }, [], await loadPdfAssets());
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -w @jep/netlify`
Expected: FAIL, because `../../lib/pdf/wrapText` and `../../lib/assets` are not found.

- [ ] **Step 4: Implement the assets loader and wrapText**

`netlify/lib/assets.ts`:
```ts
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface PdfAssets {
  fontBytes: Uint8Array;
  logoPng: Uint8Array;
}

// Paths are relative to the repo root; netlify.toml ships them via `included_files`.
export const FONT_REL = 'netlify/assets/fonts/NotoSansSC-VF.ttf';
export const LOGO_REL = 'netlify/assets/logo-black.png';

export function resolveAsset(rel: string): string | null {
  const roots = [process.env.LAMBDA_TASK_ROOT, process.cwd(), path.resolve(process.cwd(), '..')].filter(
    (r): r is string => !!r,
  );
  for (const root of roots) {
    const p = path.join(root, rel);
    if (existsSync(p)) return p;
  }
  return null;
}

let cache: Promise<PdfAssets> | null = null;

export function loadPdfAssets(): Promise<PdfAssets> {
  cache ??= (async () => {
    const font = resolveAsset(FONT_REL);
    const logo = resolveAsset(LOGO_REL);
    if (!font || !logo) {
      throw new Error(`PDF assets missing (font: ${font}, logo: ${logo}, cwd: ${process.cwd()})`);
    }
    return { fontBytes: new Uint8Array(await readFile(font)), logoPng: new Uint8Array(await readFile(logo)) };
  })();
  return cache;
}
```

`netlify/lib/pdf/wrapText.ts`:
```ts
import type { PDFFont } from 'pdf-lib';

// CJK characters break anywhere; other text breaks at whitespace.
const CJK = '⺀-鿿가-힯豈-﫿＀-￯';
const TOKEN_RE = new RegExp(`[${CJK}]|[^\\s${CJK}]+|\\s+`, 'g');

function splitLongToken(tok: string, fits: (s: string) => boolean): string[] {
  if (fits(tok)) return [tok];
  const out: string[] = [];
  let chunk = '';
  for (const ch of tok) {
    if (chunk && !fits(chunk + ch)) {
      out.push(chunk);
      chunk = ch;
    } else {
      chunk += ch;
    }
  }
  if (chunk) out.push(chunk);
  return out;
}

export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const fits = (s: string) => font.widthOfTextAtSize(s, size) <= maxWidth;
  const lines: string[] = [];
  for (const para of text.replace(/\t/g, ' ').split(/\r?\n/)) {
    const tokens = (para.match(TOKEN_RE) ?? []).flatMap((t) => splitLongToken(t, fits));
    let line = '';
    for (const tok of tokens) {
      const isSpace = /^\s+$/.test(tok);
      if (line === '' && isSpace) continue;
      if (fits(line + tok)) {
        line += tok;
      } else {
        lines.push(line.trimEnd());
        line = isSpace ? '' : tok;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
```

- [ ] **Step 5: Implement the PDF builder**

`netlify/lib/pdf/buildClaimPdf.ts`:
```ts
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import subsetFont from 'subset-font';
import { formatRM, formatYmd, formatYmdHms, isDraftRefNo, type ClaimDoc } from '@jep/shared';
import type { PdfAssets } from '../assets';
import { wrapText } from './wrapText';

export const COMPANY = {
  name: 'JEP VENTURES SDN BHD (1521088-K)',
  address:
    'D-2-15, Pusat Komersial Jalan Kuching, No. 115, Jalan Kepayang, Off Jalan Kuching, 51200 Kuala Lumpur, W.P. Kuala Lumpur',
};

export interface ClaimPdfInput {
  refNo: string;
  isDraft: boolean;
  applicant: { name: string; position: string };
  date: string;
  items: { description: string; amountCents: number }[];
  totalCents: number;
  payment: { bankName: string; accountHolder: string; accountNumber: string };
  approval: { byName: string; date: string } | null;
  generatedAt: string;
}

export interface PdfAttachment {
  mimeType: string;
  data: Uint8Array;
}

const A4: [number, number] = [595.28, 841.89];
const M = 40;
const FOOTER_SPACE = 36;
const DARK = rgb(0.1, 0.1, 0.1);
const GRAY = rgb(0.4, 0.4, 0.4);
const LINE = rgb(0.8, 0.8, 0.8);
const BAND = rgb(0.93, 0.93, 0.93);
const RED = rgb(0.75, 0.1, 0.1);
const DRAFT_MARK = 'DRAFT – PENDING APPROVAL';
const STATIC_TEXT = [
  'PAYMENT REQUEST', 'REF: ', DRAFT_MARK, 'APPLICANT DETAILS', 'Name', 'Position', 'Date',
  'CLAIM BREAKDOWN', 'No.', 'Description / Purpose', 'Amount (RM)', 'TOTAL', 'PAYMENT METHOD',
  'Recipient Bank', 'Account Holder', 'Account Number', 'APPROVAL', 'Approved by', 'Approved on',
  'Generated by JEP Ventures Claim System on ', 'This is a computer-generated document and no signature is required.',
  '0123456789 RM,.-:',
].join('');

async function embedFonts(doc: PDFDocument, fontBytes: Uint8Array, text: string) {
  doc.registerFontkit(fontkit);
  const src = Buffer.from(fontBytes);
  const [regular, bold] = await Promise.all(
    [400, 700].map((wght) => subsetFont(src, text, { targetFormat: 'truetype', variationAxes: { wght } })),
  );
  return {
    regular: await doc.embedFont(regular!, { subset: false }),
    bold: await doc.embedFont(bold!, { subset: false }),
  };
}

export async function buildClaimPdf(
  input: ClaimPdfInput,
  attachments: PdfAttachment[],
  assets: PdfAssets,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Payment Request ${input.refNo}`);
  doc.setCreator('JEP Ventures Claim System');
  doc.setProducer('JEP Ventures Claim System');

  const { regular, bold } = await embedFonts(
    doc,
    assets.fontBytes,
    [COMPANY.name, COMPANY.address, STATIC_TEXT, JSON.stringify(input)].join(''),
  );
  const logo = await doc.embedPng(assets.logoPng);
  const [W, H] = A4;
  const contentW = W - 2 * M;
  const formPages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  const newPage = () => {
    page = doc.addPage(A4);
    formPages.push(page);
    y = H - M;
  };
  const ensure = (h: number) => {
    if (y - h < M + FOOTER_SPACE) newPage();
  };
  const text = (s: string, x: number, size: number, font: PDFFont = regular, color: RGB = DARK, at = y) =>
    page.drawText(s, { x, y: at, size, font, color });
  const rightText = (s: string, right: number, size: number, font: PDFFont = regular) =>
    text(s, right - font.widthOfTextAtSize(s, size), size, font);
  const centered = (s: string, size: number, font: PDFFont, color: RGB = DARK) =>
    text(s, (W - font.widthOfTextAtSize(s, size)) / 2, size, font, color);

  newPage();

  // Letterhead
  const logoH = 48;
  const logoW = logo.width * (logoH / logo.height);
  page.drawImage(logo, { x: M, y: y - logoH, width: logoW, height: logoH });
  const headX = M + logoW + 14;
  let headY = y - 14;
  text(COMPANY.name, headX, 12, bold, DARK, headY);
  for (const line of wrapText(COMPANY.address, regular, 8.5, W - M - headX)) {
    headY -= 12;
    text(line, headX, 8.5, regular, GRAY, headY);
  }
  y = Math.min(y - logoH, headY) - 12;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: DARK });
  y -= 30;

  // Title
  centered('PAYMENT REQUEST', 18, bold);
  y -= 18;
  centered(`REF: ${input.refNo}`, 10, regular, GRAY);
  y -= 14;
  if (input.isDraft) {
    centered(DRAFT_MARK, 10, bold, RED);
    y -= 14;
  }
  y -= 10;

  const section = (title: string) => {
    ensure(40);
    page.drawRectangle({ x: M, y: y - 5, width: contentW, height: 18, color: BAND });
    text(title, M + 6, 10, bold);
    y -= 24;
  };
  const field = (label: string, value: string) => {
    const lines = wrapText(value || '-', regular, 10, contentW - 130);
    ensure(lines.length * 14);
    text(label, M + 6, 10, regular, GRAY);
    lines.forEach((l, i) => text(l, M + 130, 10, regular, DARK, y - i * 14));
    y -= lines.length * 14 + 2;
  };

  section('APPLICANT DETAILS');
  field('Name', input.applicant.name);
  field('Position', input.applicant.position);
  field('Date', input.date);
  y -= 8;

  // Claim breakdown table
  section('CLAIM BREAKDOWN');
  const colNo = M + 6;
  const colDesc = M + 40;
  const colAmtRight = W - M - 6;
  const descW = colAmtRight - 100 - colDesc;
  const tableHeader = () => {
    text('No.', colNo, 9.5, bold);
    text('Description / Purpose', colDesc, 9.5, bold);
    rightText('Amount (RM)', colAmtRight, 9.5, bold);
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.75, color: LINE });
    y -= 14;
  };
  tableHeader();
  input.items.forEach((item, i) => {
    const lines = wrapText(item.description, regular, 10, descW);
    if (y - (lines.length * 13 + 6) < M + FOOTER_SPACE) {
      newPage();
      tableHeader();
    }
    text(String(i + 1), colNo, 10);
    lines.forEach((l, j) => text(l, colDesc, 10, regular, DARK, y - j * 13));
    rightText(formatRM(item.amountCents).slice(3), colAmtRight, 10);
    const bottom = y - (lines.length - 1) * 13;
    page.drawLine({ start: { x: M, y: bottom - 6 }, end: { x: W - M, y: bottom - 6 }, thickness: 0.5, color: LINE });
    y = bottom - 20;
  });
  ensure(24);
  text('TOTAL', colDesc, 11, bold);
  rightText(formatRM(input.totalCents), colAmtRight, 11, bold);
  y -= 26;

  section('PAYMENT METHOD');
  field('Recipient Bank', input.payment.bankName);
  field('Account Holder', input.payment.accountHolder);
  field('Account Number', input.payment.accountNumber);

  if (input.approval) {
    y -= 8;
    section('APPROVAL');
    field('Approved by', input.approval.byName);
    field('Approved on', input.approval.date);
  }

  // Footer on every form page
  const footers: [string, number][] = [
    [`Generated by JEP Ventures Claim System on ${input.generatedAt}`, M + 10],
    ['This is a computer-generated document and no signature is required.', M],
  ];
  for (const p of formPages) {
    for (const [s, fy] of footers) {
      p.drawText(s, { x: (W - regular.widthOfTextAtSize(s, 7.5)) / 2, y: fy, size: 7.5, font: regular, color: GRAY });
    }
  }

  // Merged receipts
  for (const att of attachments) {
    if (att.mimeType === 'application/pdf') {
      const src = await PDFDocument.load(att.data, { ignoreEncryption: true });
      for (const p of await doc.copyPages(src, src.getPageIndices())) doc.addPage(p);
    } else {
      const img = att.mimeType === 'image/png' ? await doc.embedPng(att.data) : await doc.embedJpg(att.data);
      const p = doc.addPage(A4);
      const scale = Math.min((W - 2 * M) / img.width, (H - 2 * M) / img.height, 1);
      const w = img.width * scale;
      const h = img.height * scale;
      p.drawImage(img, { x: (W - w) / 2, y: (H - h) / 2, width: w, height: h });
    }
  }

  return doc.save();
}

export function toPdfInput(c: ClaimDoc, now: Date): ClaimPdfInput {
  const isDraft = isDraftRefNo(c.refNo);
  return {
    refNo: c.refNo,
    isDraft,
    applicant: { name: c.applicant.name, position: c.applicant.position },
    date: formatYmd(c.submittedAt.toDate()),
    items: c.items,
    totalCents: c.totalCents,
    payment: c.payment,
    approval: !isDraft && c.review ? { byName: c.review.byName, date: formatYmd(c.review.at.toDate()) } : null,
    generatedAt: formatYmdHms(now),
  };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -w @jep/netlify && npm run typecheck -w @jep/netlify`
Expected: PASS. If `pdfjs-dist` complains about a worker in Node, add `import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'; GlobalWorkerOptions.workerSrc = new URL('../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href;` at the top of `test/pdfText.ts` and re-run.

- [ ] **Step 7: Add the sample script and visually verify**

`netlify/scripts/pdf-sample.mts`:
```ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadPdfAssets } from '../lib/assets';
import { buildClaimPdf } from '../lib/pdf/buildClaimPdf';

const bytes = await buildClaimPdf(
  {
    refNo: 'PR-JEP-202609-draft',
    isDraft: true,
    applicant: { name: '陈大文 Tan Ah Kow', position: 'Operations Executive' },
    date: '2026-09-25',
    items: [
      { description: '停车费 Parking at KLCC', amountCents: 1050 },
      { description: 'Client lunch at Pavilion with a deliberately long description that wraps onto a second line', amountCents: 13950 },
    ],
    totalCents: 15000,
    payment: { bankName: 'Maybank', accountHolder: 'Tan Ah Kow', accountNumber: '1234 5678 9012' },
    approval: null,
    generatedAt: '2026-09-25 12:00:00',
  },
  [{ mimeType: 'image/jpeg', data: readFileSync('test/fixtures/receipt.jpg') }],
  await loadPdfAssets(),
);
mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/sample.pdf', bytes);
console.log(`Wrote netlify/tmp/sample.pdf (${bytes.length} bytes)`);
```

Run:
```bash
npm run pdf:sample -w @jep/netlify
PYTHONIOENCODING=utf-8 python -c "import pymupdf; d=pymupdf.open('netlify/tmp/sample.pdf'); d[0].get_pixmap(dpi=100).save('netlify/tmp/sample-p1.png')"
```
Expected: `netlify/tmp/sample-p1.png` exists. Open it with the Read tool and confirm four things:
- the logo and company name are at the top
- Chinese characters are visible, not blank boxes
- the table and total are aligned
- the red DRAFT marker is shown

- [ ] **Step 8: Commit**

```bash
git add netlify
git commit -m "feat(netlify): build merged claim PDF with CJK-safe subset fonts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Firebase config, Firestore rules and rules tests

**Files:**
- Create: `firebase.json`, `.firebaserc`, `firebase/firestore.rules`, `firebase/firestore.indexes.json`
- Test: `netlify/test/int/rules.int.test.ts`

**Interfaces:**
- Produces: Firestore rules enforcing the following:
  - `users/{uid}`: the owner can read and can update only `name`, `position`, `bank`, and `updatedAt`; admins can read everything.
  - `claims`: the applicant or an admin can read; nobody can write from a client.
  - `invites`: admins can read; nobody can write from a client.
  - `counters`: no client access.
- Produces: composite indexes on `claims`: (`applicant.uid`, `submittedAt` desc), (`applicant.uid`, `status`, `submittedAt` desc), and (`status`, `submittedAt` desc).

- [ ] **Step 1: Create the config files**

`firebase.json`:
```json
{
  "firestore": {
    "rules": "firebase/firestore.rules",
    "indexes": "firebase/firestore.indexes.json"
  },
  "emulators": {
    "auth": { "port": 9099 },
    "firestore": { "port": 8080 },
    "ui": { "enabled": false },
    "singleProjectMode": true
  }
}
```

`.firebaserc`:
```json
{ "projects": { "default": "jepventuresaccount" } }
```

`firebase/firestore.indexes.json`:
```json
{
  "indexes": [
    {
      "collectionGroup": "claims",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "applicant.uid", "order": "ASCENDING" },
        { "fieldPath": "submittedAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "claims",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "applicant.uid", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "submittedAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "claims",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "submittedAt", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

- [ ] **Step 2: Write the failing rules test**

`netlify/test/int/rules.int.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

let env: RulesTestEnvironment;
const user = (role: 'member' | 'admin') => ({
  email: `${role}@example.com`,
  name: 'Name',
  position: 'Pos',
  role,
  active: true,
  bank: null,
  authProvider: 'password',
});

beforeAll(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
  env = await initializeTestEnvironment({
    projectId: process.env.GCLOUD_PROJECT ?? 'demo-jep',
    firestore: {
      rules: readFileSync(path.resolve('..', 'firebase', 'firestore.rules'), 'utf8'),
      host: host!,
      port: Number(port),
    },
  });
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users/alice'), user('member'));
    await setDoc(doc(db, 'users/bob'), user('member'));
    await setDoc(doc(db, 'users/boss'), user('admin'));
    await setDoc(doc(db, 'claims/c1'), { applicant: { uid: 'alice', name: 'A', position: 'P' }, status: 'submitted' });
    await setDoc(doc(db, 'invites/x@example.com'), { role: 'member' });
    await setDoc(doc(db, 'counters/claimSeq'), { next: 1 });
  });
});

const as = (uid: string) => env.authenticatedContext(uid).firestore();

describe('users', () => {
  it('owner and admins can read; others cannot', async () => {
    await assertSucceeds(getDoc(doc(as('alice'), 'users/alice')));
    await assertSucceeds(getDoc(doc(as('boss'), 'users/alice')));
    await assertFails(getDoc(doc(as('bob'), 'users/alice')));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'users/alice')));
  });
  it('owner may edit profile fields but not role or active', async () => {
    const db = as('alice');
    await assertSucceeds(
      updateDoc(doc(db, 'users/alice'), {
        name: 'Alice Tan',
        position: 'Exec',
        bank: { bankName: 'Maybank', accountHolder: 'Alice', accountNumber: '1234' },
      }),
    );
    await assertFails(updateDoc(doc(db, 'users/alice'), { role: 'admin' }));
    await assertFails(updateDoc(doc(db, 'users/alice'), { active: false }));
    await assertFails(updateDoc(doc(db, 'users/alice'), { bank: { bankName: 'x', evil: true } }));
    await assertFails(updateDoc(doc(as('bob'), 'users/alice'), { name: 'Hacked' }));
  });
});

describe('claims', () => {
  it('applicant and admins can read; other members cannot', async () => {
    await assertSucceeds(getDoc(doc(as('alice'), 'claims/c1')));
    await assertSucceeds(getDoc(doc(as('boss'), 'claims/c1')));
    await assertFails(getDoc(doc(as('bob'), 'claims/c1')));
  });
  it('members can list only with their own uid filter', async () => {
    await assertSucceeds(getDocs(query(collection(as('alice'), 'claims'), where('applicant.uid', '==', 'alice'))));
    await assertFails(getDocs(collection(as('alice'), 'claims')));
    await assertSucceeds(getDocs(collection(as('boss'), 'claims')));
  });
  it('nobody can write claims from the client', async () => {
    await assertFails(setDoc(doc(as('alice'), 'claims/new1'), { applicant: { uid: 'alice' } }));
    await assertFails(updateDoc(doc(as('boss'), 'claims/c1'), { status: 'approved' }));
  });
});

describe('invites and counters', () => {
  it('only admins read invites; nobody touches counters', async () => {
    await assertSucceeds(getDoc(doc(as('boss'), 'invites/x@example.com')));
    await assertFails(getDoc(doc(as('alice'), 'invites/x@example.com')));
    await assertFails(getDoc(doc(as('boss'), 'counters/claimSeq')));
    await assertFails(setDoc(doc(as('boss'), 'counters/claimSeq'), { next: 99 }));
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
export PATH="/c/Program Files/Android/Android Studio/jbr/bin:$PATH"
npm run test:int
```
Expected: FAIL, because `firebase/firestore.rules` does not exist (ENOENT) or the emulator cannot load the rules.

- [ ] **Step 4: Write the rules**

`firebase/firestore.rules`:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() {
      return request.auth != null;
    }
    function userDoc(uid) {
      return get(/databases/$(database)/documents/users/$(uid));
    }
    function isAdmin() {
      return signedIn()
        && exists(/databases/$(database)/documents/users/$(request.auth.uid))
        && userDoc(request.auth.uid).data.role == 'admin'
        && userDoc(request.auth.uid).data.active == true;
    }
    function shortString(v, max) {
      return v is string && v.size() <= max;
    }
    function validBank(b) {
      return b == null || (
        b is map
        && b.keys().hasOnly(['bankName', 'accountHolder', 'accountNumber'])
        && shortString(b.bankName, 100)
        && shortString(b.accountHolder, 100)
        && shortString(b.accountNumber, 30)
      );
    }

    match /users/{uid} {
      allow read: if signedIn() && (request.auth.uid == uid || isAdmin());
      allow update: if signedIn()
        && request.auth.uid == uid
        && resource.data.active == true
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['name', 'position', 'bank', 'updatedAt'])
        && shortString(request.resource.data.name, 100)
        && shortString(request.resource.data.position, 100)
        && validBank(request.resource.data.bank);
      allow create, delete: if false;
    }

    match /claims/{claimId} {
      allow read: if signedIn() && (resource.data.applicant.uid == request.auth.uid || isAdmin());
      allow write: if false;
    }

    match /invites/{email} {
      allow read: if isAdmin();
      allow write: if false;
    }

    match /counters/{id} {
      allow read, write: if false;
    }
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:int` (with the Java PATH exported)
Expected: all rules tests PASS.

- [ ] **Step 6: Commit**

```bash
git add firebase.json .firebaserc firebase netlify/test/int/rules.int.test.ts
git commit -m "feat(firebase): add Firestore rules, indexes and rules tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Backend core (errors, HTTP wrapper, actor, deps, fakes) + session service

**Files:**
- Create: `netlify/lib/errors.ts`, `netlify/lib/http.ts`, `netlify/lib/firestore.ts`, `netlify/lib/firebaseAdmin.ts`, `netlify/lib/actor.ts`, `netlify/lib/claimAccess.ts`, `netlify/lib/deps.ts`
- Create: `netlify/lib/services/sheetSync.ts`, `netlify/lib/services/session.ts`
- Create: `netlify/test/fakes.ts`, `netlify/test/int/helpers.ts`
- Test: `netlify/test/unit/http.test.ts`, `netlify/test/int/session.int.test.ts`

**Interfaces:**
- Consumes: `DriveApi`, `FOLDER_MIME` (Task 5); `SheetsApi`, `SheetRow` (Task 6); `toSheetRow` (Task 6); `PdfAssets`, `loadPdfAssets` (Task 7); shared types
- Produces:
```ts
// errors.ts
export class ApiError extends Error { readonly status: number; readonly code: ErrorCode }
export const fail: {
  unauthenticated(m?: string): ApiError; forbidden(m?: string): ApiError; notInvited(): ApiError; inactive(): ApiError;
  notFound(m?: string): ApiError; invalid(m: string): ApiError; statusChanged(): ApiError; tooLarge(m: string): ApiError;
};
export function errorMessage(e: unknown): string;
// http.ts
export function handle(fn: (req: Request) => Promise<unknown>, opts?: { method?: 'GET' | 'POST' }): (req: Request) => Promise<Response>;
export function readJson<T>(req: Request): Promise<T>;
// firestore.ts
export const COL: { users: 'users'; claims: 'claims'; invites: 'invites'; counters: 'counters' };
export const CLAIM_SEQ_DOC = 'claimSeq';
export function claimRef(db: Firestore, claimId: string): DocumentReference;
export function userRef(db: Firestore, uid: string): DocumentReference;
export function getClaim(db: Firestore, claimId: string): Promise<ClaimDoc | null>;
// firebaseAdmin.ts
export function getAdminApp(): App;
// actor.ts
export interface Actor { uid: string; email: string; name: string; position: string; role: Role; isAdmin: boolean }
export function verifyRequest(deps: Deps, req: Request): Promise<DecodedIdToken>;
export function loadActor(deps: Deps, uid: string): Promise<Actor>;
export function requireActor(deps: Deps, req: Request): Promise<Actor>;
export function assertAdmin(actor: Actor): void;
// claimAccess.ts
export function assertCan(action: ClaimAction, claim: ClaimDoc, actor: Actor): void;
export function canReadClaim(claim: ClaimDoc, actor: Actor): boolean;
// deps.ts
export interface Deps {
  db: Firestore; auth: Auth; drive: DriveApi; sheets: SheetsApi; rootFolderId: string;
  now: () => Date; newId: () => string;
  triggerPdf: (claimId: string, requestId: string) => Promise<void>;
  loadPdfAssets: () => Promise<PdfAssets>;
}
export function getDeps(): Deps;
// services/sheetSync.ts
export function syncClaimToSheet(deps: Deps, claimId: string): Promise<boolean>;
export function resyncSheet(deps: Deps, actor: Actor): Promise<ResyncSheetResponse>;
// services/session.ts
export interface SessionInput { uid: string; email: string | undefined; emailVerified: boolean; name: string | undefined; provider: string }
export function ensureSession(deps: Deps, s: SessionInput): Promise<SessionResponse>;
// test/int/helpers.ts
export function makeTestDeps(): TestKit; // { deps, drive: FakeDrive, sheets: FakeSheets, triggered, setNow }
export function resetEmulators(): Promise<void>;
export function seedUser(deps: Deps, uid: string, overrides?: Partial<UserDoc>): Promise<void>;
export function seedActor(deps: Deps, uid: string, overrides?: Partial<UserDoc>): Promise<Actor>;
export function seedCounter(deps: Deps, next?: number): Promise<void>;
export const BANK: BankDetails;
```

- [ ] **Step 1: Write the failing HTTP wrapper test**

`netlify/test/unit/http.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { fail } from '../../lib/errors';
import { handle, readJson } from '../../lib/http';

const post = (body: unknown) => new Request('http://x/fn', { method: 'POST', body: JSON.stringify(body) });

describe('handle', () => {
  it('returns JSON results', async () => {
    const res = await handle(async (req) => ({ echo: (await readJson<{ a: number }>(req)).a }))(post({ a: 1 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ echo: 1 });
  });
  it('maps ApiError to its status and code', async () => {
    const res = await handle(async () => {
      throw fail.statusChanged();
    })(post({}));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'STATUS_CHANGED' });
  });
  it('hides unexpected errors behind INTERNAL', async () => {
    const res = await handle(async () => {
      throw new Error('secret detail');
    })(post({}));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'INTERNAL', message: 'Something went wrong. Please try again.' });
  });
  it('rejects the wrong method', async () => {
    const res = await handle(async () => ({}))(new Request('http://x/fn', { method: 'GET' }));
    expect(res.status).toBe(405);
  });
  it('passes Response results through', async () => {
    const res = await handle(async () => new Response('raw', { status: 200 }), { method: 'GET' })(
      new Request('http://x/fn'),
    );
    expect(await res.text()).toBe('raw');
  });
  it('rejects malformed JSON with INVALID_INPUT', async () => {
    const res = await handle(async (req) => readJson(req))(new Request('http://x', { method: 'POST', body: '{' }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @jep/netlify`
Expected: FAIL, because `../../lib/errors` is not found.

- [ ] **Step 3: Implement errors and HTTP**

`netlify/lib/errors.ts`:
```ts
import type { ErrorCode } from '@jep/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const fail = {
  unauthenticated: (m = 'Please sign in.') => new ApiError(401, 'UNAUTHENTICATED', m),
  forbidden: (m = 'You are not allowed to do this.') => new ApiError(403, 'FORBIDDEN', m),
  notInvited: () => new ApiError(403, 'NOT_INVITED', 'This account is not authorised. Please contact an admin.'),
  inactive: () => new ApiError(403, 'INACTIVE', 'This account has been deactivated. Please contact an admin.'),
  notFound: (m = 'Not found.') => new ApiError(404, 'NOT_FOUND', m),
  invalid: (m: string) => new ApiError(400, 'INVALID_INPUT', m),
  statusChanged: () =>
    new ApiError(409, 'STATUS_CHANGED', 'This claim was changed by someone else. Please refresh and try again.'),
  tooLarge: (m: string) => new ApiError(413, 'FILE_TOO_LARGE', m),
};

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
```

`netlify/lib/http.ts`:
```ts
import type { ApiErrorBody } from '@jep/shared';
import { ApiError, fail } from './errors';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export function handle(
  fn: (req: Request) => Promise<unknown>,
  opts: { method?: 'GET' | 'POST' } = {},
): (req: Request) => Promise<Response> {
  const method = opts.method ?? 'POST';
  return async (req) => {
    if (req.method !== method) {
      return json({ error: 'METHOD_NOT_ALLOWED', message: `Use ${method}` } satisfies ApiErrorBody, 405);
    }
    try {
      const result = await fn(req);
      if (result instanceof Response) return result;
      return json(result ?? { ok: true });
    } catch (e) {
      if (e instanceof ApiError) return json({ error: e.code, message: e.message } satisfies ApiErrorBody, e.status);
      console.error('[api] unexpected error', e);
      return json({ error: 'INTERNAL', message: 'Something went wrong. Please try again.' } satisfies ApiErrorBody, 500);
    }
  };
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw fail.invalid('Request body must be valid JSON');
  }
}
```

Run: `npm test -w @jep/netlify`
Expected: the http tests PASS.

- [ ] **Step 4: Implement Firestore, admin app, deps, actor and access helpers**

`netlify/lib/firebaseAdmin.ts`:
```ts
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { env } from './env';

export function getAdminApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return initializeApp({ projectId: process.env.GCLOUD_PROJECT ?? process.env.FIREBASE_PROJECT_ID ?? 'demo-jep' });
  }
  return initializeApp({
    credential: cert({
      projectId: env('FIREBASE_PROJECT_ID'),
      clientEmail: env('GOOGLE_SA_EMAIL'),
      privateKey: env('GOOGLE_SA_PRIVATE_KEY').replace(/\\n/g, '\n'),
    }),
  });
}
```

`netlify/lib/firestore.ts`:
```ts
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import type { ClaimDoc } from '@jep/shared';

export const COL = { users: 'users', claims: 'claims', invites: 'invites', counters: 'counters' } as const;
export const CLAIM_SEQ_DOC = 'claimSeq';

export const claimRef = (db: Firestore, claimId: string): DocumentReference => db.collection(COL.claims).doc(claimId);
export const userRef = (db: Firestore, uid: string): DocumentReference => db.collection(COL.users).doc(uid);

export async function getClaim(db: Firestore, claimId: string): Promise<ClaimDoc | null> {
  const snap = await claimRef(db, claimId).get();
  return snap.exists ? (snap.data() as ClaimDoc) : null;
}
```

`netlify/lib/deps.ts`:
```ts
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { loadPdfAssets, type PdfAssets } from './assets';
import { DriveClient, type DriveApi } from './drive';
import { env } from './env';
import { getAdminApp } from './firebaseAdmin';
import { createTokenProvider, SCOPES } from './googleAuth';
import { SheetsClient, type SheetsApi } from './sheets';

export interface Deps {
  db: Firestore;
  auth: Auth;
  drive: DriveApi;
  sheets: SheetsApi;
  rootFolderId: string;
  now: () => Date;
  newId: () => string;
  triggerPdf: (claimId: string, requestId: string) => Promise<void>;
  loadPdfAssets: () => Promise<PdfAssets>;
}

let deps: Deps | null = null;

export function getDeps(): Deps {
  deps ??= createDeps();
  return deps;
}

function createDeps(): Deps {
  const app = getAdminApp();
  const getToken = createTokenProvider({
    clientEmail: env('GOOGLE_SA_EMAIL'),
    privateKey: env('GOOGLE_SA_PRIVATE_KEY').replace(/\\n/g, '\n'),
    scopes: [SCOPES.drive, SCOPES.sheets],
  });
  return {
    db: getFirestore(app),
    auth: getAuth(app),
    drive: new DriveClient(getToken),
    sheets: new SheetsClient(getToken, env('GOOGLE_SHEET_ID')),
    rootFolderId: env('GOOGLE_ROOT_FOLDER_ID'),
    now: () => new Date(),
    newId: () => crypto.randomUUID(),
    loadPdfAssets,
    triggerPdf: async (claimId, requestId) => {
      const base = process.env.FUNCTIONS_BASE_URL ?? process.env.URL;
      if (!base) throw new Error('FUNCTIONS_BASE_URL (or Netlify URL) is not set');
      const res = await fetch(`${base}/.netlify/functions/generate-pdf-background`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': env('INTERNAL_FUNCTION_SECRET') },
        body: JSON.stringify({ claimId, requestId }),
      });
      if (res.status !== 202 && !res.ok) throw new Error(`PDF trigger returned ${res.status}`);
    },
  };
}
```

`netlify/lib/actor.ts`:
```ts
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Role, UserDoc } from '@jep/shared';
import type { Deps } from './deps';
import { fail } from './errors';
import { userRef } from './firestore';

export interface Actor {
  uid: string;
  email: string;
  name: string;
  position: string;
  role: Role;
  isAdmin: boolean;
}

export async function verifyRequest(deps: Deps, req: Request): Promise<DecodedIdToken> {
  const m = /^Bearer (.+)$/.exec(req.headers.get('authorization') ?? '');
  if (!m || !m[1]) throw fail.unauthenticated();
  try {
    return await deps.auth.verifyIdToken(m[1], true);
  } catch {
    throw fail.unauthenticated('Your session has expired. Please sign in again.');
  }
}

export async function loadActor(deps: Deps, uid: string): Promise<Actor> {
  const snap = await userRef(deps.db, uid).get();
  if (!snap.exists) throw fail.notInvited();
  const u = snap.data() as UserDoc;
  if (!u.active) throw fail.inactive();
  return { uid, email: u.email, name: u.name, position: u.position, role: u.role, isAdmin: u.role === 'admin' };
}

export async function requireActor(deps: Deps, req: Request): Promise<Actor> {
  const token = await verifyRequest(deps, req);
  return loadActor(deps, token.uid);
}

export function assertAdmin(actor: Actor): void {
  if (!actor.isAdmin) throw fail.forbidden('Only admins can do this.');
}
```

`netlify/lib/claimAccess.ts`:
```ts
import { CLAIM_RULES, roleAllows, type ClaimAction, type ClaimDoc } from '@jep/shared';
import type { Actor } from './actor';
import { fail } from './errors';

export function canReadClaim(claim: ClaimDoc, actor: Actor): boolean {
  return actor.isAdmin || claim.applicant.uid === actor.uid;
}

/** Role/ownership failures are FORBIDDEN; a wrong current status is STATUS_CHANGED. */
export function assertCan(action: ClaimAction, claim: ClaimDoc, actor: Actor): void {
  const rule = CLAIM_RULES[action];
  if (!roleAllows(rule, { isApplicant: claim.applicant.uid === actor.uid, isAdmin: actor.isAdmin })) {
    throw fail.forbidden();
  }
  if (!rule.from.includes(claim.status)) throw fail.statusChanged();
}
```

`netlify/lib/services/sheetSync.ts`:
```ts
import type { ClaimDoc, ResyncSheetResponse } from '@jep/shared';
import { assertAdmin, type Actor } from '../actor';
import { toSheetRow } from '../claimRow';
import type { Deps } from '../deps';
import { claimRef, COL } from '../firestore';

/** Mirrors one claim to the Sheet. Never throws; records the outcome in `sheetSynced`. */
export async function syncClaimToSheet(deps: Deps, claimId: string): Promise<boolean> {
  const ref = claimRef(deps.db, claimId);
  try {
    const snap = await ref.get();
    if (!snap.exists) return false;
    await deps.sheets.upsertClaimRow(claimId, toSheetRow(claimId, snap.data() as ClaimDoc));
    await ref.update({ sheetSynced: true });
    return true;
  } catch (e) {
    console.error('[sheetSync] failed', claimId, e);
    await ref.update({ sheetSynced: false }).catch(() => undefined);
    return false;
  }
}

export async function resyncSheet(deps: Deps, actor: Actor): Promise<ResyncSheetResponse> {
  assertAdmin(actor);
  const snap = await deps.db.collection(COL.claims).where('sheetSynced', '==', false).get();
  let synced = 0;
  let failed = 0;
  for (const d of snap.docs) {
    if (await syncClaimToSheet(deps, d.id)) synced++;
    else failed++;
  }
  return { synced, failed };
}
```

- [ ] **Step 5: Create the test fakes and helpers**

`netlify/test/fakes.ts`:
```ts
import type { DriveApi, DriveFileMeta } from '../lib/drive';
import { FOLDER_MIME } from '../lib/drive';
import type { SheetRow, SheetsApi } from '../lib/sheets';

interface FakeFile extends DriveFileMeta {
  data: Uint8Array;
}

export class FakeDrive implements DriveApi {
  files = new Map<string, FakeFile>();
  pendingUploads = new Map<string, { name: string; mimeType: string; size: number; parentId: string }>();
  private seq = 0;

  constructor() {
    this.files.set('root', {
      id: 'root', name: 'JEP Claims', mimeType: FOLDER_MIME, size: 0, parents: [], trashed: false, data: new Uint8Array(),
    });
  }

  private nextId(prefix: string) {
    return `${prefix}_${++this.seq}`;
  }

  async findChild(parentId: string, name: string, mimeType: string) {
    for (const f of this.files.values()) {
      if (!f.trashed && f.name === name && f.mimeType === mimeType && f.parents.includes(parentId)) return f.id;
    }
    return null;
  }

  async createEmpty(name: string, mimeType: string, parentId: string) {
    const id = this.nextId(mimeType === FOLDER_MIME ? 'folder' : 'file');
    this.files.set(id, { id, name, mimeType, size: 0, parents: [parentId], trashed: false, data: new Uint8Array() });
    return id;
  }

  async findOrCreateFolder(parentId: string, name: string) {
    return (await this.findChild(parentId, name, FOLDER_MIME)) ?? this.createEmpty(name, FOLDER_MIME, parentId);
  }

  async createResumableUpload(p: { name: string; mimeType: string; size: number; parentId: string }) {
    const url = `https://fake-upload.test/${this.nextId('session')}`;
    this.pendingUploads.set(url, { name: p.name, mimeType: p.mimeType, size: p.size, parentId: p.parentId });
    return url;
  }

  /** Test helper: simulates the app PUTting bytes to a resumable upload URL. Returns the new file id. */
  completeUpload(url: string, data: Uint8Array): string {
    const p = this.pendingUploads.get(url);
    if (!p) throw new Error(`Unknown upload url ${url}`);
    this.pendingUploads.delete(url);
    const id = this.nextId('file');
    this.files.set(id, { id, name: p.name, mimeType: p.mimeType, size: data.length, parents: [p.parentId], trashed: false, data });
    return id;
  }

  async getFile(id: string): Promise<DriveFileMeta | null> {
    const f = this.files.get(id);
    if (!f) return null;
    return { id: f.id, name: f.name, mimeType: f.mimeType, size: f.size, parents: [...f.parents], trashed: f.trashed };
  }

  async download(id: string) {
    const f = this.files.get(id);
    if (!f) throw new Error(`Drive download failed: 404 ${id}`);
    return f.data;
  }

  async downloadResponse(id: string) {
    const d = await this.download(id);
    return new Response(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) as ArrayBuffer);
  }

  async upload(p: { name: string; mimeType: string; parentId: string; data: Uint8Array }) {
    const url = await this.createResumableUpload({ name: p.name, mimeType: p.mimeType, size: p.data.length, parentId: p.parentId });
    return { id: this.completeUpload(url, p.data) };
  }

  async trash(id: string) {
    const f = this.files.get(id);
    if (f) f.trashed = true;
  }

  /** Test helper: "JEP Claims/2026/_attachments/<claimId>" style path of a folder. */
  folderPath(id: string): string {
    const names: string[] = [];
    let cur = this.files.get(id);
    while (cur) {
      names.unshift(cur.name);
      cur = cur.parents[0] ? this.files.get(cur.parents[0]) : undefined;
    }
    return names.join('/');
  }

  /** Test helper: live PDFs whose names start with PR-JEP. */
  livePdfs(): FakeFile[] {
    return [...this.files.values()].filter((f) => !f.trashed && f.name.startsWith('PR-JEP'));
  }
}

export class FakeSheets implements SheetsApi {
  rows = new Map<string, SheetRow>();
  failing = false;

  async upsertClaimRow(claimId: string, row: SheetRow) {
    if (this.failing) throw new Error('Sheets unavailable');
    this.rows.set(claimId, row);
  }

  async deleteClaimRow(claimId: string) {
    this.rows.delete(claimId);
  }
}
```

`netlify/test/int/helpers.ts`:
```ts
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
```

- [ ] **Step 6: Write the failing session test**

`netlify/test/int/session.int.test.ts`:
```ts
import { Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadActor } from '../../lib/actor';
import { COL } from '../../lib/firestore';
import { ensureSession } from '../../lib/services/session';
import { makeTestDeps, resetEmulators, seedUser } from './helpers';

beforeEach(resetEmulators);

const google = (uid: string, email: string, emailVerified = true) => ({
  uid, email, emailVerified, name: 'New Person', provider: 'google.com',
});

describe('ensureSession', () => {
  it('creates the user from an invite on first Google sign-in', async () => {
    const { deps } = makeTestDeps();
    await deps.db.collection(COL.invites).doc('new@gmail.com').set({ role: 'admin', invitedByUid: 'setup', invitedAt: Timestamp.now() });
    const res = await ensureSession(deps, google('u1', 'New@Gmail.com'));
    expect(res).toEqual({ uid: 'u1', role: 'admin', profileComplete: false });
    const user = (await deps.db.collection(COL.users).doc('u1').get()).data();
    expect(user).toMatchObject({ email: 'new@gmail.com', name: 'New Person', role: 'admin', active: true, authProvider: 'google' });
    expect((await deps.db.collection(COL.invites).doc('new@gmail.com').get()).exists).toBe(false);
  });

  it('rejects uninvited or unverified accounts', async () => {
    const { deps } = makeTestDeps();
    await expect(ensureSession(deps, google('u2', 'stranger@gmail.com'))).rejects.toMatchObject({ code: 'NOT_INVITED' });
    await deps.db.collection(COL.invites).doc('x@gmail.com').set({ role: 'member', invitedByUid: 's', invitedAt: Timestamp.now() });
    await expect(ensureSession(deps, google('u3', 'x@gmail.com', false))).rejects.toMatchObject({ code: 'NOT_INVITED' });
  });

  it('returns existing users and blocks inactive ones', async () => {
    const { deps } = makeTestDeps();
    await seedUser(deps, 'alice');
    expect(await ensureSession(deps, google('alice', 'alice@example.com'))).toEqual({
      uid: 'alice', role: 'member', profileComplete: true,
    });
    await seedUser(deps, 'gone', { active: false });
    await expect(ensureSession(deps, google('gone', 'gone@example.com'))).rejects.toMatchObject({ code: 'INACTIVE' });
    await expect(loadActor(deps, 'gone')).rejects.toMatchObject({ code: 'INACTIVE' });
    await expect(loadActor(deps, 'nobody')).rejects.toMatchObject({ code: 'NOT_INVITED' });
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npm run test:int` (with the Java PATH exported)
Expected: FAIL, because `../../lib/services/session` is not found.

- [ ] **Step 8: Implement the session service**

`netlify/lib/services/session.ts`:
```ts
import { Timestamp } from 'firebase-admin/firestore';
import { isProfileComplete, type InviteDoc, type SessionResponse, type UserDoc } from '@jep/shared';
import type { Deps } from '../deps';
import { fail } from '../errors';
import { COL, userRef } from '../firestore';

export interface SessionInput {
  uid: string;
  email: string | undefined;
  emailVerified: boolean;
  name: string | undefined;
  provider: string;
}

/** Called after every sign-in. Turns an invite into a user on first Google sign-in. */
export async function ensureSession(deps: Deps, s: SessionInput): Promise<SessionResponse> {
  const uref = userRef(deps.db, s.uid);
  const user = await deps.db.runTransaction(async (tx) => {
    const snap = await tx.get(uref);
    if (snap.exists) return snap.data() as UserDoc;
    if (!s.email || !s.emailVerified) throw fail.notInvited();
    const email = s.email.toLowerCase();
    const iref = deps.db.collection(COL.invites).doc(email);
    const inv = await tx.get(iref);
    if (!inv.exists) throw fail.notInvited();
    const now = Timestamp.fromDate(deps.now());
    const doc: UserDoc = {
      email,
      name: s.name ?? '',
      position: '',
      role: (inv.data() as InviteDoc).role,
      active: true,
      bank: null,
      authProvider: s.provider === 'password' ? 'password' : 'google',
      createdAt: now,
      updatedAt: now,
    };
    tx.create(uref, doc);
    tx.delete(iref);
    return doc;
  });
  if (!user.active) throw fail.inactive();
  return { uid: s.uid, role: user.role, profileComplete: isProfileComplete(user) };
}
```

- [ ] **Step 9: Run all tests**

Run: `npm test && npm run test:int && npm run typecheck`
Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git add netlify
git commit -m "feat(netlify): add API core, actor loading, test fakes and session service

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Upload sessions + submit / resubmit

**Files:**
- Create: `netlify/lib/services/attachmentsFolder.ts`, `netlify/lib/services/uploadSession.ts`, `netlify/lib/services/pdfTrigger.ts`, `netlify/lib/services/submitClaim.ts`
- Modify: `netlify/test/int/helpers.ts` (append `uploadFiles` and `submitNewClaim`)
- Test: `netlify/test/int/submit.int.test.ts`

**Interfaces:**
- Consumes: Deps, Actor, fail, getClaim/claimRef/userRef, syncClaimToSheet (Task 9); shared validation/refNo/fileName/types
- Produces:
```ts
export function attachmentsFolderFor(deps: Deps, year: string, claimId: string): Promise<string>;   // creates
export function findAttachmentsFolder(deps: Deps, claimId: string, years: string[]): Promise<string | null>; // no create
export function createUploadSessions(deps: Deps, actor: Actor, req: UploadSessionRequest): Promise<UploadSessionResponse>;
export function startPdf(deps: Deps, claimId: string, requestId: string): Promise<void>;
export function markPdfFailed(deps: Deps, claimId: string, requestId: string, error: string): Promise<void>;
export function submitClaim(deps: Deps, actor: Actor, req: SubmitClaimRequest): Promise<SubmitClaimResponse>;
// helpers.ts additions
export function uploadFiles(t: TestKit, actor: Actor, claimId: string, files: TestFile[]): Promise<string[]>;
export function submitNewClaim(t: TestKit, actor: Actor, opts?: { files?: TestFile[]; amounts?: number[] }): Promise<{ claimId: string; attachmentIds: string[] }>;
```

Behaviour notes:
- A new claim's attachments go in `{root}/{yyyy}/_attachments/{claimId}`. `yyyy` is the MYT year at upload time. At submit, the folder is looked up in both the current year and the previous year (no create), so a claim uploaded on 31 Dec and submitted on 1 Jan still works.
- The submitted file IDs must be live files directly inside that folder, with an allowed type and size.
- A resubmit keeps `refNo` and `submittedAt`, sets `resubmittedAt`, refreshes the applicant name and position from the profile, clears `review`, and trashes the attachments that were removed. It also keeps `pdf.driveFileId` pointing at the old draft, so `generatePdf` can trash the old draft after the new one uploads.

- [ ] **Step 1: Add the test helpers**

Append to `netlify/test/int/helpers.ts`:
```ts
import { createUploadSessions } from '../../lib/services/uploadSession';
import { submitClaim } from '../../lib/services/submitClaim';

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
```
(Move these two `import` lines to the top of the file with the other imports.)

- [ ] **Step 2: Write the failing tests**

`netlify/test/int/submit.int.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { UserDoc } from '@jep/shared';
import { COL, getClaim } from '../../lib/firestore';
import { submitClaim } from '../../lib/services/submitClaim';
import {
  BANK, jpgFile, makeTestDeps, newClaimId, resetEmulators, seedActor, submitNewClaim, uploadFiles,
} from './helpers';

beforeEach(resetEmulators);

describe('submitClaim (new)', () => {
  it('creates a draft claim, mirrors it to the Sheet and triggers the PDF', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    const { claimId, attachmentIds } = await submitNewClaim(t, alice);

    const c = (await getClaim(t.deps.db, claimId))!;
    expect(c.refNo).toBe('PR-JEP-202609-draft');
    expect(c.status).toBe('submitted');
    expect(c.totalCents).toBe(15000);
    expect(c.applicant).toEqual({ uid: 'alice', name: 'User alice', position: 'Executive' });
    expect(c.attachments.map((a) => a.driveFileId)).toEqual(attachmentIds);
    expect(c.pdf).toEqual({ status: 'generating', requestId: 'req_1', driveFileId: null, fileName: null, error: null });
    expect(c.history.map((h) => h.action)).toEqual(['submit']);
    expect(c.sheetSynced).toBe(true);
    expect(t.drive.folderPath(c.attachmentsFolderId)).toBe(`JEP Claims/2026/_attachments/${claimId}`);
    expect(t.sheets.rows.get(claimId)?.[1]).toBe('PR-JEP-202609-draft');
    expect(t.triggered).toEqual([{ claimId, requestId: 'req_1' }]);
  });

  it('rejects attachments that belong to another claim', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    const bob = await seedActor(t.deps, 'bob');
    const bobs = await submitNewClaim(t, bob);
    const claimId = newClaimId(t.deps);
    await uploadFiles(t, alice, claimId, [jpgFile()]);
    await expect(
      submitClaim(t.deps, alice, {
        claimId, items: [{ description: 'x', amountCents: 100 }], payment: BANK,
        attachmentIds: bobs.attachmentIds, resubmit: false, saveBankToProfile: false,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('validates items, bank details and attachment count', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    const claimId = newClaimId(t.deps);
    const ids = await uploadFiles(t, alice, claimId, [jpgFile()]);
    const base = { claimId, items: [{ description: 'x', amountCents: 100 }], payment: BANK, attachmentIds: ids, resubmit: false, saveBankToProfile: false };
    await expect(submitClaim(t.deps, alice, { ...base, items: [] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(submitClaim(t.deps, alice, { ...base, payment: { ...BANK, accountNumber: '' } })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(submitClaim(t.deps, alice, { ...base, attachmentIds: [] })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(submitClaim(t.deps, alice, { ...base, claimId: 'bad' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('requires a profile name', async () => {
    const t = makeTestDeps();
    const anon = await seedActor(t.deps, 'anon', { name: '' });
    await expect(submitNewClaim(t, anon)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('still succeeds when the Sheet is down, flagging sheetSynced=false', async () => {
    const t = makeTestDeps();
    t.sheets.failing = true;
    const alice = await seedActor(t.deps, 'alice');
    const { claimId } = await submitNewClaim(t, alice);
    expect((await getClaim(t.deps.db, claimId))!.sheetSynced).toBe(false);
  });

  it('saves bank details to the profile when asked', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice', { bank: null });
    const claimId = newClaimId(t.deps);
    const ids = await uploadFiles(t, alice, claimId, [jpgFile()]);
    await submitClaim(t.deps, alice, {
      claimId, items: [{ description: 'x', amountCents: 100 }], payment: BANK, attachmentIds: ids, resubmit: false, saveBankToProfile: true,
    });
    const u = (await t.deps.db.collection(COL.users).doc('alice').get()).data() as UserDoc;
    expect(u.bank).toEqual(BANK);
  });

  it('rejects upload sessions with bad files', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    await expect(
      uploadFiles(t, alice, newClaimId(t.deps), [{ name: 'a.gif', mimeType: 'image/gif', data: new Uint8Array(5) }]),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('submitClaim (resubmit guards)', () => {
  // The full reject → resubmit flow is tested in Task 11 (review.int.test.ts).
  it('only the applicant may resubmit, and only when rejected', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    const bob = await seedActor(t.deps, 'bob');
    const { claimId, attachmentIds } = await submitNewClaim(t, alice);
    const req = { claimId, items: [{ description: 'x', amountCents: 1 }], payment: BANK, attachmentIds, resubmit: true, saveBankToProfile: false };
    await expect(submitClaim(t.deps, bob, req)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(submitClaim(t.deps, alice, req)).rejects.toMatchObject({ code: 'STATUS_CHANGED' });
    await expect(uploadFiles(t, bob, claimId, [jpgFile()])).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run test:int`
Expected: FAIL, because the services are not found.

- [ ] **Step 4: Implement**

`netlify/lib/services/attachmentsFolder.ts`:
```ts
import { FOLDER_MIME } from '../drive';
import type { Deps } from '../deps';

const ATTACHMENTS = '_attachments';

export async function attachmentsFolderFor(deps: Deps, year: string, claimId: string): Promise<string> {
  const yearId = await deps.drive.findOrCreateFolder(deps.rootFolderId, year);
  const attId = await deps.drive.findOrCreateFolder(yearId, ATTACHMENTS);
  return deps.drive.findOrCreateFolder(attId, claimId);
}

export async function findAttachmentsFolder(deps: Deps, claimId: string, years: string[]): Promise<string | null> {
  for (const year of years) {
    const yearId = await deps.drive.findChild(deps.rootFolderId, year, FOLDER_MIME);
    if (!yearId) continue;
    const attId = await deps.drive.findChild(yearId, ATTACHMENTS, FOLDER_MIME);
    if (!attId) continue;
    const folder = await deps.drive.findChild(attId, claimId, FOLDER_MIME);
    if (folder) return folder;
  }
  return null;
}
```

`netlify/lib/services/uploadSession.ts`:
```ts
import {
  formatYyyyMm, isValidClaimId, sanitizeFileNamePart, validateAttachmentMeta,
  type UploadSessionRequest, type UploadSessionResponse,
} from '@jep/shared';
import type { Actor } from '../actor';
import { assertCan } from '../claimAccess';
import type { Deps } from '../deps';
import { fail } from '../errors';
import { getClaim } from '../firestore';
import { attachmentsFolderFor } from './attachmentsFolder';

export async function createUploadSessions(
  deps: Deps,
  actor: Actor,
  req: UploadSessionRequest,
): Promise<UploadSessionResponse> {
  if (!isValidClaimId(req?.claimId)) throw fail.invalid('Invalid claimId');
  const errors = validateAttachmentMeta(req.files);
  if (errors.length) throw fail.invalid(errors.join('; '));

  const existing = await getClaim(deps.db, req.claimId);
  let folderId: string;
  if (existing) {
    assertCan('resubmit', existing, actor);
    folderId = existing.attachmentsFolderId;
  } else {
    folderId = await attachmentsFolderFor(deps, formatYyyyMm(deps.now()).slice(0, 4), req.claimId);
  }

  const uploads: UploadSessionResponse['uploads'] = [];
  for (const f of req.files) {
    const name = sanitizeFileNamePart(f.name) || 'attachment';
    uploads.push({
      name,
      uploadUrl: await deps.drive.createResumableUpload({ name, mimeType: f.mimeType, size: f.size, parentId: folderId }),
    });
  }
  return { folderId, uploads };
}
```

`netlify/lib/services/pdfTrigger.ts`:
```ts
import type { ClaimDoc } from '@jep/shared';
import type { Deps } from '../deps';
import { errorMessage } from '../errors';
import { claimRef } from '../firestore';
import { syncClaimToSheet } from './sheetSync';

/** Marks the PDF failed, but only if `requestId` is still the latest request. */
export async function markPdfFailed(deps: Deps, claimId: string, requestId: string, error: string): Promise<void> {
  const ref = claimRef(deps.db, claimId);
  const updated = await deps.db.runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).data() as ClaimDoc | undefined;
    if (!cur || cur.pdf.requestId !== requestId) return false;
    tx.update(ref, { 'pdf.status': 'failed', 'pdf.error': error.slice(0, 500) });
    return true;
  });
  if (updated) await syncClaimToSheet(deps, claimId);
}

export async function startPdf(deps: Deps, claimId: string, requestId: string): Promise<void> {
  try {
    await deps.triggerPdf(claimId, requestId);
  } catch (e) {
    console.error('[startPdf] trigger failed', claimId, e);
    await markPdfFailed(deps, claimId, requestId, `Could not start PDF generation: ${errorMessage(e)}`);
  }
}
```

`netlify/lib/services/submitClaim.ts`:
```ts
import { Timestamp } from 'firebase-admin/firestore';
import {
  draftRefNo, formatYyyyMm, isAllowedMime, isValidClaimId, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS, MIN_ATTACHMENTS,
  sumCents, validateBank, validateItems,
  type Attachment, type BankDetails, type ClaimDoc, type ClaimItem, type HistoryAction, type HistoryEntry,
  type SubmitClaimRequest, type SubmitClaimResponse,
} from '@jep/shared';
import type { Actor } from '../actor';
import { assertCan } from '../claimAccess';
import type { Deps } from '../deps';
import { fail } from '../errors';
import { claimRef, getClaim, userRef } from '../firestore';
import { findAttachmentsFolder } from './attachmentsFolder';
import { startPdf } from './pdfTrigger';
import { syncClaimToSheet } from './sheetSync';

export async function submitClaim(deps: Deps, actor: Actor, req: SubmitClaimRequest): Promise<SubmitClaimResponse> {
  if (!isValidClaimId(req?.claimId)) throw fail.invalid('Invalid claimId');
  if (!actor.name.trim()) throw fail.invalid('Please complete your profile (name) before submitting.');
  const errors = [...validateItems(req.items), ...validateBank(req.payment)];
  if (errors.length) throw fail.invalid(errors.join('; '));
  const ids = req.attachmentIds;
  if (
    !Array.isArray(ids) ||
    ids.length < MIN_ATTACHMENTS ||
    ids.length > MAX_ATTACHMENTS ||
    new Set(ids).size !== ids.length ||
    !ids.every((id) => typeof id === 'string' && id.length > 0)
  ) {
    throw fail.invalid(`Attach ${MIN_ATTACHMENTS} to ${MAX_ATTACHMENTS} files`);
  }

  const items: ClaimItem[] = req.items.map((i) => ({ description: i.description.trim(), amountCents: i.amountCents }));
  const payment: BankDetails = {
    bankName: req.payment.bankName.trim(),
    accountHolder: req.payment.accountHolder.trim(),
    accountNumber: req.payment.accountNumber.trim(),
  };

  const existing = await getClaim(deps.db, req.claimId);
  let folderId: string;
  if (req.resubmit) {
    if (!existing) throw fail.notFound('Claim not found');
    assertCan('resubmit', existing, actor);
    folderId = existing.attachmentsFolderId;
  } else {
    if (existing) throw fail.invalid('This claim was already submitted');
    const year = formatYyyyMm(deps.now()).slice(0, 4);
    const found = await findAttachmentsFolder(deps, req.claimId, [year, String(Number(year) - 1)]);
    if (!found) throw fail.invalid('Attachments were not uploaded for this claim');
    folderId = found;
  }

  const attachments: Attachment[] = [];
  for (const id of ids) {
    const meta = await deps.drive.getFile(id);
    if (!meta || meta.trashed || !meta.parents.includes(folderId)) {
      throw fail.invalid('An attachment does not belong to this claim. Please re-upload it.');
    }
    if (!isAllowedMime(meta.mimeType) || meta.size <= 0 || meta.size > MAX_ATTACHMENT_BYTES) {
      throw fail.invalid(`${meta.name}: file type or size is not allowed`);
    }
    attachments.push({ driveFileId: meta.id, name: meta.name, mimeType: meta.mimeType, size: meta.size });
  }

  const now = Timestamp.fromDate(deps.now());
  const requestId = deps.newId();
  const totalCents = sumCents(items);
  const entry = (action: HistoryAction): HistoryEntry => ({ action, byUid: actor.uid, byName: actor.name, at: now, note: null });
  const ref = claimRef(deps.db, req.claimId);

  if (req.resubmit) {
    const removed = await deps.db.runTransaction(async (tx) => {
      const cur = (await tx.get(ref)).data() as ClaimDoc;
      if (cur.status !== 'rejected') throw fail.statusChanged();
      tx.update(ref, {
        status: 'submitted',
        applicant: { uid: actor.uid, name: actor.name, position: actor.position },
        items,
        totalCents,
        payment,
        attachments,
        review: null,
        pdf: { ...cur.pdf, status: 'generating', requestId, error: null },
        history: [...cur.history, entry('resubmit')],
        resubmittedAt: now,
        updatedAt: now,
      });
      const keep = new Set(ids);
      return cur.attachments.filter((a) => !keep.has(a.driveFileId));
    });
    for (const a of removed) {
      await deps.drive.trash(a.driveFileId).catch((e) => console.error('[submitClaim] trash failed', a.driveFileId, e));
    }
  } else {
    const doc: ClaimDoc = {
      refNo: draftRefNo(deps.now()),
      status: 'submitted',
      applicant: { uid: actor.uid, name: actor.name, position: actor.position },
      items,
      totalCents,
      payment,
      attachments,
      attachmentsFolderId: folderId,
      pdf: { status: 'generating', requestId, driveFileId: null, fileName: null, error: null },
      review: null,
      paidInfo: null,
      history: [entry('submit')],
      submittedAt: now,
      resubmittedAt: null,
      sheetSynced: false,
      createdAt: now,
      updatedAt: now,
    };
    await ref.create(doc);
  }

  if (req.saveBankToProfile) await userRef(deps.db, actor.uid).update({ bank: payment, updatedAt: now });
  await syncClaimToSheet(deps, req.claimId);
  await startPdf(deps, req.claimId, requestId);
  return { claimId: req.claimId };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:int && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add netlify
git commit -m "feat(netlify): add upload sessions and claim submit/resubmit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Review (approve/reject with numbering), cancel, mark paid, regenerate PDF

**Files:**
- Create: `netlify/lib/services/reviewClaim.ts`, `netlify/lib/services/claimActions.ts`
- Test: `netlify/test/int/review.int.test.ts`, `netlify/test/int/claimActions.int.test.ts`

**Interfaces:**
- Consumes: `assertAdmin`, `assertCan`, `fail`, `claimRef`, `COL`, `CLAIM_SEQ_DOC`, `syncClaimToSheet` (Task 9); `startPdf`, `markPdfFailed` (Task 10); `finalRefNo`, `isValidClaimId`, `isValidYmd` (shared)
- Produces:
```ts
export function reviewClaim(deps: Deps, actor: Actor, req: ReviewClaimRequest): Promise<ReviewClaimResponse>;
export function cancelClaim(deps: Deps, actor: Actor, req: ClaimIdRequest): Promise<StatusResponse>;
export function markPaid(deps: Deps, actor: Actor, req: MarkPaidRequest): Promise<StatusResponse>;
export function regeneratePdf(deps: Deps, actor: Actor, req: ClaimIdRequest): Promise<{ ok: true }>;
```

- [ ] **Step 1: Write the failing tests**

`netlify/test/int/review.int.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { CLAIM_SEQ_DOC, COL, getClaim } from '../../lib/firestore';
import { reviewClaim } from '../../lib/services/reviewClaim';
import { submitClaim } from '../../lib/services/submitClaim';
import {
  BANK, jpgFile, makeTestDeps, pdfBytes, resetEmulators, seedActor, seedCounter, submitNewClaim, uploadFiles,
} from './helpers';

beforeEach(resetEmulators);

async function setup(next = 1) {
  const t = makeTestDeps();
  await seedCounter(t.deps, next);
  const alice = await seedActor(t.deps, 'alice');
  const boss = await seedActor(t.deps, 'boss', { role: 'admin' });
  return { t, alice, boss };
}

describe('reviewClaim', () => {
  it('assigns global sequential numbers using the approval month', async () => {
    const { t, alice, boss } = await setup(5);
    const a = await submitNewClaim(t, alice);
    const b = await submitNewClaim(t, alice);
    t.setNow(new Date('2026-10-01T02:00:00Z'));

    expect(await reviewClaim(t.deps, boss, { claimId: a.claimId, decision: 'approve' })).toEqual({
      status: 'approved', refNo: 'PR-JEP-202610-005',
    });
    expect((await reviewClaim(t.deps, boss, { claimId: b.claimId, decision: 'approve' })).refNo).toBe('PR-JEP-202610-006');
    expect((await t.deps.db.collection(COL.counters).doc(CLAIM_SEQ_DOC).get()).data()).toEqual({ next: 7 });

    const c = (await getClaim(t.deps.db, a.claimId))!;
    expect(c.status).toBe('approved');
    expect(c.review).toMatchObject({ byUid: 'boss', byName: 'User boss', reason: null });
    expect(c.pdf.status).toBe('generating');
    expect(t.triggered.at(-2)).toEqual({ claimId: a.claimId, requestId: c.pdf.requestId });
    expect(t.sheets.rows.get(a.claimId)?.[1]).toBe('PR-JEP-202610-005');
  });

  it('does not consume numbers for rejected claims', async () => {
    const { t, alice, boss } = await setup();
    const a = await submitNewClaim(t, alice);
    const b = await submitNewClaim(t, alice);
    const rej = await reviewClaim(t.deps, boss, { claimId: a.claimId, decision: 'reject', reason: 'No receipt' });
    expect(rej).toEqual({ status: 'rejected', refNo: 'PR-JEP-202609-draft' });
    expect((await reviewClaim(t.deps, boss, { claimId: b.claimId, decision: 'approve' })).refNo).toBe('PR-JEP-202609-001');
    expect((await getClaim(t.deps.db, a.claimId))!.review?.reason).toBe('No receipt');
  });

  it('requires a reason to reject, and admin rights', async () => {
    const { t, alice, boss } = await setup();
    const { claimId } = await submitNewClaim(t, alice);
    await expect(reviewClaim(t.deps, boss, { claimId, decision: 'reject', reason: '  ' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(reviewClaim(t.deps, alice, { claimId, decision: 'approve' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses a second review with STATUS_CHANGED', async () => {
    const { t, alice, boss } = await setup();
    const { claimId } = await submitNewClaim(t, alice);
    await reviewClaim(t.deps, boss, { claimId, decision: 'approve' });
    await expect(reviewClaim(t.deps, boss, { claimId, decision: 'approve' })).rejects.toMatchObject({ code: 'STATUS_CHANGED' });
  });

  it('gives concurrent approvals unique consecutive numbers', async () => {
    const { t, alice, boss } = await setup();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await submitNewClaim(t, alice)).claimId);
    const results = await Promise.all(ids.map((claimId) => reviewClaim(t.deps, boss, { claimId, decision: 'approve' })));
    expect(results.map((r) => r.refNo).sort()).toEqual([1, 2, 3, 4, 5].map((n) => `PR-JEP-202609-00${n}`));
  });

  it('fails clearly when the counter is not initialised', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    const boss = await seedActor(t.deps, 'boss', { role: 'admin' });
    const { claimId } = await submitNewClaim(t, alice);
    await expect(reviewClaim(t.deps, boss, { claimId, decision: 'approve' })).rejects.toThrow(/claimSeq/);
  });
});

describe('reject then resubmit', () => {
  it('resubmits a rejected claim and trashes removed attachments', async () => {
    const { t, alice, boss } = await setup();
    const { claimId, attachmentIds } = await submitNewClaim(t, alice, {
      files: [jpgFile('a.jpg'), { name: 'b.pdf', mimeType: 'application/pdf', data: await pdfBytes() }],
    });
    await reviewClaim(t.deps, boss, { claimId, decision: 'reject', reason: 'Missing receipt' });

    const [added] = await uploadFiles(t, alice, claimId, [jpgFile('c.jpg')]);
    t.setNow(new Date('2026-09-26T04:00:00Z'));
    await submitClaim(t.deps, alice, {
      claimId, items: [{ description: 'Fixed', amountCents: 500 }], payment: BANK,
      attachmentIds: [attachmentIds[0]!, added!], resubmit: true, saveBankToProfile: false,
    });

    const c = (await getClaim(t.deps.db, claimId))!;
    expect(c.status).toBe('submitted');
    expect(c.refNo).toBe('PR-JEP-202609-draft');
    expect(c.totalCents).toBe(500);
    expect(c.review).toBeNull();
    expect(c.resubmittedAt?.toDate().toISOString()).toBe('2026-09-26T04:00:00.000Z');
    expect(c.attachments.map((a) => a.driveFileId)).toEqual([attachmentIds[0], added]);
    expect(c.history.map((h) => h.action)).toEqual(['submit', 'reject', 'resubmit']);
    expect(t.drive.files.get(attachmentIds[1]!)!.trashed).toBe(true);
    expect(t.triggered).toHaveLength(2);
  });
});
```

`netlify/test/int/claimActions.int.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { getClaim } from '../../lib/firestore';
import { cancelClaim, markPaid, regeneratePdf } from '../../lib/services/claimActions';
import { markPdfFailed } from '../../lib/services/pdfTrigger';
import { reviewClaim } from '../../lib/services/reviewClaim';
import { makeTestDeps, resetEmulators, seedActor, seedCounter, submitNewClaim } from './helpers';

beforeEach(resetEmulators);

async function setup() {
  const t = makeTestDeps();
  await seedCounter(t.deps);
  const alice = await seedActor(t.deps, 'alice');
  const bob = await seedActor(t.deps, 'bob');
  const boss = await seedActor(t.deps, 'boss', { role: 'admin' });
  return { t, alice, bob, boss };
}

describe('cancelClaim', () => {
  it('lets the applicant withdraw a submitted claim', async () => {
    const { t, alice } = await setup();
    const { claimId } = await submitNewClaim(t, alice);
    expect(await cancelClaim(t.deps, alice, { claimId })).toEqual({ status: 'cancelled' });
    const c = (await getClaim(t.deps.db, claimId))!;
    expect(c.status).toBe('cancelled');
    expect(c.history.at(-1)?.action).toBe('cancel');
    expect(t.sheets.rows.get(claimId)?.[2]).toBe('cancelled');
  });

  it('refuses other users and non-submitted claims', async () => {
    const { t, alice, bob, boss } = await setup();
    const { claimId } = await submitNewClaim(t, alice);
    await expect(cancelClaim(t.deps, bob, { claimId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(cancelClaim(t.deps, boss, { claimId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await reviewClaim(t.deps, boss, { claimId, decision: 'approve' });
    await expect(cancelClaim(t.deps, alice, { claimId })).rejects.toMatchObject({ code: 'STATUS_CHANGED' });
  });
});

describe('markPaid', () => {
  it('records payment on an approved claim', async () => {
    const { t, alice, boss } = await setup();
    const { claimId } = await submitNewClaim(t, alice);
    await expect(markPaid(t.deps, boss, { claimId, paidDate: '2026-09-27', reference: 'IBG' })).rejects.toMatchObject({ code: 'STATUS_CHANGED' });
    await reviewClaim(t.deps, boss, { claimId, decision: 'approve' });
    await expect(markPaid(t.deps, boss, { claimId, paidDate: '27/09/2026', reference: '' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(markPaid(t.deps, alice, { claimId, paidDate: '2026-09-27', reference: '' })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(await markPaid(t.deps, boss, { claimId, paidDate: '2026-09-27', reference: ' IBG123 ' })).toEqual({ status: 'paid' });
    const c = (await getClaim(t.deps.db, claimId))!;
    expect(c.status).toBe('paid');
    expect(c.paidInfo).toMatchObject({ byUid: 'boss', paidDate: '2026-09-27', reference: 'IBG123' });
    expect(t.sheets.rows.get(claimId)?.[14]).toBe('2026-09-27');
  });
});

describe('regeneratePdf', () => {
  it('only restarts a failed PDF, for the applicant or an admin', async () => {
    const { t, alice, bob, boss } = await setup();
    const { claimId } = await submitNewClaim(t, alice);
    await expect(regeneratePdf(t.deps, alice, { claimId })).rejects.toMatchObject({ code: 'STATUS_CHANGED' });

    await markPdfFailed(t.deps, claimId, t.triggered[0]!.requestId, 'boom');
    await expect(regeneratePdf(t.deps, bob, { claimId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await regeneratePdf(t.deps, boss, { claimId })).toEqual({ ok: true });

    const c = (await getClaim(t.deps.db, claimId))!;
    expect(c.pdf.status).toBe('generating');
    expect(c.pdf.error).toBeNull();
    expect(t.triggered.at(-1)).toEqual({ claimId, requestId: c.pdf.requestId });
    expect(c.history.at(-1)?.action).toBe('pdf_regenerate');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:int`
Expected: FAIL, because the services are not found.

- [ ] **Step 3: Implement the review service**

`netlify/lib/services/reviewClaim.ts`:
```ts
import { Timestamp } from 'firebase-admin/firestore';
import {
  finalRefNo, isValidClaimId,
  type ClaimDoc, type ReviewClaimRequest, type ReviewClaimResponse, type ReviewInfo,
} from '@jep/shared';
import { assertAdmin, type Actor } from '../actor';
import type { Deps } from '../deps';
import { fail } from '../errors';
import { CLAIM_SEQ_DOC, claimRef, COL } from '../firestore';
import { startPdf } from './pdfTrigger';
import { syncClaimToSheet } from './sheetSync';

export async function reviewClaim(deps: Deps, actor: Actor, req: ReviewClaimRequest): Promise<ReviewClaimResponse> {
  assertAdmin(actor);
  if (!isValidClaimId(req?.claimId)) throw fail.invalid('Invalid claimId');
  if (req.decision !== 'approve' && req.decision !== 'reject') throw fail.invalid('decision must be approve or reject');
  const reason = typeof req.reason === 'string' ? req.reason.trim() : '';
  if (req.decision === 'reject' && !reason) throw fail.invalid('A reason is required to reject a claim');
  if (reason.length > 500) throw fail.invalid('Reason is too long (max 500 characters)');

  const ref = claimRef(deps.db, req.claimId);
  const counterRef = deps.db.collection(COL.counters).doc(CLAIM_SEQ_DOC);
  const nowDate = deps.now();
  const now = Timestamp.fromDate(nowDate);
  const requestId = deps.newId();

  const result = await deps.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw fail.notFound('Claim not found');
    const cur = snap.data() as ClaimDoc;
    if (cur.status !== 'submitted') throw fail.statusChanged();
    const review: ReviewInfo = {
      byUid: actor.uid,
      byName: actor.name,
      at: now,
      reason: req.decision === 'reject' ? reason : null,
    };

    if (req.decision === 'approve') {
      const counter = await tx.get(counterRef);
      const seq = (counter.data() as { next?: unknown } | undefined)?.next;
      if (typeof seq !== 'number') throw new Error('counters/claimSeq is not initialised; run the setup script');
      const refNo = finalRefNo(nowDate, seq);
      tx.update(counterRef, { next: seq + 1 });
      tx.update(ref, {
        status: 'approved',
        refNo,
        review,
        pdf: { ...cur.pdf, status: 'generating', requestId, error: null },
        history: [...cur.history, { action: 'approve', byUid: actor.uid, byName: actor.name, at: now, note: refNo }],
        updatedAt: now,
      });
      return { status: 'approved' as const, refNo };
    }

    tx.update(ref, {
      status: 'rejected',
      review,
      history: [...cur.history, { action: 'reject', byUid: actor.uid, byName: actor.name, at: now, note: reason }],
      updatedAt: now,
    });
    return { status: 'rejected' as const, refNo: cur.refNo };
  });

  await syncClaimToSheet(deps, req.claimId);
  if (result.status === 'approved') await startPdf(deps, req.claimId, requestId);
  return result;
}
```

- [ ] **Step 4: Implement the other claim actions**

`netlify/lib/services/claimActions.ts`:
```ts
import { Timestamp } from 'firebase-admin/firestore';
import {
  isValidClaimId, isValidYmd,
  type ClaimDoc, type ClaimIdRequest, type HistoryAction, type MarkPaidRequest, type StatusResponse,
} from '@jep/shared';
import { assertAdmin, type Actor } from '../actor';
import { assertCan } from '../claimAccess';
import type { Deps } from '../deps';
import { fail } from '../errors';
import { claimRef } from '../firestore';
import { startPdf } from './pdfTrigger';
import { syncClaimToSheet } from './sheetSync';

/** Runs `mutate` on the current claim inside a transaction, then mirrors the claim to the Sheet. */
async function transition(
  deps: Deps,
  claimId: unknown,
  mutate: (cur: ClaimDoc, now: Timestamp) => Record<string, unknown>,
): Promise<void> {
  if (!isValidClaimId(claimId)) throw fail.invalid('Invalid claimId');
  const ref = claimRef(deps.db, claimId);
  const now = Timestamp.fromDate(deps.now());
  await deps.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw fail.notFound('Claim not found');
    tx.update(ref, { ...mutate(snap.data() as ClaimDoc, now), updatedAt: now });
  });
  await syncClaimToSheet(deps, claimId);
}

const history = (cur: ClaimDoc, actor: Actor, action: HistoryAction, at: Timestamp, note: string | null = null) => [
  ...cur.history,
  { action, byUid: actor.uid, byName: actor.name, at, note },
];

export async function cancelClaim(deps: Deps, actor: Actor, req: ClaimIdRequest): Promise<StatusResponse> {
  await transition(deps, req?.claimId, (cur, now) => {
    assertCan('cancel', cur, actor);
    return { status: 'cancelled', history: history(cur, actor, 'cancel', now) };
  });
  return { status: 'cancelled' };
}

export async function markPaid(deps: Deps, actor: Actor, req: MarkPaidRequest): Promise<StatusResponse> {
  assertAdmin(actor);
  if (typeof req?.paidDate !== 'string' || !isValidYmd(req.paidDate)) throw fail.invalid('paidDate must be yyyy-MM-dd');
  const reference = typeof req.reference === 'string' ? req.reference.trim() : '';
  if (reference.length > 100) throw fail.invalid('Payment reference is too long');
  await transition(deps, req.claimId, (cur, now) => {
    assertCan('mark_paid', cur, actor);
    return {
      status: 'paid',
      paidInfo: { byUid: actor.uid, byName: actor.name, at: now, paidDate: req.paidDate, reference },
      history: history(cur, actor, 'mark_paid', now, `${req.paidDate} ${reference}`.trim()),
    };
  });
  return { status: 'paid' };
}

export async function regeneratePdf(deps: Deps, actor: Actor, req: ClaimIdRequest): Promise<{ ok: true }> {
  const requestId = deps.newId();
  await transition(deps, req?.claimId, (cur, now) => {
    assertCan('regenerate_pdf', cur, actor);
    if (cur.pdf.status !== 'failed') throw fail.statusChanged();
    return {
      pdf: { ...cur.pdf, status: 'generating', requestId, error: null },
      history: history(cur, actor, 'pdf_regenerate', now),
    };
  });
  await startPdf(deps, req.claimId, requestId);
  return { ok: true };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:int && npm run typecheck`
Expected: PASS, including the Task 10 tests.

- [ ] **Step 6: Commit**

```bash
git add netlify
git commit -m "feat(netlify): add approve/reject numbering, cancel, mark paid and PDF regenerate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: PDF generation service (draft/final, supersede-safe)

**Files:**
- Create: `netlify/lib/services/generatePdf.ts`
- Test: `netlify/test/int/generatePdf.int.test.ts`

**Interfaces:**
- Consumes: `buildClaimPdf`, `toPdfInput` (Task 7); `markPdfFailed` (Task 10); `syncClaimToSheet` (Task 9); `reviewClaim` (Task 11, tests only); `claimPdfFileName`, `refNoYear` (shared)
- Produces: `generatePdf(deps: Deps, claimId: string, requestId: string): Promise<'done' | 'superseded' | 'failed'>`

Behaviour: the function does nothing if `pdf.requestId` no longer matches. Otherwise it follows these steps:
1. Download the attachments, build the PDF, and upload it to `{root}/{refNoYear}/`.
2. In a transaction, re-check `requestId`. If it no longer matches, trash the fresh upload and return `superseded`.
3. Otherwise set `pdf = { status: 'ready', driveFileId, fileName, error: null, requestId }` and trash the previous `pdf.driveFileId`, which is the old draft.
4. Mirror the claim to the Sheet.

If any step before the transaction throws, trash the upload if there was one, and mark the PDF failed.

- [ ] **Step 1: Write the failing tests**

`netlify/test/int/generatePdf.int.test.ts`:
```ts
import { PDFDocument } from 'pdf-lib';
import { beforeEach, describe, expect, it } from 'vitest';
import { getClaim } from '../../lib/firestore';
import { generatePdf } from '../../lib/services/generatePdf';
import { reviewClaim } from '../../lib/services/reviewClaim';
import { jpgFile, makeTestDeps, pdfBytes, resetEmulators, seedActor, seedCounter, submitNewClaim } from './helpers';

beforeEach(resetEmulators);

async function setup() {
  const t = makeTestDeps();
  await seedCounter(t.deps);
  const alice = await seedActor(t.deps, 'alice');
  const boss = await seedActor(t.deps, 'boss', { role: 'admin' });
  return { t, alice, boss };
}

describe('generatePdf', () => {
  it('builds the draft PDF in the year folder and marks it ready', async () => {
    const { t, alice } = await setup();
    const { claimId } = await submitNewClaim(t, alice, {
      files: [jpgFile(), { name: 'inv.pdf', mimeType: 'application/pdf', data: await pdfBytes(2) }],
    });
    expect(await generatePdf(t.deps, claimId, t.triggered[0]!.requestId)).toBe('done');

    const c = (await getClaim(t.deps.db, claimId))!;
    expect(c.pdf.status).toBe('ready');
    expect(c.pdf.fileName).toBe('PR-JEP-202609-draft-Tan Ah Kow-150.00.pdf');
    const file = t.drive.files.get(c.pdf.driveFileId!)!;
    expect(file.name).toBe(c.pdf.fileName);
    expect(t.drive.folderPath(file.parents[0]!)).toBe('JEP Claims/2026');
    expect((await PDFDocument.load(file.data)).getPageCount()).toBe(4);
    expect(String(t.sheets.rows.get(claimId)?.[16])).toContain(c.pdf.driveFileId!);
  });

  it('replaces the draft with the numbered final PDF after approval', async () => {
    const { t, alice, boss } = await setup();
    const { claimId } = await submitNewClaim(t, alice);
    await generatePdf(t.deps, claimId, t.triggered[0]!.requestId);
    const draftId = (await getClaim(t.deps.db, claimId))!.pdf.driveFileId!;

    await reviewClaim(t.deps, boss, { claimId, decision: 'approve' });
    expect(await generatePdf(t.deps, claimId, t.triggered[1]!.requestId)).toBe('done');

    const c = (await getClaim(t.deps.db, claimId))!;
    expect(c.pdf.fileName).toBe('PR-JEP-202609-001-Tan Ah Kow-150.00.pdf');
    expect(t.drive.files.get(draftId)!.trashed).toBe(true);
    expect(t.drive.livePdfs().map((f) => f.name)).toEqual(['PR-JEP-202609-001-Tan Ah Kow-150.00.pdf']);
  });

  it('skips stale requests before doing any work', async () => {
    const { t, alice, boss } = await setup();
    const { claimId } = await submitNewClaim(t, alice);
    await reviewClaim(t.deps, boss, { claimId, decision: 'approve' });
    expect(await generatePdf(t.deps, claimId, t.triggered[0]!.requestId)).toBe('superseded');
    expect(t.drive.livePdfs()).toHaveLength(0);
  });

  it('trashes its upload when superseded mid-flight', async () => {
    const { t, alice, boss } = await setup();
    const { claimId } = await submitNewClaim(t, alice);
    const original = t.drive.upload.bind(t.drive);
    let uploadedId = '';
    t.drive.upload = async (p) => {
      const r = await original(p);
      uploadedId = r.id;
      await reviewClaim(t.deps, boss, { claimId, decision: 'approve' });
      return r;
    };
    expect(await generatePdf(t.deps, claimId, t.triggered[0]!.requestId)).toBe('superseded');
    expect(t.drive.files.get(uploadedId)!.trashed).toBe(true);
    const c = (await getClaim(t.deps.db, claimId))!;
    expect(c.pdf.status).toBe('generating');
    expect(c.pdf.requestId).toBe(t.triggered[1]!.requestId);
  });

  it('marks the PDF failed when an attachment is corrupt', async () => {
    const { t, alice } = await setup();
    const { claimId } = await submitNewClaim(t, alice, {
      files: [{ name: 'bad.pdf', mimeType: 'application/pdf', data: new TextEncoder().encode('not a pdf') }],
    });
    expect(await generatePdf(t.deps, claimId, t.triggered[0]!.requestId)).toBe('failed');
    const c = (await getClaim(t.deps.db, claimId))!;
    expect(c.pdf.status).toBe('failed');
    expect(c.pdf.error).toBeTruthy();
    expect(t.drive.livePdfs()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:int`
Expected: FAIL, because `../../lib/services/generatePdf` is not found.

- [ ] **Step 3: Implement**

`netlify/lib/services/generatePdf.ts`:
```ts
import { Timestamp } from 'firebase-admin/firestore';
import { claimPdfFileName, refNoYear, type ClaimDoc } from '@jep/shared';
import type { Deps } from '../deps';
import { errorMessage } from '../errors';
import { claimRef, getClaim } from '../firestore';
import { buildClaimPdf, toPdfInput, type PdfAttachment } from '../pdf/buildClaimPdf';
import { markPdfFailed } from './pdfTrigger';
import { syncClaimToSheet } from './sheetSync';

export async function generatePdf(
  deps: Deps,
  claimId: string,
  requestId: string,
): Promise<'done' | 'superseded' | 'failed'> {
  const claim = await getClaim(deps.db, claimId);
  if (!claim || claim.pdf.requestId !== requestId) return 'superseded';

  let uploadedId: string | null = null;
  try {
    const assets = await deps.loadPdfAssets();
    const files: PdfAttachment[] = [];
    for (const a of claim.attachments) files.push({ mimeType: a.mimeType, data: await deps.drive.download(a.driveFileId) });
    const bytes = await buildClaimPdf(toPdfInput(claim, deps.now()), files, assets);
    const fileName = claimPdfFileName(claim.refNo, claim.payment.accountHolder, claim.totalCents);
    const yearFolder = await deps.drive.findOrCreateFolder(deps.rootFolderId, refNoYear(claim.refNo));
    uploadedId = (await deps.drive.upload({ name: fileName, mimeType: 'application/pdf', parentId: yearFolder, data: bytes })).id;
    const newId = uploadedId;

    const ref = claimRef(deps.db, claimId);
    const outcome = await deps.db.runTransaction(async (tx) => {
      const cur = (await tx.get(ref)).data() as ClaimDoc | undefined;
      if (!cur || cur.pdf.requestId !== requestId) return { superseded: true as const };
      tx.update(ref, {
        pdf: { status: 'ready', requestId, driveFileId: newId, fileName, error: null },
        updatedAt: Timestamp.fromDate(deps.now()),
      });
      return { superseded: false as const, oldId: cur.pdf.driveFileId };
    });
    uploadedId = null; // committed or about to be trashed below; never trash it in the catch

    if (outcome.superseded) {
      await deps.drive.trash(newId).catch((e) => console.error('[generatePdf] trash superseded failed', newId, e));
      return 'superseded';
    }
    if (outcome.oldId && outcome.oldId !== newId) {
      await deps.drive.trash(outcome.oldId).catch((e) => console.error('[generatePdf] trash old PDF failed', outcome.oldId, e));
    }
    await syncClaimToSheet(deps, claimId);
    return 'done';
  } catch (e) {
    console.error('[generatePdf] failed', claimId, e);
    if (uploadedId) await deps.drive.trash(uploadedId).catch(() => undefined);
    await markPdfFailed(deps, claimId, requestId, errorMessage(e));
    return 'failed';
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:int && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add netlify
git commit -m "feat(netlify): generate and replace claim PDFs safely under concurrency

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: File proxy access, admin user management, Sheet resync

**Files:**
- Create: `netlify/lib/services/fileAccess.ts`, `netlify/lib/services/adminUsers.ts`
- Test: `netlify/test/int/fileAccess.int.test.ts`, `netlify/test/int/adminUsers.int.test.ts`

**Interfaces:**
- Consumes: `canReadClaim`, `assertAdmin`, `getClaim`, `COL`, `resyncSheet` (Task 9)
- Produces:
```ts
export const MAX_PROXY_BYTES = 19 * 1024 * 1024;
export function openClaimFile(deps: Deps, actor: Actor, claimId: string | null, fileId: string | null): Promise<Response>;
export function adminUsers(deps: Deps, actor: Actor, req: AdminUsersRequest): Promise<AdminUsersResponse>;
```

Note: Netlify streamed function responses are capped at about 20MB, so the proxy refuses files larger than 19MB with `FILE_TOO_LARGE`. For those files, the app tells the user to open them in Google Drive.

- [ ] **Step 1: Write the failing tests**

`netlify/test/int/fileAccess.int.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_PROXY_BYTES, openClaimFile } from '../../lib/services/fileAccess';
import { jpgBytes, makeTestDeps, resetEmulators, seedActor, submitNewClaim } from './helpers';

beforeEach(resetEmulators);

describe('openClaimFile', () => {
  it('streams an attachment to its applicant and to admins only', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    const bob = await seedActor(t.deps, 'bob');
    const boss = await seedActor(t.deps, 'boss', { role: 'admin' });
    const { claimId, attachmentIds } = await submitNewClaim(t, alice);
    const fileId = attachmentIds[0]!;

    const res = await openClaimFile(t.deps, alice, claimId, fileId);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(jpgBytes());
    expect((await openClaimFile(t.deps, boss, claimId, fileId)).status).toBe(200);
    await expect(openClaimFile(t.deps, bob, claimId, fileId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses files that are not part of the claim, and files that are too large', async () => {
    const t = makeTestDeps();
    const alice = await seedActor(t.deps, 'alice');
    const a = await submitNewClaim(t, alice);
    const b = await submitNewClaim(t, alice);
    await expect(openClaimFile(t.deps, alice, a.claimId, b.attachmentIds[0]!)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    t.drive.files.get(a.attachmentIds[0]!)!.size = MAX_PROXY_BYTES + 1;
    await expect(openClaimFile(t.deps, alice, a.claimId, a.attachmentIds[0]!)).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    await expect(openClaimFile(t.deps, alice, null, 'x')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});
```

`netlify/test/int/adminUsers.int.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { UserDoc } from '@jep/shared';
import { COL, getClaim } from '../../lib/firestore';
import { adminUsers } from '../../lib/services/adminUsers';
import { resyncSheet } from '../../lib/services/sheetSync';
import { makeTestDeps, resetEmulators, seedActor, submitNewClaim } from './helpers';

beforeEach(resetEmulators);

async function setup() {
  const t = makeTestDeps();
  const boss = await seedActor(t.deps, 'boss', { role: 'admin' });
  const alice = await seedActor(t.deps, 'alice');
  return { t, boss, alice };
}

describe('adminUsers', () => {
  it('invites a Google email (lower-cased) and refuses existing users', async () => {
    const { t, boss } = await setup();
    await adminUsers(t.deps, boss, { action: 'invite', email: ' New@Gmail.com ', role: 'member' });
    expect((await t.deps.db.collection(COL.invites).doc('new@gmail.com').get()).data()).toMatchObject({ role: 'member', invitedByUid: 'boss' });
    await expect(adminUsers(t.deps, boss, { action: 'invite', email: 'alice@example.com', role: 'member' })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await adminUsers(t.deps, boss, { action: 'deleteInvite', email: 'new@gmail.com' });
    expect((await t.deps.db.collection(COL.invites).doc('new@gmail.com').get()).exists).toBe(false);
  });

  it('creates email/password accounts', async () => {
    const { t, boss } = await setup();
    const res = await adminUsers(t.deps, boss, {
      action: 'createPasswordUser', email: 'lee@example.com', password: 'secret123', name: 'Lee Mei Ling', role: 'member',
    });
    expect(res.ok).toBe(true);
    const user = (await t.deps.db.collection(COL.users).doc(res.uid!).get()).data() as UserDoc;
    expect(user).toMatchObject({ email: 'lee@example.com', name: 'Lee Mei Ling', role: 'member', active: true, authProvider: 'password' });
    expect((await t.deps.auth.getUser(res.uid!)).email).toBe('lee@example.com');
    await expect(
      adminUsers(t.deps, boss, { action: 'createPasswordUser', email: 'lee@example.com', password: 'secret123', name: 'X', role: 'member' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      adminUsers(t.deps, boss, { action: 'createPasswordUser', email: 'b@example.com', password: 'short', name: 'X', role: 'member' }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('changes roles and deactivates accounts, but never your own', async () => {
    const { t, boss } = await setup();
    const { uid } = await adminUsers(t.deps, boss, {
      action: 'createPasswordUser', email: 'lee@example.com', password: 'secret123', name: 'Lee', role: 'member',
    });
    await adminUsers(t.deps, boss, { action: 'setRole', uid: uid!, role: 'admin' });
    expect(((await t.deps.db.collection(COL.users).doc(uid!).get()).data() as UserDoc).role).toBe('admin');
    await adminUsers(t.deps, boss, { action: 'setActive', uid: uid!, active: false });
    expect(((await t.deps.db.collection(COL.users).doc(uid!).get()).data() as UserDoc).active).toBe(false);
    expect((await t.deps.auth.getUser(uid!)).disabled).toBe(true);
    await expect(adminUsers(t.deps, boss, { action: 'setRole', uid: 'boss', role: 'member' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(adminUsers(t.deps, boss, { action: 'setActive', uid: 'boss', active: false })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(adminUsers(t.deps, boss, { action: 'setRole', uid: 'ghost', role: 'admin' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('is admin-only', async () => {
    const { t, alice } = await setup();
    await expect(adminUsers(t.deps, alice, { action: 'invite', email: 'x@y.com', role: 'admin' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('resyncSheet', () => {
  it('pushes claims whose Sheet sync failed', async () => {
    const { t, boss, alice } = await setup();
    t.sheets.failing = true;
    const { claimId } = await submitNewClaim(t, alice);
    t.sheets.failing = false;
    expect(await resyncSheet(t.deps, boss)).toEqual({ synced: 1, failed: 0 });
    expect((await getClaim(t.deps.db, claimId))!.sheetSynced).toBe(true);
    expect(t.sheets.rows.has(claimId)).toBe(true);
    await expect(resyncSheet(t.deps, alice)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:int`
Expected: FAIL, because the services are not found.

- [ ] **Step 3: Implement**

`netlify/lib/services/fileAccess.ts`:
```ts
import { isValidClaimId } from '@jep/shared';
import type { Actor } from '../actor';
import { canReadClaim } from '../claimAccess';
import type { Deps } from '../deps';
import { fail } from '../errors';
import { getClaim } from '../firestore';

export const MAX_PROXY_BYTES = 19 * 1024 * 1024;

export async function openClaimFile(
  deps: Deps,
  actor: Actor,
  claimId: string | null,
  fileId: string | null,
): Promise<Response> {
  if (!isValidClaimId(claimId) || !fileId) throw fail.invalid('claimId and fileId are required');
  const claim = await getClaim(deps.db, claimId);
  if (!claim) throw fail.notFound('Claim not found');
  if (!canReadClaim(claim, actor)) throw fail.forbidden();
  const belongs = claim.attachments.some((a) => a.driveFileId === fileId) || claim.pdf.driveFileId === fileId;
  if (!belongs) throw fail.notFound('File not found');
  const meta = await deps.drive.getFile(fileId);
  if (!meta || meta.trashed) throw fail.notFound('File not found');
  if (meta.size > MAX_PROXY_BYTES) {
    throw fail.tooLarge('This file is too large to open in the app. Please open it in Google Drive.');
  }
  const upstream = await deps.drive.downloadResponse(fileId);
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': meta.mimeType,
      'Content-Length': String(meta.size),
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
      'Cache-Control': 'private, max-age=300',
    },
  });
}
```

`netlify/lib/services/adminUsers.ts`:
```ts
import { Timestamp } from 'firebase-admin/firestore';
import type { AdminUsersRequest, AdminUsersResponse, Role, UserDoc } from '@jep/shared';
import { assertAdmin, type Actor } from '../actor';
import type { Deps } from '../deps';
import { fail } from '../errors';
import { COL, userRef } from '../firestore';

const isRole = (r: unknown): r is Role => r === 'member' || r === 'admin';

function normEmail(e: unknown): string {
  const email = typeof e === 'string' ? e.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail.invalid('A valid email is required');
  return email;
}

async function assertNoUserWithEmail(deps: Deps, email: string) {
  const existing = await deps.db.collection(COL.users).where('email', '==', email).limit(1).get();
  if (!existing.empty) throw fail.invalid('A user with this email already exists');
}

async function assertOtherExistingUser(deps: Deps, actor: Actor, uid: unknown): Promise<string> {
  if (typeof uid !== 'string' || !uid) throw fail.invalid('uid is required');
  if (uid === actor.uid) throw fail.forbidden('You cannot change your own account here');
  if (!(await userRef(deps.db, uid).get()).exists) throw fail.notFound('User not found');
  return uid;
}

export async function adminUsers(deps: Deps, actor: Actor, req: AdminUsersRequest): Promise<AdminUsersResponse> {
  assertAdmin(actor);
  const now = Timestamp.fromDate(deps.now());

  switch (req?.action) {
    case 'invite': {
      const email = normEmail(req.email);
      if (!isRole(req.role)) throw fail.invalid('Invalid role');
      await assertNoUserWithEmail(deps, email);
      await deps.db.collection(COL.invites).doc(email).set({ role: req.role, invitedByUid: actor.uid, invitedAt: now });
      return { ok: true };
    }
    case 'deleteInvite': {
      await deps.db.collection(COL.invites).doc(normEmail(req.email)).delete();
      return { ok: true };
    }
    case 'createPasswordUser': {
      const email = normEmail(req.email);
      const name = typeof req.name === 'string' ? req.name.trim() : '';
      if (!name || name.length > 100) throw fail.invalid('Name is required');
      if (typeof req.password !== 'string' || req.password.length < 8) {
        throw fail.invalid('Password must be at least 8 characters');
      }
      if (!isRole(req.role)) throw fail.invalid('Invalid role');
      await assertNoUserWithEmail(deps, email);
      let uid: string;
      try {
        uid = (await deps.auth.createUser({ email, password: req.password, displayName: name })).uid;
      } catch (e) {
        if ((e as { code?: string }).code === 'auth/email-already-exists') {
          throw fail.invalid('This email is already registered');
        }
        throw e;
      }
      const doc: UserDoc = {
        email, name, position: '', role: req.role, active: true, bank: null, authProvider: 'password', createdAt: now, updatedAt: now,
      };
      await userRef(deps.db, uid).set(doc);
      await deps.db.collection(COL.invites).doc(email).delete();
      return { ok: true, uid };
    }
    case 'setRole': {
      if (!isRole(req.role)) throw fail.invalid('Invalid role');
      const uid = await assertOtherExistingUser(deps, actor, req.uid);
      await userRef(deps.db, uid).update({ role: req.role, updatedAt: now });
      return { ok: true };
    }
    case 'setActive': {
      if (typeof req.active !== 'boolean') throw fail.invalid('active must be true or false');
      const uid = await assertOtherExistingUser(deps, actor, req.uid);
      await userRef(deps.db, uid).update({ active: req.active, updatedAt: now });
      await deps.auth.updateUser(uid, { disabled: !req.active });
      return { ok: true };
    }
    default:
      throw fail.invalid('Unknown action');
  }
}
```

The `setActive` test uses `createPasswordUser`, so the Auth user exists. For users who only have a Firestore doc (the seeded ones), `auth.updateUser` throws `auth/user-not-found`. That case does not occur in production, because every user doc belongs to an Auth user.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:int && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add netlify
git commit -m "feat(netlify): add authorised file proxy, admin user management and sheet resync

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Netlify function endpoints and site config

**Files:**
- Create: `netlify.toml`, `netlify/public/index.html`
- Create: `netlify/functions/session.mts`, `drive-upload-session.mts`, `submit-claim.mts`, `review-claim.mts`, `cancel-claim.mts`, `mark-paid.mts`, `regenerate-pdf.mts`, `file-proxy.mts`, `admin-users.mts`, `resync-sheet.mts`, `generate-pdf-background.mts`, `health.mts`
- Create: `netlify/.env.example`

**Interfaces:**
- Consumes: every service from Tasks 9–13, plus `handle`, `readJson`, `getDeps`, `requireActor`, `verifyRequest`
- Produces: HTTP endpoints at `/.netlify/functions/<API name>`. Every endpoint except `health`, `file-proxy`, and `generate-pdf-background` is `POST` with a JSON body and requires `Authorization: Bearer <Firebase ID token>`. `file-proxy` is `GET ?claimId=&fileId=` with the same header. `health` is `GET` without auth.

- [ ] **Step 1: Create the site config**

`netlify.toml` (repo root):
```toml
[build]
  command = "echo 'Functions-only site'"
  publish = "netlify/public"

[build.environment]
  NODE_VERSION = "22"
  NPM_FLAGS = "--workspace=@jep/netlify --workspace=@jep/shared --include-workspace-root"

[functions]
  directory = "netlify/functions"
  node_bundler = "esbuild"
  external_node_modules = ["subset-font", "harfbuzzjs", "firebase-admin"]
  included_files = ["netlify/assets/**"]
```

`netlify/public/index.html`:
```html
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>JEP Claims API</title></head>
<body><p>JEP Ventures Claim System API. Nothing to see here.</p></body></html>
```

`netlify/.env.example`:
```
FIREBASE_PROJECT_ID=jepventuresaccount
GOOGLE_SA_EMAIL=firebase-adminsdk-xxxxx@jepventuresaccount.iam.gserviceaccount.com
GOOGLE_SA_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_SHARED_DRIVE_ID=0ABnERw4RUzYbUk9PVA
GOOGLE_ROOT_FOLDER_ID=
GOOGLE_SHEET_ID=
INTERNAL_FUNCTION_SECRET=
FUNCTIONS_BASE_URL=
# smoke test only
FIREBASE_WEB_API_KEY=
SMOKE_BASE_URL=
```

- [ ] **Step 2: Create the function wrappers**

`netlify/functions/session.mts`:
```ts
import { verifyRequest } from '../lib/actor';
import { getDeps } from '../lib/deps';
import { handle } from '../lib/http';
import { ensureSession } from '../lib/services/session';

export default handle(async (req) => {
  const deps = getDeps();
  const t = await verifyRequest(deps, req);
  return ensureSession(deps, {
    uid: t.uid,
    email: t.email,
    emailVerified: t.email_verified ?? false,
    name: typeof t.name === 'string' ? t.name : undefined,
    provider: t.firebase.sign_in_provider,
  });
});
```

`netlify/functions/drive-upload-session.mts`:
```ts
import type { UploadSessionRequest } from '@jep/shared';
import { requireActor } from '../lib/actor';
import { getDeps } from '../lib/deps';
import { handle, readJson } from '../lib/http';
import { createUploadSessions } from '../lib/services/uploadSession';

export default handle(async (req) => {
  const deps = getDeps();
  const actor = await requireActor(deps, req);
  return createUploadSessions(deps, actor, await readJson<UploadSessionRequest>(req));
});
```

`netlify/functions/submit-claim.mts`:
```ts
import type { SubmitClaimRequest } from '@jep/shared';
import { requireActor } from '../lib/actor';
import { getDeps } from '../lib/deps';
import { handle, readJson } from '../lib/http';
import { submitClaim } from '../lib/services/submitClaim';

export default handle(async (req) => {
  const deps = getDeps();
  const actor = await requireActor(deps, req);
  return submitClaim(deps, actor, await readJson<SubmitClaimRequest>(req));
});
```

`netlify/functions/review-claim.mts`:
```ts
import type { ReviewClaimRequest } from '@jep/shared';
import { requireActor } from '../lib/actor';
import { getDeps } from '../lib/deps';
import { handle, readJson } from '../lib/http';
import { reviewClaim } from '../lib/services/reviewClaim';

export default handle(async (req) => {
  const deps = getDeps();
  const actor = await requireActor(deps, req);
  return reviewClaim(deps, actor, await readJson<ReviewClaimRequest>(req));
});
```

`netlify/functions/cancel-claim.mts`:
```ts
import type { ClaimIdRequest } from '@jep/shared';
import { requireActor } from '../lib/actor';
import { getDeps } from '../lib/deps';
import { handle, readJson } from '../lib/http';
import { cancelClaim } from '../lib/services/claimActions';

export default handle(async (req) => {
  const deps = getDeps();
  const actor = await requireActor(deps, req);
  return cancelClaim(deps, actor, await readJson<ClaimIdRequest>(req));
});
```

`netlify/functions/mark-paid.mts`:
```ts
import type { MarkPaidRequest } from '@jep/shared';
import { requireActor } from '../lib/actor';
import { getDeps } from '../lib/deps';
import { handle, readJson } from '../lib/http';
import { markPaid } from '../lib/services/claimActions';

export default handle(async (req) => {
  const deps = getDeps();
  const actor = await requireActor(deps, req);
  return markPaid(deps, actor, await readJson<MarkPaidRequest>(req));
});
```

`netlify/functions/regenerate-pdf.mts`:
```ts
import type { ClaimIdRequest } from '@jep/shared';
import { requireActor } from '../lib/actor';
import { getDeps } from '../lib/deps';
import { handle, readJson } from '../lib/http';
import { regeneratePdf } from '../lib/services/claimActions';

export default handle(async (req) => {
  const deps = getDeps();
  const actor = await requireActor(deps, req);
  return regeneratePdf(deps, actor, await readJson<ClaimIdRequest>(req));
});
```

`netlify/functions/file-proxy.mts`:
```ts
import { requireActor } from '../lib/actor';
import { getDeps } from '../lib/deps';
import { handle } from '../lib/http';
import { openClaimFile } from '../lib/services/fileAccess';

export default handle(
  async (req) => {
    const deps = getDeps();
    const actor = await requireActor(deps, req);
    const url = new URL(req.url);
    return openClaimFile(deps, actor, url.searchParams.get('claimId'), url.searchParams.get('fileId'));
  },
  { method: 'GET' },
);
```

`netlify/functions/admin-users.mts`:
```ts
import type { AdminUsersRequest } from '@jep/shared';
import { requireActor } from '../lib/actor';
import { getDeps } from '../lib/deps';
import { handle, readJson } from '../lib/http';
import { adminUsers } from '../lib/services/adminUsers';

export default handle(async (req) => {
  const deps = getDeps();
  const actor = await requireActor(deps, req);
  return adminUsers(deps, actor, await readJson<AdminUsersRequest>(req));
});
```

`netlify/functions/resync-sheet.mts`:
```ts
import { requireActor } from '../lib/actor';
import { getDeps } from '../lib/deps';
import { handle } from '../lib/http';
import { resyncSheet } from '../lib/services/sheetSync';

export default handle(async (req) => {
  const deps = getDeps();
  return resyncSheet(deps, await requireActor(deps, req));
});
```

`netlify/functions/generate-pdf-background.mts`:
```ts
import { getDeps } from '../lib/deps';
import { generatePdf } from '../lib/services/generatePdf';

// "-background" suffix: Netlify replies 202 immediately and runs this for up to 15 minutes.
export default async (req: Request): Promise<void> => {
  const secret = process.env.INTERNAL_FUNCTION_SECRET;
  if (req.method !== 'POST' || !secret || req.headers.get('x-internal-secret') !== secret) {
    console.warn('[generate-pdf-background] rejected request');
    return;
  }
  const { claimId, requestId } = (await req.json()) as { claimId?: string; requestId?: string };
  if (!claimId || !requestId) return;
  const result = await generatePdf(getDeps(), claimId, requestId);
  console.log('[generate-pdf-background]', claimId, requestId, result);
};
```

`netlify/functions/health.mts`:
```ts
import { FONT_REL, LOGO_REL, resolveAsset } from '../lib/assets';
import { handle } from '../lib/http';

export default handle(
  async () => ({ ok: true, assets: { font: !!resolveAsset(FONT_REL), logo: !!resolveAsset(LOGO_REL) } }),
  { method: 'GET' },
);
```

- [ ] **Step 3: Typecheck and run all tests**

Run: `npm run typecheck && npm test && npm run test:int`
Expected: all PASS.

- [ ] **Step 4: Verify the functions bundle**

Run: `npx netlify-cli@27 build --offline`
Expected: the build succeeds and lists the 12 functions as bundled. If the CLI insists on linking a site first, skip this step, because bundling is verified by the deploy in Task 15.

- [ ] **Step 5: Commit**

```bash
git add netlify.toml netlify
git commit -m "feat(netlify): expose claim services as Netlify function endpoints

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Cloud setup, deploy, and end-to-end smoke test

**Files:**
- Create: `netlify/scripts/setup.mts`, `netlify/scripts/smoke.mts`, `docs/backend-setup.md`

**Interfaces:**
- Consumes: `DriveClient`, `SheetsClient`, `SHEET_HEADERS`, `getAdminApp`, `createTokenProvider`, `COL`, `CLAIM_SEQ_DOC`, `toArrayBuffer`
- Produces: a live Netlify site, plus `GOOGLE_ROOT_FOLDER_ID` and `GOOGLE_SHEET_ID` values.

Steps marked **USER ACTION** need the user's browser and accounts. Stop at each one, ask the user to do it, and wait for confirmation. Never ask for, or handle, the private key contents in chat. The user saves the key file locally and edits `netlify/.env` themselves.

- [ ] **Step 1: Write the setup guide**

`docs/backend-setup.md`:
```markdown
# Backend setup (one time)

1. Firebase Console → project **jepventuresaccount**
   - Build → Firestore Database → Create database (Production mode, region `asia-southeast1`).
   - Build → Authentication → Sign-in method → enable **Google** and **Email/Password**.
   - Project settings → Service accounts → **Generate new private key**. Keep the JSON file private.
2. Google Cloud Console (same project) → APIs & Services → enable **Google Drive API** and **Google Sheets API**.
3. Google Drive → Shared Drive `0ABnERw4RUzYbUk9PVA` → Manage members → add the service account's
   `client_email` (from the JSON) as **Content manager**.
4. Create `netlify/.env` from `netlify/.env.example`:
   - `GOOGLE_SA_EMAIL` = `client_email`, `GOOGLE_SA_PRIVATE_KEY` = `private_key` (keep the `\n` escapes, wrap in double quotes)
   - `INTERNAL_FUNCTION_SECRET` = output of `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
5. `npm run setup -w @jep/netlify` → copy the printed `GOOGLE_ROOT_FOLDER_ID` and `GOOGLE_SHEET_ID` into `netlify/.env`.
6. `npx firebase deploy --only firestore:rules,firestore:indexes --project jepventuresaccount`
7. Netlify → Add new site → Import from GitHub `infojepventures/jepventursaccount` (base directory empty,
   build settings come from `netlify.toml`). Site configuration → Environment variables → add every
   variable from `netlify/.env` except the smoke-test ones.
8. After the first deploy: open `https://<site>.netlify.app/.netlify/functions/health` → `{"ok":true,"assets":{"font":true,"logo":true}}`.
9. Smoke test (before real users): set `SMOKE_BASE_URL=https://<site>.netlify.app` and
   `FIREBASE_WEB_API_KEY` (the `current_key` in `google-services.json`) in `netlify/.env`, then
   `npm run smoke -w @jep/netlify`. It cleans up after itself and restores the claim counter.
```

- [ ] **Step 2: Write the setup script**

`netlify/scripts/setup.mts`:
```ts
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
```

- [ ] **Step 3: Write the smoke script**

`netlify/scripts/smoke.mts`:
```ts
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

try {
  step('session');
  await call('session', {});

  step('upload attachments (jpg + 7MB pdf) directly to Drive');
  const files = [
    { name: 'receipt.jpg', mimeType: 'image/jpeg', data: new Uint8Array(readFileSync('test/fixtures/receipt.jpg')) },
    { name: 'big.pdf', mimeType: 'application/pdf', data: await bigPdf() },
  ];
  const sess = await call<{ uploads: { uploadUrl: string }[] }>('drive-upload-session', {
    claimId, files: files.map((f) => ({ name: f.name, mimeType: f.mimeType, size: f.data.length })),
  });
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
  if (c?.attachmentsFolderId) await drive.trash(c.attachmentsFolderId).catch(() => undefined);
  await sheets.deleteClaimRow(claimId).catch(() => undefined);
  await db.collection(COL.claims).doc(claimId).delete();
  const after = (await counterRef.get()).data()?.next as number;
  if (after === counterBefore + 1) await counterRef.update({ next: counterBefore });
  else if (after !== counterBefore) console.warn(`⚠ counter moved from ${counterBefore} to ${after}; not restoring`);
  await db.collection(COL.users).doc(UID).delete();
  await auth.deleteUser(UID).catch(() => undefined);
}
```

- [ ] **Step 4: Typecheck and commit**

Run: `npm run typecheck`
Expected: PASS.

```bash
git add docs/backend-setup.md netlify/scripts
git commit -m "feat(netlify): add setup and end-to-end smoke scripts with setup guide

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: USER ACTION — cloud prerequisites**

Ask the user to complete items 1–4 of `docs/backend-setup.md` (Firestore, Auth providers, service account key, the Drive and Sheets APIs, Shared Drive membership, and `netlify/.env`). Wait for confirmation.

- [ ] **Step 6: Run setup and deploy the rules**

```bash
npm run setup -w @jep/netlify
npx firebase deploy --only firestore:rules,firestore:indexes --project jepventuresaccount
```
Expected: the setup prints the root folder and Sheet IDs plus 2 admin invites, and the rules and indexes deploy successfully. Ask the user to paste the two IDs into `netlify/.env`. They are not secrets, so the agent may also write them.

- [ ] **Step 7: USER ACTION — Netlify site**

Ask the user to push to GitHub (`git push -u origin main`, only once they approve), then do items 7–8 of the guide and share the site URL. Wait until `health` returns `font: true, logo: true`.

- [ ] **Step 8: Run the smoke test**

```bash
npm run smoke -w @jep/netlify
```
Expected: every `→` step prints, followed by `✅ Smoke test passed`. If the file-proxy step fails for the 7MB file with a size or timeout error, the Netlify response streaming limit is lower than expected. In that case, lower `MAX_PROXY_BYTES` in `netlify/lib/services/fileAccess.ts` to `5 * 1024 * 1024` and re-deploy. The app already handles `FILE_TOO_LARGE` by pointing to Drive.

- [ ] **Step 9: Final commit (if any fixes were needed)**

```bash
git add -A
git commit -m "fix(netlify): adjustments from live smoke test

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Plan 2 (Expo app) — next

This plan delivers a fully tested, deployed backend. Plan 2, `docs/superpowers/plans/2026-09-26-claim-app.md`, builds the Expo Android app on top of the `@jep/shared` API contract: auth, profile, new claim with upload, claim list and detail, the admin review, payment, and users screens, and EAS build.
