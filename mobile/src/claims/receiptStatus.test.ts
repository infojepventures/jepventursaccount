import { receiptStatus } from './receiptStatus';
import type { LocalAttachment } from './types';

const base: LocalAttachment = { key: 'k1', kind: 'local', uri: 'file:///r.jpg', name: 'r.jpg', mimeType: 'image/jpeg', size: 10 };
const uploaded = { ...base, uploadedId: 'f1', progress: 1 };

describe('receiptStatus', () => {
  it('walks through upload: waiting, then a percentage with a progress fraction', () => {
    expect(receiptStatus(base)).toEqual({ label: 'Waiting to upload', tone: 'busy' });
    expect(receiptStatus({ ...base, progress: 0.456 })).toEqual({ label: 'Uploading 46%', tone: 'busy', progress: 0.456 });
  });

  it('offers an upload retry when the upload failed', () => {
    expect(receiptStatus({ ...base, error: 'Network down' })).toEqual({ label: 'Upload failed', tone: 'danger', retry: 'upload' });
  });

  it('shows the scanning and reading stages once uploaded', () => {
    expect(receiptStatus({ ...uploaded, analyzeStage: 'scanning' })).toEqual({ label: 'Scanning text…', tone: 'busy' });
    expect(receiptStatus({ ...uploaded, analyzeStage: 'reading' })).toEqual({ label: 'Reading details…', tone: 'busy' });
  });

  it('reports how many fields were filled, or that nothing was found', () => {
    expect(receiptStatus({ ...uploaded, analyzed: true, filledCount: 3 })).toEqual({ label: 'Filled 3 fields', tone: 'success' });
    expect(receiptStatus({ ...uploaded, analyzed: true, filledCount: 1 })).toEqual({ label: 'Filled 1 field', tone: 'success' });
    expect(receiptStatus({ ...uploaded, analyzed: true, filledCount: 0 })).toEqual({ label: 'No details found', tone: 'muted' });
  });

  it('offers an analysis retry when reading failed', () => {
    expect(receiptStatus({ ...uploaded, analyzed: true, analyzeError: "Couldn't read" })).toEqual({
      label: "Couldn't read",
      tone: 'danger',
      retry: 'analyze',
    });
  });

  it('is just "Uploaded" when uploaded but not analysed (e.g. uploaded during submit)', () => {
    expect(receiptStatus(uploaded)).toEqual({ label: 'Uploaded', tone: 'success' });
  });
});
