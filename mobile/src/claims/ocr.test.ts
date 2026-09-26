import TextRecognition from '@react-native-ml-kit/text-recognition';
import { recognizeText } from './ocr';

jest.mock('@react-native-ml-kit/text-recognition', () => ({
  __esModule: true,
  default: { recognize: jest.fn() },
  TextRecognitionScript: { CHINESE: 'Chinese', LATIN: 'Latin' },
}));

const mockRecognize = TextRecognition.recognize as jest.Mock;

describe('recognizeText', () => {
  beforeEach(() => mockRecognize.mockReset());

  it('returns text from the Chinese-script pass when it finds something', async () => {
    mockRecognize.mockResolvedValueOnce({ text: 'INVOICE 12.50', blocks: [] });
    const text = await recognizeText('file:///a.jpg');
    expect(text).toBe('INVOICE 12.50');
    expect(mockRecognize).toHaveBeenCalledTimes(1);
    expect(mockRecognize).toHaveBeenCalledWith('file:///a.jpg', 'Chinese');
  });

  it('falls back to Latin when the Chinese pass throws', async () => {
    mockRecognize.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ text: 'Total 10.00', blocks: [] });
    const text = await recognizeText('file:///a.jpg');
    expect(text).toBe('Total 10.00');
    expect(mockRecognize).toHaveBeenNthCalledWith(2, 'file:///a.jpg', 'Latin');
  });

  it('falls back to Latin when the Chinese pass finds nothing', async () => {
    mockRecognize.mockResolvedValueOnce({ text: '', blocks: [] }).mockResolvedValueOnce({ text: 'Total 10.00', blocks: [] });
    const text = await recognizeText('file:///a.jpg');
    expect(text).toBe('Total 10.00');
  });

  it('returns null when both passes fail', async () => {
    mockRecognize.mockRejectedValue(new Error('boom'));
    const text = await recognizeText('file:///a.jpg');
    expect(text).toBeNull();
  });

  it('returns null when nothing is recognized', async () => {
    mockRecognize.mockResolvedValue({ text: '   ', blocks: [] });
    const text = await recognizeText('file:///a.jpg');
    expect(text).toBeNull();
  });

  it('truncates to 20,000 characters', async () => {
    mockRecognize.mockResolvedValueOnce({ text: 'x'.repeat(25000), blocks: [] });
    const text = await recognizeText('file:///a.jpg');
    expect(text).toHaveLength(20000);
  });
});
