# JEP Ventures Claim System — Design

Date: 2026-09-25
Status: Approved (brainstorming)

## 1. Purpose

Company expense reimbursement for JEP VENTURES SDN BHD. Members submit claims (line items + receipts) from a mobile app; admins approve, reject, and mark claims paid in the same app. Each claim produces a merged PDF ("Payment Request") stored in Google Drive. Claim data is stored in Firestore and mirrored to a Google Sheet for easy checking.

## 2. Decisions Summary

| Topic | Decision |
|---|---|
| Users | Members submit; admins review. Same app, role-based screens. |
| Platform | React Native with Expo. Android first; code keeps iOS possible (no platform-specific native code without an iOS path). |
| Backend | Netlify Functions on a dedicated Functions-only Netlify site (same pattern as JCI KL `netlify/functions/upload-to-drive.mjs`). Background Functions are available on the account. |
| Database | Firestore (source of truth). Google Sheet is a read-only mirror written by the backend. |
| Files | Google Workspace Shared Drive `0ABnERw4RUzYbUk9PVA`, accessed by a service account (Content Manager). |
| Auth | Firebase Auth: Google Sign-In (any domain, Gmail included) + email/password. Invite-only: no self-registration. |
| PDF | Generated server-side with `pdf-lib` in a Background Function. Page 1 = payment request form; following pages = all receipts merged. |
| Firebase project | `jepventuresaccount`, Android package `com.jepventures.account` (`google-services.json` provided). |

## 3. Architecture

```
Expo App (Android)
  - Firebase JS SDK: Auth + Firestore READS and realtime listeners only
  - Direct PUT of attachments to Drive resumable upload URLs
  - Calls Netlify Functions with Firebase ID token (Authorization: Bearer)
        |
Netlify site (Functions only)
  drive-upload-session      create _attachments/{claimId}/ + resumable URLs
  submit-claim              create or resubmit a claim
  generate-pdf-background   build + upload merged PDF (Background Function)
  review-claim              approve (assign number) / reject
  cancel-claim              applicant withdraws a submitted claim
  mark-paid                 admin records payment
  file-proxy                stream a Drive file after permission check
  admin-users               invite, create email account, set role, deactivate
  resync-sheet              push all sheetSynced=false claims to the Sheet
  regenerate-pdf            re-trigger PDF generation when pdf.status=failed
        |
Firebase Admin SDK -> Firestore/Auth      Google APIs -> Drive, Sheets
```

Principles:
- All claim writes go through Functions. The app cannot write to `claims` or `counters`.
- Exception: a user may directly update their own `name`, `position`, `bank` in `users/{uid}` (enforced by security rules).
- Every Function write to a claim is followed by an upsert of that claim's Sheet row. On Sheet failure the claim gets `sheetSynced: false`; admins can run `resync-sheet`.

Repository layout (single repo, `https://github.com/infojepventures/jepventursaccount.git`):

```
app/        Expo app
netlify/    Netlify site: functions/, lib/ (drive, sheets, pdf, auth, claims), netlify.toml
shared/     shared TypeScript types, status rules, filename/refNo/money helpers
scripts/    one-off setup scripts (root folder, sheet header, counter, first admin)
assets/brand/ logo-black.png (PDF), logo-white.png (dark backgrounds)
docs/
```

## 4. Claim Lifecycle

States: `submitted`, `approved`, `paid`, `rejected`, `cancelled`.

| From | Action | Who | To |
|---|---|---|---|
| (new) | submit | member | submitted |
| submitted | cancel | applicant | cancelled |
| submitted | approve | admin | approved |
| submitted | reject (reason required) | admin | rejected |
| rejected | edit + resubmit | applicant | submitted |
| approved | mark paid (paid date, reference) | admin | paid |

`cancelled` and `paid` are terminal. `rejected` stays until the applicant resubmits. These rules live in `shared/` and both the app (to show buttons) and Functions (to enforce) use them.

## 5. Numbering and File Names

- Draft ref (on submit): `PR-JEP-{yyyyMM}-draft`, where yyyyMM is the submission month.
- Final ref (on approve): `PR-JEP-{yyyyMM}-{NNN}`, where yyyyMM is the approval month and NNN is a global running number. It never resets, never repeats, and is not consumed by rejected or cancelled claims. It is zero-padded to 3 digits and grows past 999 naturally.
- The number is assigned in a Firestore transaction on `counters/claimSeq { next }` that also checks the claim is still `submitted`.
- PDF file name: `{refNo}-{accountHolder}-{total}.pdf`, for example `PR-JEP-202609-draft-Tan Ah Kow-150.00.pdf` and `PR-JEP-202610-006-Tan Ah Kow-150.00.pdf`.
  - `accountHolder` is the claim's payment account holder. Characters `/ \ : * ? " < > |` are removed and whitespace is collapsed.
  - `total` always has 2 decimals, with no thousands separator.

