# Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Send FCM push notifications for claim events (new or resubmitted claim to admins; approved, rejected or paid to the applicant), per spec §14.

**Architecture:** The backend adds a `PushApi` to `Deps` (a real FCM implementation via `firebase-admin/messaging`, plus a fake for tests), a `notifyClaimEvent` service called best-effort after the claim write and Sheet sync, a `pushTokens/{token}` collection, and two endpoints to register and unregister a device token. The mobile app uses `expo-notifications` to request permission, obtain the FCM device token, register it after sign-in and on refresh, unregister it before sign-out, create the Android channel `claims`, and open `/claim/{claimId}` when a notification is tapped.

**Tech Stack:** firebase-admin 14 messaging, expo-notifications (SDK 57), Vitest on the Firebase emulator, Jest.

## Global Constraints

- Spec §14 is binding: the recipients, the title/body texts, `data.claimId`, channel `claims`, best-effort sending, deleting invalid tokens, and no notifications for cancel or PDF ready.
- Titles and bodies, verbatim (the RM total uses `formatRM(totalCents)` from `@jep/shared`):
  - `submitted`: `New claim` / `{applicant.name} submitted {RM total}`
  - `resubmitted`: `Claim resubmitted` / `{applicant.name} resubmitted {RM total}`
  - `approved`: `Claim approved` / `{refNo} ({RM total}) was approved`
  - `rejected`: `Claim rejected` / `Reason: {review.reason}`
  - `paid`: `Claim paid` / `{refNo} ({RM total}) has been paid`
- Admin recipients: users with `role == 'admin'` and `active == true`, excluding the applicant. Applicant recipient: skipped when the acting user is the applicant.
- A push failure never fails or delays the API response beyond the send attempt; wrap it and log with `console.error('[notify]', …)`.
- Every commit message ends with a blank line and then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commands: `npm test`, `npm run typecheck`, and `export PATH="/c/Program Files/Android/Android Studio/jbr/bin:$PATH" && npm run test:int` (from the repo root).

---

### Task P1: Backend push (token endpoints, FCM sender, notify service, hooks)

**Files:**
- Create: `netlify/lib/push.ts`, `netlify/lib/services/pushTokens.ts`, `netlify/lib/services/notify.ts`, `netlify/functions/register-push-token.mts`, `netlify/functions/unregister-push-token.mts`
- Modify: `shared/src/api.ts` (add `API.registerPushToken = 'register-push-token'` and `API.unregisterPushToken = 'unregister-push-token'`; add types `RegisterPushTokenRequest { token: string; platform: 'android' | 'ios' }` and `UnregisterPushTokenRequest { token: string }`), `netlify/lib/firestore.ts` (`COL.pushTokens = 'pushTokens'`), `netlify/lib/deps.ts` (add `push: PushApi`, real = `new FcmPush(getMessaging(app))`), `firebase/firestore.rules` (`match /pushTokens/{t} { allow read, write: if false; }`), `netlify/test/fakes.ts` (add `FakePush`), `netlify/test/int/helpers.ts` (add `push` to `makeTestDeps`, returned as `t.push`), `netlify/lib/services/submitClaim.ts`, `netlify/lib/services/reviewClaim.ts`, `netlify/lib/services/claimActions.ts` (markPaid)
- Test: `netlify/test/int/push.int.test.ts`, `netlify/test/unit/push.test.ts`, plus an added rules case in `netlify/test/int/rules.int.test.ts`

**Interfaces:**
```ts
// netlify/lib/push.ts
export interface PushMessage { title: string; body: string; data: Record<string, string> }
export interface PushApi { send(tokens: string[], msg: PushMessage): Promise<{ invalidTokens: string[] }> }
export class FcmPush implements PushApi { constructor(messaging: Messaging) }
// Uses messaging.sendEachForMulticast({ tokens, notification: { title, body }, data,
//   android: { priority: 'high', notification: { channelId: 'claims' } } }), in chunks of at most 500 tokens.
// invalidTokens = tokens whose response error code is
//   'messaging/registration-token-not-registered' | 'messaging/invalid-registration-token' | 'messaging/invalid-argument'.
// With 0 tokens it returns immediately without calling FCM.

// netlify/lib/services/pushTokens.ts
export function registerPushToken(deps: Deps, actor: Actor, req: RegisterPushTokenRequest): Promise<{ ok: true }>;
//   Token must be a non-empty string ≤ 4096 chars; platform must be 'android' or 'ios'; otherwise INVALID_INPUT.
//   Sets pushTokens/{token} = { uid: actor.uid, platform, updatedAt }, overwriting (reassigns the device to the current user).
export function unregisterPushToken(deps: Deps, actor: Actor, req: UnregisterPushTokenRequest): Promise<{ ok: true }>;
//   Deletes pushTokens/{token} only if its uid === actor.uid; otherwise it is a silent no-op; always returns { ok: true }.

// netlify/lib/services/notify.ts
export type ClaimEvent = 'submitted' | 'resubmitted' | 'approved' | 'rejected' | 'paid';
export function buildMessage(event: ClaimEvent, claim: ClaimDoc, claimId: string): PushMessage; // pure; texts per Global Constraints; data = { claimId, event }
export function notifyClaimEvent(deps: Deps, event: ClaimEvent, claimId: string, actorUid: string): Promise<void>;
//   Never throws. Reads the claim, resolves recipient uids, loads their tokens (Firestore `in` queries in chunks of 30 uids),
//   calls deps.push.send, then deletes the returned invalidTokens.
```

