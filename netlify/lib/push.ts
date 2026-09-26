import type { Messaging } from 'firebase-admin/messaging';

export interface PushMessage {
  title: string;
  body: string;
  data: Record<string, string>;
}

export interface PushApi {
  send(tokens: string[], msg: PushMessage): Promise<{ invalidTokens: string[] }>;
}

const CHUNK_SIZE = 500;

const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

export class FcmPush implements PushApi {
  constructor(private readonly messaging: Messaging) {}

  async send(tokens: string[], msg: PushMessage): Promise<{ invalidTokens: string[] }> {
    if (tokens.length === 0) return { invalidTokens: [] };
    const invalidTokens: string[] = [];
    for (let i = 0; i < tokens.length; i += CHUNK_SIZE) {
      const chunk = tokens.slice(i, i + CHUNK_SIZE);
      const res = await this.messaging.sendEachForMulticast({
        tokens: chunk,
        notification: { title: msg.title, body: msg.body },
        data: msg.data,
        android: { priority: 'high', notification: { channelId: 'claims' } },
      });
      res.responses.forEach((r, idx) => {
        if (!r.success && r.error && INVALID_TOKEN_CODES.has(r.error.code)) invalidTokens.push(chunk[idx]!);
      });
    }
    return { invalidTokens };
  }
}
