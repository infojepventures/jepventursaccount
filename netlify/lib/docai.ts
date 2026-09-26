import { toArrayBuffer } from './bytes';
import type { TokenProvider } from './googleAuth';

export interface DocAiMoneyValue {
  units?: string;
  nanos?: number;
  currencyCode?: string;
}

export interface DocAiEntity {
  type: string;
  mentionText?: string;
  normalizedValue?: {
    text?: string;
    moneyValue?: DocAiMoneyValue;
  };
  confidence?: number;
  properties?: DocAiEntity[];
}

export interface DocAiDocument {
  text: string;
  entities: DocAiEntity[];
}

export interface DocAiApi {
  process(data: Uint8Array, mimeType: string): Promise<DocAiDocument>;
}

interface RawDocAiEntity {
  type?: string;
  mentionText?: string;
  normalizedValue?: {
    text?: string;
    moneyValue?: DocAiMoneyValue;
  };
  confidence?: number;
  properties?: RawDocAiEntity[];
}

interface RawDocAiResponse {
  document?: {
    text?: string;
    entities?: RawDocAiEntity[];
  };
}

function toBase64(data: Uint8Array): string {
  return Buffer.from(toArrayBuffer(data)).toString('base64');
}

function toEntity(e: RawDocAiEntity): DocAiEntity {
  return {
    type: e.type ?? '',
    mentionText: e.mentionText,
    normalizedValue: e.normalizedValue,
    confidence: e.confidence,
    properties: e.properties?.map(toEntity),
  };
}

export class DocumentAiClient implements DocAiApi {
  constructor(
    private readonly endpoint: string,
    private readonly getToken: TokenProvider,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async process(data: Uint8Array, mimeType: string): Promise<DocAiDocument> {
    const res = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        Authorization: `Bearer ${await this.getToken()}`,
      },
      body: JSON.stringify({
        rawDocument: { content: toBase64(data), mimeType },
        skipHumanReview: true,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Document AI request failed: ${res.status} ${text}`);
    }
    const body = (await res.json()) as RawDocAiResponse;
    return {
      text: body.document?.text ?? '',
      entities: (body.document?.entities ?? []).map(toEntity),
    };
  }
}