## 6. Data Model

### Firestore

`users/{uid}`
- `email`, `name`, `position`
- `role`: `member` | `admin` (Functions only)
- `active`: boolean (Functions only)
- `bank`: `{ bankName, accountHolder, accountNumber }`
- `authProvider`: `google` | `password`
- `createdAt`, `updatedAt`

`invites/{emailLowercase}`: `{ role, invitedBy, invitedAt }`. Google Sign-In is accepted only when the email has an invite or an existing active user. On first valid sign-in, the backend creates `users/{uid}` from the invite. Email/password accounts are created by admins through `admin-users`, which creates the user doc directly.

`claims/{claimId}`
- `refNo`
- `status`
- `applicant`: `{ uid, name, position }` (snapshot at submit)
- `items`: `[{ description, amountCents, reference? }]` (`reference` is an optional per-item document/invoice/receipt number, trimmed, max 60 chars, stored only when non-empty)
- `totalCents` (computed by the server)
- `payment`: `{ bankName, accountHolder, accountNumber }` (snapshot)
- `attachments`: `[{ driveFileId, name, mimeType, size }]`
- `pdf`: `{ status: generating|ready|failed, driveFileId, fileName, error }`
- `review`: `{ by, at, reason }`
- `paidInfo`: `{ by, at, paidDate, reference }`
- `history`: `[{ action, by, at, note }]`
- `submittedAt` (the claim date shown on the PDF; set at first submission, not editable), `resubmittedAt`
- `sheetSynced`, `createdAt`, `updatedAt`

`counters/claimSeq`: `{ next: number }`

All money is stored as integer cents.

### Google Drive (Shared Drive `0ABnERw4RUzYbUk9PVA`)

```
JEP Claims/
  {yyyy}/
    PR-JEP-...pdf                            merged PDFs (draft and final)
    _attachments/{pdf file name w/o .pdf}/   original uploads
  JEP Claims Register                        Google Sheet
```

- The year folder comes from the yyyyMM in the ref. A final PDF approved in January goes to the new year's folder.
- Attachments stay in the submission year's `_attachments/` folder. The folder is created as `_attachments/{claimId}/` at upload-session time (before a PDF exists), then renamed to match the claim's PDF file name (without `.pdf`) each time a new PDF is generated — e.g. `_attachments/PR-JEP-202609-001-YU WAI LOONG-30.00/` after approval. All lookups use the folder's Drive ID, never its name, so the rename is purely cosmetic and best-effort (a failed rename never fails PDF generation).
- On approval the final PDF is uploaded first, then the draft PDF is trashed (it can be recovered from the Shared Drive trash for 30 days).
- On resubmit the new draft PDF is uploaded, then the old draft is trashed. Removed attachments are trashed.
- Files are not shared publicly. Access is Shared Drive membership, or the app through `file-proxy`.

### Google Sheet: one row per claim, located by Claim ID

Columns: `Claim ID | Ref No | Status | Submitted At | Applicant | Position | Items | Total (RM) | Bank | Account Holder | Account Number | Reviewed By | Reviewed At | Reject Reason | Paid Date | Payment Ref | PDF Link | Attachments Folder Link | Updated At`

The `Items` column is formatted as `1. Parking RM10.00; 2. Lunch RM45.50`, or `1. ICS-000024 Parking RM10.00; 2. Lunch RM45.50` when an item has a doc no. reference.

## 7. PDF Layout (A4, modeled on JCI KL `PR-JCIKL-202609-005.pdf`)

Page 1:
1. Letterhead: `logo-black.png`, **JEP VENTURES SDN BHD (1521088-K)**, then the address "D-2-15, Pusat Komersial Jalan Kuching, No. 115, Jalan Kepayang, Off Jalan Kuching, 51200 Kuala Lumpur, W.P. Kuala Lumpur".
2. Title **PAYMENT REQUEST**, then `REF: {refNo}`. The draft shows `PR-JEP-202609-draft` plus a "DRAFT – PENDING APPROVAL" marker.
3. **APPLICANT DETAILS**: Name, Position, Date (`submittedAt`, yyyy-MM-dd).
4. **CLAIM BREAKDOWN**: table with columns No. | Doc No. | Description / Purpose | Amount (RM), and a TOTAL row. Doc No. shows the item's optional reference, or "-" when absent.
5. **PAYMENT METHOD**: Recipient Bank, Account Holder, Account Number.
6. Final version only: Approved by, and approval date.
7. Footer: "Generated by JEP Ventures Claim System on {datetime}" and "This is a computer-generated document and no signature is required."

