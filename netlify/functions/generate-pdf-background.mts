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
