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