Following pages: each image attachment is scaled to fit an A4 page, and each PDF attachment's pages are copied in, all in upload order.

Font: Noto Sans SC embedded with subsetting (via `@pdf-lib/fontkit`), so Chinese names and descriptions render.

## 8. Flows

### Submit
1. The app generates `claimId` locally (a Firestore auto-ID, with no write).
2. `drive-upload-session({ claimId, files: [{ name, mimeType, size }] })`:
   - checks the caller is active
   - checks at most 10 files, each at most 10MB, of type jpg, png, or pdf
   - for a resubmit, checks the caller owns the rejected claim
   - creates the folder and returns a resumable upload URL per file
3. The app compresses images before step 2 (JPEG, longest edge 2000px), then PUTs each file straight to Drive and receives `fileId`s. A failed file can be retried on its own.
4. `submit-claim({ claimId, items, payment, attachmentIds, resubmit?, saveBankToProfile? })`:
   - validates items (non-empty description, amount > 0) and computes the total on the server
   - checks every fileId is inside `_attachments/{claimId}/` with the expected size
   - writes the claim (`submitted`, `pdf.status=generating`), appends history, and upserts the Sheet row
   - invokes `generate-pdf-background` with the `INTERNAL_FUNCTION_SECRET` header, then returns
5. `generate-pdf-background`:
   - downloads the attachments, builds the PDF, and uploads it to `{yyyy}/`
   - trashes the previous PDF, if any
   - sets `pdf.status=ready` and upserts the Sheet row
   - on failure sets `pdf.status=failed` with the error
6. The app listens to the claim doc and shows "Generating PDF…" until the status is `ready`.

### Approve / Reject (`review-claim`)
- Approve: a transaction assigns `refNo` and sets `status=approved` plus `review`. It then triggers `generate-pdf-background` for the final PDF. A concurrent second approval fails with `STATUS_CHANGED`.
- Reject: requires a reason, sets `status=rejected` and `review`, and keeps the draft PDF.

### Cancel (`cancel-claim`)
Applicant only, `submitted` only. Files are kept.

### Mark paid (`mark-paid`)
Admin only, `approved` only. Takes `paidDate` and `reference`.

### Regenerate PDF
When `pdf.status=failed`, the applicant or an admin can call `regenerate-pdf`, which re-triggers `generate-pdf-background`.

## 9. App Screens

- **Login**: "Sign in with Google" plus email/password. No sign-up link. An uninvited Google account is signed out with the message "Not authorised, please contact admin". An incomplete profile is sent to the profile setup screen first.
- **Member tabs**:
  - My Claims: list with status filter. The detail view shows items, attachment thumbnails through `file-proxy`, a PDF button that opens it through `file-proxy`, and history. Cancel is available while `submitted`; Edit & Resubmit while `rejected`, with the reason shown.
  - New Claim: dynamic item rows with a live total; camera, gallery, and PDF picker; bank details prefilled from the profile, with a "save to profile" checkbox; per-file upload progress.
  - Profile: name, position, bank details, sign out.
- **Admin extra tabs**:
  - Review: pending list and detail with Approve (confirm) and Reject (reason); an Approved list with Mark Paid; an All Claims search.
  - Users: list; invite a Google email; create an email/password account with an initial password; set or unset admin; deactivate; the "Resync Sheet" button.

Out of scope for v1: push and email notifications, offline submission, multi-currency, reports, automatic cleanup of orphaned uploads, iOS build.

## 10. Security

- Firestore rules:
  - `users/{uid}`: the owner can read and can update only `name`, `position`, `bank`, `updatedAt`. Admins can read all.
  - `claims`: the applicant can read their own; admins can read all; the client cannot write.
  - `invites`, `counters`: no client access.
- Every Function verifies the Firebase ID token and loads `users/{uid}`. It requires `active`, checks the role, and checks that the state transition is allowed. Errors are returned as `{ error: CODE, message }`.
- `generate-pdf-background` accepts only requests with `INTERNAL_FUNCTION_SECRET`.
- `file-proxy` streams a file only if it belongs to a claim the caller can read.
- Service account scopes: `https://www.googleapis.com/auth/drive` and `https://www.googleapis.com/auth/spreadsheets`.

Netlify env vars (server-side only): `FIREBASE_PROJECT_ID`, `GOOGLE_SA_EMAIL`, `GOOGLE_SA_PRIVATE_KEY`, `GOOGLE_SHARED_DRIVE_ID=0ABnERw4RUzYbUk9PVA`, `GOOGLE_ROOT_FOLDER_ID`, `GOOGLE_SHEET_ID`, `INTERNAL_FUNCTION_SECRET`, and optionally `FUNCTIONS_BASE_URL`. A single service account (the Firebase Admin SDK key) serves Firestore, Drive and Sheets, because two private keys would exceed Lambda's 4KB env-var limit.

