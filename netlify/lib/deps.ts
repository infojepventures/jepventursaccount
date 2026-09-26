import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { loadPdfAssets, type PdfAssets } from './assets';
import { DocumentAiClient, type DocAiApi } from './docai';
import { DriveClient, type DriveApi } from './drive';
import { env } from './env';
import { getAdminApp } from './firebaseAdmin';
import { createTokenProvider, SCOPES } from './googleAuth';
import { FcmPush, type PushApi } from './push';
import { SheetsClient, type SheetsApi } from './sheets';

export interface Deps {
  db: Firestore;
  auth: Auth;
  drive: DriveApi;
  sheets: SheetsApi;
  push: PushApi;
  /** Null when DOCUMENT_AI_ENDPOINT is unset — Document AI is optional; OCR falls back to the free path. */
  docai: DocAiApi | null;
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
  const docAiEndpoint = process.env.DOCUMENT_AI_ENDPOINT;
  const docai = docAiEndpoint
    ? new DocumentAiClient(
        docAiEndpoint,
        createTokenProvider({
          clientEmail: env('GOOGLE_SA_EMAIL'),
          privateKey: env('GOOGLE_SA_PRIVATE_KEY').replace(/\\n/g, '\n'),
          scopes: [SCOPES.cloudPlatform],
        }),
      )
    : null;
  return {
    db: getFirestore(app),
    auth: getAuth(app),
    drive: new DriveClient(getToken),
    sheets: new SheetsClient(getToken, env('GOOGLE_SHEET_ID')),
    push: new FcmPush(getMessaging(app)),
    docai,
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
