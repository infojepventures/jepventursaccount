import type { LocalAttachment } from '../claims/types';

/** A file another app shared to (or opened with) JEP Claims, as copied into the app's cache. */
export interface IncomingFile {
  path: string;
  mimeType: string | null;
  fileName: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
}

type Slot = 'claim' | 'slip';
type Listener = (files: LocalAttachment[]) => void;

/**
 * Hands shared files from the share handler to the screen that uses them. A slot holds its files until that
 * screen takes them, whether it is already open (its listener fires) or opens later (it takes them on mount).
 */
function createHandoff() {
  const pending = new Map<Slot, LocalAttachment[]>();
  const listeners = new Map<Slot, Listener>();

  return {
    give(slot: Slot, files: LocalAttachment[]) {
      const listener = listeners.get(slot);
      if (listener) listener(files);
      else pending.set(slot, files);
    },
    take(slot: Slot): LocalAttachment[] {
      const files = pending.get(slot) ?? [];
      pending.delete(slot);
      return files;
    },
    clear(slot: Slot) {
      pending.delete(slot);
    },
    /** Delivers anything already waiting, then later arrivals. Returns the unsubscribe function. */
    listen(slot: Slot, listener: Listener): () => void {
      listeners.set(slot, listener);
      const waiting = this.take(slot);
      if (waiting.length) listener(waiting);
      return () => {
        if (listeners.get(slot) === listener) listeners.delete(slot);
      };
    },
  };
}

export const handoff = createHandoff();
export { createHandoff };

/** Files an attachment can be made from (JPG/PNG/PDF; other images are converted to JPG), and the rest by name. */
export function classifySharedFiles(files: IncomingFile[]): { images: IncomingFile[]; pdfs: IncomingFile[]; unsupported: string[] } {
  const images: IncomingFile[] = [];
  const pdfs: IncomingFile[] = [];
  const unsupported: string[] = [];
  for (const f of files) {
    const type = (f.mimeType ?? '').toLowerCase();
    if (type === 'application/pdf') pdfs.push(f);
    else if (type.startsWith('image/')) images.push(f);
    else unsupported.push(f.fileName ?? 'file');
  }
  return { images, pdfs, unsupported };
}