**Hooks** (call after `syncClaimToSheet`, awaited, relying on its never-throws guarantee):
- `submitClaim`: event `resubmitted` when `req.resubmit`, else `submitted`. **Not** called on the idempotent early-return paths, where the claim already exists.
- `reviewClaim`: `approved` or `rejected`, according to the result.
- `markPaid`: `paid`.

- [ ] **Step 1: Write the failing tests.**
  - Unit (`push.test.ts`, with a stubbed `Messaging`):
    - chunking at 500 tokens;
    - invalid-token extraction for the three error codes, ignoring others;
    - 0 tokens means no call;
    - `buildMessage` returns the exact texts for all 5 events.
  - Integration (`push.int.test.ts`, using `FakePush`, which records calls and can mark tokens invalid):
    - register then unregister; unregister by another user is a no-op; re-register by another user reassigns the token; bad input gives INVALID_INPUT;
    - a new claim notifies both active admins but not the applicant-admin, not inactive admins, and not members;
    - resubmit sends the `resubmitted` event to admins;
    - approve, reject (with the reason in the body) and paid each notify only the applicant;
    - approving your own claim as an admin sends nothing;
    - invalid tokens get deleted;
    - a `FakePush` that throws still lets the API call succeed and the claim is written;
    - an idempotent resubmit-retry of a new claim sends no second notification.
  - Rules: clients cannot read or write `pushTokens`.
- [ ] **Step 2: Run the tests to see RED.**
- [ ] **Step 3: Implement.** Include the endpoint wrappers in the style of the existing `.mts` functions, using `handle`, `readJson`, `requireActor` and `getDeps`.
- [ ] **Step 4: Run GREEN.** All of `npm test`, `npm run typecheck`, `npm run test:int` and `npm run build:functions -w @jep/netlify` (14 functions) must pass.
- [ ] **Step 5: Commit** as `feat(netlify): push notifications for claim events via FCM`.

---

### Task P2: Mobile push registration and tap handling

**Files:**
- Create: `mobile/src/notifications/push.ts`
- Modify: `mobile/src/lib/api.ts` (add `registerPushToken(req)` and `unregisterPushToken(req)`, calling the new API names), `mobile/src/lib/api.test.ts` (one test each for URL and body), `mobile/src/auth/AuthProvider.tsx` (register after status becomes `signedIn`; unregister before `signOutEverywhere`), `mobile/src/app/_layout.tsx` (mount the tap handler), `mobile/app.json` (plugin `["expo-notifications", { "color": "#111111" }]`), `mobile/package.json` (via `npx expo install expo-notifications`)

**Interfaces:**
```ts
// mobile/src/notifications/push.ts
export async function ensureAndroidChannel(): Promise<void>;
//   Calls Notifications.setNotificationChannelAsync('claims', { name: 'Claims', importance: MAX }). Android only.
export async function getDevicePushToken(): Promise<string | null>;
//   Requests permission if not yet decided (Android 13+ prompt); returns null when denied or on a simulator/error.
//   Otherwise returns (await Notifications.getDevicePushTokenAsync()).data as string.
export function registerForPush(api: Pick<Api, 'registerPushToken'>): Promise<() => void>;
//   Gets the token and registers it (platform 'android' | 'ios' from Platform.OS).
//   Subscribes Notifications.addPushTokenListener to re-register on refresh; returns an unsubscribe function.
//   Never throws: errors are logged.
export function lastRegisteredToken(): string | null; // used for unregister on sign-out
export function useNotificationTapNavigation(): void;
//   Uses Notifications.useLastNotificationResponse() plus addNotificationResponseReceivedListener
//   → router.push({ pathname: '/claim/[id]', params: { id: data.claimId } }) when data.claimId is a string.
// Module side effect: Notifications.setNotificationHandler({ handleNotification: async () =>
//   ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) })
//   so notifications show in the foreground. Adapt field names to the installed SDK's types if they differ.
```

**Behaviour:**
- `AuthProvider`: when a valid snapshot sets `status='signedIn'` for a uid, call `registerForPush(api)` once per signed-in uid (guard with a ref). Keep the unsubscribe and call it on sign-out or user change.
- `signOut`: if `lastRegisteredToken()`, call `await api.unregisterPushToken({ token }).catch(() => {})` BEFORE `signOutEverywhere()`, since the ID token is still valid then.
- Tapping a notification while the app is signed in navigates to the claim. If signed out, the existing Gate sends the user to login.

- [ ] **Step 1:** Run `cd mobile && npx expo install expo-notifications`, then add the app.json plugin.
- [ ] **Step 2:** TDD the api additions: failing test, then implement.
- [ ] **Step 3:** Implement `push.ts`, the AuthProvider wiring, and the `_layout` tap hook. `npm test -w @jep/mobile` and `npm run typecheck -w @jep/mobile` pass.
- [ ] **Step 4:** Commit as `feat(mobile): register for push notifications and open claims from taps`.
- [ ] **Step 5 (controller):** Rebuild the dev client from the short-path worktree `C:\jep`, then verify on the phone: the permission prompt, a token doc in `pushTokens`, and a notification received when another admin approves or submits.

---

**Setup (user):** enable the **Firebase Cloud Messaging API** in Google Cloud Console for project `jepventuresaccount`, then deploy the updated rules with `npx firebase deploy --only firestore:rules`.
