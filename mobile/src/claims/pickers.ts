import * as DocumentPicker from 'expo-document-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';
import { MAX_ATTACHMENT_BYTES } from '@jep/shared';
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
