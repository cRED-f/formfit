/** Format — output-format identity and human-readable size helpers. */

export type OutputFormat = 'jpeg' | 'png' | 'webp';

/** Browser MIME for each output format. Kept in sync with the Select options in tool pages. */
export const MIME_BY_FORMAT: Record<OutputFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** File extension for each output format. */
export const EXT_BY_FORMAT: Record<OutputFormat, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
};

/** Human-readable size, e.g. 48 KB or 2.1 MB. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes >= 1_048_576) {
    return `${(bytes / 1_048_576).toFixed(bytes >= 10_485_760 ? 0 : 1)} MB`;
  }
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** Strips the extension from a filename: "photo.jpg" → "photo". */
export function baseName(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(0, dot) : filename;
}