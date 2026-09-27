import { extractText, isAvailable } from 'expo-pdf-text-extract';
import { extractPdfText } from './pdfText';

jest.mock('expo-pdf-text-extract', () => ({ __esModule: true, extractText: jest.fn(), isAvailable: jest.fn() }));

const mockExtract = extractText as jest.Mock;
const mockAvailable = isAvailable as jest.Mock;

describe('extractPdfText', () => {
  beforeEach(() => {
    mockExtract.mockReset();
    mockAvailable.mockReset().mockReturnValue(true);
  });

  it('returns the trimmed text with normalised line breaks', async () => {
    mockExtract.mockResolvedValue('  INVOICE : IV-00615\r\nTotal 5000.00\r\n ');
    expect(await extractPdfText('file:///a.pdf')).toBe('INVOICE : IV-00615\nTotal 5000.00');
    expect(mockExtract).toHaveBeenCalledWith('file:///a.pdf');
  });

  it('returns null for a PDF with no text layer (scanned), so the server can try after upload', async () => {
    mockExtract.mockResolvedValue('   \n ');
    expect(await extractPdfText('file:///scan.pdf')).toBeNull();
  });

  it('returns null without calling native code when the module is missing (older app builds)', async () => {
    mockAvailable.mockReturnValue(false);
    expect(await extractPdfText('file:///a.pdf')).toBeNull();
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it('never throws on a corrupt or password-protected PDF', async () => {
    mockExtract.mockRejectedValue(Object.assign(new Error('PASSWORD_REQUIRED'), { code: 'PASSWORD_REQUIRED' }));
    expect(await extractPdfText('file:///locked.pdf')).toBeNull();
  });

  it('caps very long text', async () => {
    mockExtract.mockResolvedValue('x'.repeat(30_000));
    expect((await extractPdfText('file:///big.pdf'))!.length).toBe(20_000);
  });
});
