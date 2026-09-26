import TextRecognition from '@react-native-ml-kit/text-recognition';
import { layoutText, recognizeText } from './ocr';

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

const line = (text: string, left: number, top: number, height = 20) => ({
  text,
  frame: { left, top, width: text.length * 8, height },
  elements: [],
  recognizedLanguages: [],
});

describe('layoutText', () => {
  it('rebuilds visual rows from column-ordered blocks so labels sit next to their values', () => {
    const result = {
      text: 'unused',
      blocks: [
        { text: '', lines: [line('Sub Total', 470, 940), line('Grand Total', 470, 1010)], recognizedLanguages: [] },
        { text: '', lines: [line('407.00', 820, 942), line('439.55', 820, 1008)], recognizedLanguages: [] },
        { text: '', lines: [line('Natural Healing Spa', 36, 440)], recognizedLanguages: [] },
      ],
    };
    expect(layoutText(result as never)).toBe('Natural Healing Spa\nSub Total 407.00\nGrand Total 439.55');
  });

  it('falls back to the plain text when lines have no frames', () => {
    const result = { text: 'A\nB', blocks: [{ text: 'A', lines: [{ text: 'A', elements: [], recognizedLanguages: [] }], recognizedLanguages: [] }] };
    expect(layoutText(result as never)).toBe('A\nB');
  });
});
