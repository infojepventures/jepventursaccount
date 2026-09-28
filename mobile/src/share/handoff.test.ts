import type { LocalAttachment } from '../claims/types';
import { classifySharedFiles, createHandoff, type IncomingFile } from './handoff';

const file = (key: string): LocalAttachment => ({ key, kind: 'local', uri: `file:///${key}`, name: key, mimeType: 'image/jpeg', size: 1 });
const incoming = (fileName: string, mimeType: string | null): IncomingFile => ({
  path: `file:///${fileName}`, mimeType, fileName, size: 1, width: null, height: null,
});

describe('handoff', () => {
  it('keeps files until the screen takes them', () => {
    const h = createHandoff();
    h.give('claim', [file('a')]);
    expect(h.take('slip')).toEqual([]);
    expect(h.take('claim').map((f) => f.key)).toEqual(['a']);
    expect(h.take('claim')).toEqual([]);
  });

  it('delivers waiting files on listen, and later ones straight to the listener', () => {
    const h = createHandoff();
    h.give('claim', [file('a')]);
    const got: string[][] = [];
    const stop = h.listen('claim', (files) => got.push(files.map((f) => f.key)));
    h.give('claim', [file('b'), file('c')]);
    stop();
    h.give('claim', [file('d')]);
    expect(got).toEqual([['a'], ['b', 'c']]);
    expect(h.take('claim').map((f) => f.key)).toEqual(['d']);
  });

  it('clears a slot', () => {
    const h = createHandoff();
    h.give('slip', [file('a')]);
    h.clear('slip');
    expect(h.take('slip')).toEqual([]);
  });
});

describe('classifySharedFiles', () => {
  it('sorts images and PDFs from files that cannot be attached', () => {
    const r = classifySharedFiles([
      incoming('a.jpg', 'image/jpeg'),
      incoming('b.heic', 'image/heic'),
      incoming('c.pdf', 'application/pdf'),
      incoming('d.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      incoming('e', null),
    ]);
    expect(r.images.map((f) => f.fileName)).toEqual(['a.jpg', 'b.heic']);
    expect(r.pdfs.map((f) => f.fileName)).toEqual(['c.pdf']);
    expect(r.unsupported).toEqual(['d.docx', 'e']);
  });
});