Planning amendments (2026-09-26):
- There are two extra functions: `session` (verifies sign-in and turns an invite into a user) and `health` (checks that the assets are bundled).
- Each claim has at least 1 attachment.
- `file-proxy` streams files up to 19MB (the Netlify streaming limit). For larger files it returns `FILE_TOO_LARGE`, and the app points the user to Drive.
- Claims also store `attachmentsFolderId` and `pdf.requestId`. A background PDF run whose `requestId` is stale discards its output, so a slow draft can never overwrite the final PDF.
- Admins can read `invites`.
- Any wrong current status returns `409 STATUS_CHANGED`. Role or ownership failures return `403 FORBIDDEN`.
- CJK text uses a HarfBuzz pre-subset (`subset-font`) of the Noto Sans SC variable TTF, embedded with `subset: false`, because pdf-lib's own subsetting drops CJK glyphs (verified).

## 11. Error Handling

| Case | Handling |
|---|---|
| Attachment upload fails | Per-file retry in the app; nothing is written to Firestore until `submit-claim` runs |
| App closed mid-upload | An orphan `_attachments/{claimId}/` folder remains; this is harmless and not cleaned up in v1 |
| PDF generation fails | `pdf.status=failed` plus the error; a Regenerate button appears |
| Sheet write fails | `sheetSynced=false`; the admin runs Resync Sheet |
| Concurrent approve | The transaction rejects the second approval with `STATUS_CHANGED` |
| Invalid transition or role | `403` or `409` with a code; the app shows a friendly message |

## 12. Testing

- Unit tests (Vitest), in `shared/` and `netlify/lib`:
  - filename sanitising and formatting
  - refNo formatting
  - cents math
  - the transition matrix
  - PDF builder: page count with mixed image and PDF attachments, and that Chinese text embeds without errors
- Function integration tests against the Firebase Emulator (Auth + Firestore), with Drive and Sheets mocked:
  - permission denials
  - resubmit rules
  - concurrent approvals yield unique sequential numbers
- Firestore rules tests with `@firebase/rules-unit-testing`.
- Manual E2E on an Android device: submit → reject → resubmit → approve → paid. Afterwards, verify that Firestore, the Sheet, and Drive agree.

## 13. Deployment and Setup

- Netlify: a Functions-only site linked to the repo, with base `netlify/`. The long-running PDF function uses the `-background` suffix.
- App: EAS Build for Android. Register the SHA-1 fingerprints in Firebase for Google Sign-In, and add the Web client ID for `@react-native-google-signin/google-signin`.
- Setup script:
  - creates `JEP Claims/` in the Shared Drive
  - creates the Sheet with its header row
  - sets `counters/claimSeq.next = 1`
  - creates the first admins: wailoong8278.jcim@jcikl.cc and info.jepventures@gmail.com (as admin invites, so both can use Google Sign-In)
- Service account: add it to the Shared Drive as Content Manager.

## 14. Push Notifications (added 2026-09-26, approved)

| Event | Recipients | Title / body |
|---|---|---|
| New claim submitted | All active admins except the applicant | `New claim` / `{applicant} submitted {RM total}` |
| Rejected claim resubmitted | All active admins except the applicant | `Claim resubmitted` / `{applicant} resubmitted {RM total}` |
| Approved | Applicant (skipped if the approver is the applicant) | `Claim approved` / `{refNo} ({RM total}) was approved` |
| Rejected | Applicant (skipped if the reviewer is the applicant) | `Claim rejected` / `Reason: {reason}` |
| Paid | Applicant (skipped if the payer is the applicant) | `Claim paid` / `{refNo} ({RM total}) has been paid` |

- Transport: Firebase Cloud Messaging via `firebase-admin/messaging`, using the existing service account (the Firebase Cloud Messaging API must be enabled). Android channel id `claims`, high importance. Every message carries `data.claimId`; tapping it opens `/claim/{claimId}`.
- Device tokens: `pushTokens/{token}` = `{ uid, platform, updatedAt }`, with no client access in the rules. The app registers the FCM device token after sign-in through `register-push-token`, and again on token refresh. Registering reassigns a token to the current user. The app calls `unregister-push-token` before sign-out.
- Sending is best-effort. It runs after the claim write and the Sheet sync; failures are logged and never fail the API call. Tokens that FCM reports as unregistered or invalid are deleted.
- Not notified in v1: cancellation and PDF ready.
