import { ApiClientError, createApi, friendlyMessage } from './api';

function setup(response: () => Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const api = createApi({
    baseUrl: 'https://api.test',
    getIdToken: async () => 'ID_TOKEN',
    fetchImpl: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return response();
    }) as unknown as typeof fetch,
  });
  return { api, calls };
}

describe('createApi', () => {
  it('POSTs JSON with the Firebase ID token', async () => {
    const { api, calls } = setup(async () => new Response(JSON.stringify({ claimId: 'c1' }), { status: 200 }));
    const res = await api.cancelClaim({ claimId: 'c1' });
    expect(res).toEqual({ claimId: 'c1' });
    expect(calls[0]!.url).toBe('https://api.test/.netlify/functions/cancel-claim');
    expect(calls[0]!.init.method).toBe('POST');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer ID_TOKEN');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ claimId: 'c1' });
  });

  it('turns API error bodies into ApiClientError', async () => {
    const { api } = setup(async () =>
      new Response(JSON.stringify({ error: 'STATUS_CHANGED', message: 'Changed by someone else' }), { status: 409 }),
    );
    await expect(api.reviewClaim({ claimId: 'c1', decision: 'approve' })).rejects.toMatchObject({
      code: 'STATUS_CHANGED', status: 409, message: 'Changed by someone else',
    });
  });

  it('reports network failures with code NETWORK', async () => {
    const { api } = setup(async () => {
      throw new TypeError('Network request failed');
    });
    const err = await api.session().catch((e) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err.code).toBe('NETWORK');
  });

  it('builds file-proxy URLs and auth headers', async () => {
    const { api } = setup(async () => new Response('{}'));
    expect(api.fileUrl('c 1', 'f/2')).toBe('https://api.test/.netlify/functions/file-proxy?claimId=c%201&fileId=f%2F2');
    expect(await api.authHeaders()).toEqual({ Authorization: 'Bearer ID_TOKEN' });
  });
});

describe('friendlyMessage', () => {
  it('prefers server messages and has a fallback', () => {
    expect(friendlyMessage(new ApiClientError('FORBIDDEN', 'Only admins can do this.', 403))).toBe('Only admins can do this.');
    expect(friendlyMessage(new ApiClientError('NETWORK', 'x', 0))).toBe('No connection. Please check your internet and try again.');
    expect(friendlyMessage({})).toBe('Something went wrong. Please try again.');
  });
});
