import { getDeps } from '../lib/deps';
import { cleanupAbandonedUploads } from '../lib/services/discardUploads';

// Scheduled function (schedule set in netlify.toml): trashes receipts of new claims never submitted.
// Netlify only invokes scheduled functions on their schedule, never from a public URL.
export default async (): Promise<Response> => {
  const result = await cleanupAbandonedUploads(getDeps());
  console.log('[cleanup-uploads]', JSON.stringify(result));
  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
};
