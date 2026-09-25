/** Copies a Uint8Array view into a standalone ArrayBuffer (a BodyInit that TS accepts). */
export function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}
