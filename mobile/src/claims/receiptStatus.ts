import type { LocalAttachment } from './types';

export interface ReceiptStatus {
  label: string;
  tone: 'busy' | 'success' | 'muted' | 'danger';
  /** Upload fraction 0..1, only while uploading. */
  progress?: number;
  /** Which step a Retry button should re-run. */
  retry?: 'upload' | 'analyze';
}

/** The one-line status shown under a receipt picked in this form: upload → scan → read → result. */
export function receiptStatus(a: LocalAttachment): ReceiptStatus {
  if (a.error) return { label: 'Upload failed', tone: 'danger', retry: 'upload' };
  if (!a.uploadedId) {
    if (a.progress === undefined) return { label: 'Waiting to upload', tone: 'busy' };
    return { label: `Uploading ${Math.round(a.progress * 100)}%`, tone: 'busy', progress: a.progress };
  }
  if (a.analyzeStage === 'scanning') return { label: 'Scanning text…', tone: 'busy' };
  if (a.analyzeStage === 'reading') return { label: 'Reading details…', tone: 'busy' };
  if (a.analyzeError) return { label: a.analyzeError, tone: 'danger', retry: 'analyze' };
  if (a.analyzed) {
    const n = a.filledCount ?? 0;
    return n > 0 ? { label: `Filled ${n} field${n === 1 ? '' : 's'}`, tone: 'success' } : { label: 'No details found', tone: 'muted' };
  }
  return { label: 'Uploaded', tone: 'success' };
}
