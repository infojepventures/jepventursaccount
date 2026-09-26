import { isAllowedMime, isValidClaimId, type AnalyzeAttachmentRequest, type AnalyzeAttachmentResponse, type AttachmentSuggestion } from '@jep/shared';
import type { Actor } from '../actor';
import type { Deps } from '../deps';
import { fail } from '../errors';
import { COL, getClaim } from '../firestore';
import { extractSuggestion, extractSuggestionFromText } from '../ocrExtract';
import { extractPdfText } from '../pdfText';

export const MAX_OCR_BYTES = 20 * 1024 * 1024;
export const MAX_TEXT_CHARS = 20_000;

interface UploadFolderDoc {
  uid: string;
  folderId: string;
}

async function resolveFolderId(deps: Deps, actor: Actor, claimId: string): Promise<string> {
  const claim = await getClaim(deps.db, claimId);
  if (claim) {
    if (claim.applicant.uid !== actor.uid) throw fail.forbidden();
    return claim.attachmentsFolderId;
  }

  const snap = await deps.db.collection(COL.uploadFolders).doc(claimId).get();
  if (!snap.exists) throw fail.notFound('Upload the file first');
  const bound = snap.data() as UploadFolderDoc;
  if (bound.uid !== actor.uid) throw fail.forbidden();
  return bound.folderId;
}

async function suggestionViaDocai(deps: Deps, data: Uint8Array, mimeType: string): Promise<AttachmentSuggestion | null> {
  if (!deps.docai) return null;
  try {
    const doc = await deps.docai.process(data, mimeType);
    return extractSuggestion(doc);
  } catch (e) {
    console.error('[analyzeAttachment] Document AI failed, falling back to the free path', e);
    return null;
  }
}

export async function analyzeAttachment(
  deps: Deps,
  actor: Actor,
  req: AnalyzeAttachmentRequest,
): Promise<AnalyzeAttachmentResponse> {
  if (!isValidClaimId(req?.claimId)) throw fail.invalid('Invalid claimId');
  if (!req?.fileId || typeof req.fileId !== 'string') throw fail.invalid('Invalid fileId');
  if (req.text !== undefined && (typeof req.text !== 'string' || req.text.length > MAX_TEXT_CHARS)) {
    throw fail.invalid('Invalid text');
  }

  const folderId = await resolveFolderId(deps, actor, req.claimId);

  const meta = await deps.drive.getFile(req.fileId);
  if (!meta || meta.trashed || !meta.parents.includes(folderId)) {
    throw fail.invalid('This file does not belong to this claim. Please re-upload it.');
  }
  if (!isAllowedMime(meta.mimeType)) throw fail.invalid('Only JPG, PNG or PDF files can be analysed');
  if (meta.size <= 0 || meta.size > MAX_OCR_BYTES) throw fail.invalid('This file is too large to analyse');

  // 1. On-device OCR text supplied by the app for image attachments: use it directly.
  if (req.text && req.text.trim()) {
    return { suggestion: extractSuggestionFromText(req.text) };
  }

  const isPdf = meta.mimeType === 'application/pdf';
  const data = await deps.drive.download(req.fileId);

  // 2. Document AI, when configured, handles both PDFs and images that arrived without text.
  const viaDocai = await suggestionViaDocai(deps, data, meta.mimeType);
  if (viaDocai) return { suggestion: viaDocai };

  // 3. Free fallback: PDFs can be text-extracted locally; images without text or Document AI
  //    have nothing left to try.
  if (isPdf) {
    let pdfText: string;
    try {
      pdfText = await extractPdfText(data);
    } catch (e) {
      console.error('[analyzeAttachment] PDF text extraction failed', req.claimId, req.fileId, e);
      throw fail.ocrFailed();
    }
    return { suggestion: extractSuggestionFromText(pdfText) };
  }

  return { suggestion: {} };
}
