import * as DocumentPicker from 'expo-document-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from '@jep/shared';
import { classifySharedFiles, type IncomingFile } from '../share/handoff';
import { newKey, type LocalAttachment } from './types';

const MAX_EDGE = 2000;

async function sizeOf(uri: string): Promise<number> {
  return (await (await fetch(uri)).blob()).size;
}

async function compressImage(asset: { uri: string; width: number; height: number }): Promise<string> {
  const ctx = ImageManipulator.manipulate(asset.uri);
  if (Math.max(asset.width, asset.height) > MAX_EDGE) {
    ctx.resize(asset.width >= asset.height ? { width: MAX_EDGE } : { height: MAX_EDGE });
  }
  const image = await ctx.renderAsync();
  const saved = await image.saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
  return saved.uri;
}

async function fromImageAssets(assets: ImagePicker.ImagePickerAsset[]): Promise<LocalAttachment[]> {
  const out: LocalAttachment[] = [];
  for (const [i, a] of assets.entries()) {
    const uri = await compressImage(a);
    const size = await sizeOf(uri);
    if (size > MAX_ATTACHMENT_BYTES) {
      Alert.alert('File too large', 'This photo is larger than 10MB even after compression.');
      continue;
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
    out.push({ key: newKey(), kind: 'local', uri, name: `receipt-${stamp}-${i + 1}.jpg`, mimeType: 'image/jpeg', size });
  }
  return out;
}

export async function pickFromCamera(): Promise<LocalAttachment[]> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    Alert.alert('Camera permission needed', 'Allow camera access in Settings to photograph receipts.');
    return [];
  }
  const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
  return res.canceled ? [] : fromImageAssets(res.assets);
}

export async function pickFromLibrary(limit: number): Promise<LocalAttachment[]> {
  if (limit <= 0) return [];
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: limit,
    quality: 1,
  });
  return res.canceled ? [] : fromImageAssets(res.assets.slice(0, limit));
}

export async function pickPdfs(limit: number): Promise<LocalAttachment[]> {
  if (limit <= 0) return [];
  const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', multiple: true, copyToCacheDirectory: true });
  if (res.canceled) return [];
  if (res.assets.length > limit) {
    Alert.alert('Too many files', `You can attach up to ${MAX_ATTACHMENTS} receipts. Only the first ${limit} were added.`);
  }
  const out: LocalAttachment[] = [];
  for (const a of res.assets.slice(0, limit)) {
    const size = a.size ?? (await sizeOf(a.uri));
    if (size > MAX_ATTACHMENT_BYTES) {
      Alert.alert('File too large', `${a.name} is larger than 10MB.`);
      continue;
    }
    out.push({ key: newKey(), kind: 'local', uri: a.uri, name: a.name, mimeType: 'application/pdf', size });
  }
  return out;
}

/**
 * Turns files shared from another app into attachments: images re-encoded as JPG (and shrunk like picked
 * photos), PDFs as they are. Files that can't be attached, or are over 10MB, are skipped with a message.
 */
export async function fromSharedFiles(files: IncomingFile[]): Promise<LocalAttachment[]> {
  const { images, pdfs, unsupported } = classifySharedFiles(files);
  const skipped = unsupported.map((n) => `${n} (only photos and PDFs)`);
  const out: LocalAttachment[] = [];
  for (const f of [...images, ...pdfs]) {
    const base = (f.fileName ?? 'file').replace(/\.[^.]+$/, '') || 'file';
    try {
      if (f.mimeType === 'application/pdf') {
        const size = f.size ?? (await sizeOf(f.path));
        if (size > MAX_ATTACHMENT_BYTES) {
          skipped.push(`${f.fileName ?? 'PDF'} (larger than 10MB)`);
          continue;
        }
        out.push({ key: newKey(), kind: 'local', uri: f.path, name: `${base}.pdf`, mimeType: 'application/pdf', size });
      } else {
        const uri = await compressImage({ uri: f.path, width: f.width ?? 0, height: f.height ?? 0 });
        const size = await sizeOf(uri);
        if (size > MAX_ATTACHMENT_BYTES) {
          skipped.push(`${f.fileName ?? 'photo'} (larger than 10MB)`);
          continue;
        }
        out.push({ key: newKey(), kind: 'local', uri, name: `${base}.jpg`, mimeType: 'image/jpeg', size });
      }
    } catch {
      skipped.push(`${f.fileName ?? 'file'} (could not be read)`);
    }
  }
  if (skipped.length) Alert.alert('Some files were not added', skipped.join('\n'));
  return out;
}
