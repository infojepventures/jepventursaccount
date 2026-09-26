import { getDeps } from '../lib/deps';
import { errorMessage } from '../lib/errors';
import { safeEqual } from '../lib/http';
import { generatePdf } from '../lib/services/generatePdf';
import { markPdfFailed } from '../lib/services/pdfTrigger';

// "-background" suffix: Netlify replies 202 immediately and runs this for up to 15 minutes.
export default async (req: Request): Promise<void> => {
  const secret = process.env.INTERNAL_FUNCTION_SECRET;
  const header = req.headers.get('x-internal-secret');
  if (req.method !== 'POST' || !secret || !header || !safeEqual(header, secret)) {
    console.warn('[generate-pdf-background] rejected request');
    return;
  }
  const { claimId, requestId } = (await req.json()) as { claimId?: string; requestId?: string };
  if (!claimId || !requestId) return;
  try {
    const result = await generatePdf(getDeps(), claimId, requestId);
    console.log('[generate-pdf-background]', claimId, requestId, result);
  } catch (e) {
    console.error('[generate-pdf-background] unhandled failure', claimId, requestId, e);
    try {
      await markPdfFailed(getDeps(), claimId, requestId, errorMessage(e));
    } catch (e2) {
      console.error('[generate-pdf-background] markPdfFailed also failed', claimId, requestId, e2);
    }
  }
};
