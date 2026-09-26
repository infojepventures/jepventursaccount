import { describe, expect, it, vi } from 'vitest';
import { DocumentAiClient } from '../../lib/docai';

const noopToken = async () => 'tok-1';

describe('DocumentAiClient', () => {
  it('POSTs the base64 document and bearer token, and maps entities', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://docai.example/v1/projects/p/locations/l/processors/proc:process');
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
      const body = JSON.parse(String(init?.body));
      expect(body.skipHumanReview).toBe(true);
      expect(body.rawDocument.mimeType).toBe('application/pdf');
      expect(Buffer.from(body.rawDocument.content, 'base64').toString('utf8')).toBe('hello');
      return new Response(
        JSON.stringify({
          document: {
            text: 'INVOICE\nTotal: RM 100.00',
            entities: [
              { type: 'invoice_id', mentionText: 'INV-1', confidence: 0.9 },
              {
                type: 'total_amount',
                mentionText: 'RM 100.00',
                normalizedValue: { moneyValue: { units: '100', nanos: 0, currencyCode: 'MYR' } },
              },
            ],
          },
        }),
        { status: 200 },
      );
    });
    const client = new DocumentAiClient(
      'https://docai.example/v1/projects/p/locations/l/processors/proc:process',
      noopToken,
      fetchImpl as unknown as typeof fetch,
    );
    const doc = await client.process(new TextEncoder().encode('hello'), 'application/pdf');
    expect(doc.text).toContain('INVOICE');
    expect(doc.entities).toHaveLength(2);
    expect(doc.entities[0]).toMatchObject({ type: 'invoice_id', mentionText: 'INV-1' });
    expect(doc.entities[1]?.normalizedValue?.moneyValue?.units).toBe('100');
  });

  it('throws a descriptive error on a non-2xx response', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('{"error":{"message":"Processor not found"}}', { status: 404 }),
    );
    const client = new DocumentAiClient('https://docai.example/process', noopToken, fetchImpl as unknown as typeof fetch);
    await expect(client.process(new Uint8Array([1, 2, 3]), 'image/png')).rejects.toThrow(/404/);
    await expect(client.process(new Uint8Array([1, 2, 3]), 'image/png')).rejects.toThrow(/Processor not found/);
  });

  it('maps nested properties (line items)', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            document: {
              text: 'x',
              entities: [
                {
                  type: 'line_item',
                  properties: [{ type: 'line_item/description', mentionText: 'Widget' }],
                },
              ],
            },
          }),
          { status: 200 },
        ),
    );
    const client = new DocumentAiClient('https://docai.example/process', noopToken, fetchImpl as unknown as typeof fetch);
    const doc = await client.process(new Uint8Array([1]), 'image/jpeg');
    expect(doc.entities[0]?.properties?.[0]).toMatchObject({ type: 'line_item/description', mentionText: 'Widget' });
  });
});
