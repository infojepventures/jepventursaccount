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
