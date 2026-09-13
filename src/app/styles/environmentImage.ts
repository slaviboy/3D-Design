import type { FileTypeFilter } from '../../io/fs/types';

/** Largest environment image accepted from a local file. */
export const MAX_ENVIRONMENT_IMAGE_BYTES = 64 * 1024 * 1024;

export const HDR_FILTER: FileTypeFilter = {
  description: 'Radiance HDR image',
  mimeType: 'image/vnd.radiance',
  extensions: ['.hdr'],
};

/** Whether bytes start like a Radiance HDR file (`#?RADIANCE` or `#?RGBE`). The renderer does the full parse. */
export function isRadianceHeader(bytes: Uint8Array): boolean {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 16));
  return head.startsWith('#?RADIANCE') || head.startsWith('#?RGBE');
}
