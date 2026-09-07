import { formatFileSize, EXT_BY_FORMAT } from './format';
import type { OutputFormat } from './format';

/**
 * Result — drives the ResultPanel component from a tool-page script.
 *
 * Handles the blob object URL lifecycle (revokes the previous result URL when
 * a new one is shown, and again on clear) so we never leak URLs.
 */

export interface ResultData {
  /** Blob URL of the processed result (what the Download button saves). */
  blob: Blob;
  /** Original filename, used to derive the download name. */
  fileName: string;
  width: number;
  height: number;
  format: OutputFormat;
  /** Optional callout, e.g. "reduced 87% · dimensions also shrunk". */
  summary?: string;
}

function toBlobUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}

/**
 * Populate the ResultPanel under `root` (the UploadPanel element) with a result.
 * Returns the blob URL so the caller can later revoke it via clearResult.
 */
export function showResult(uploadRoot: HTMLElement, data: ResultData): string {
  const panel = uploadRoot.querySelector<HTMLElement>('[data-result]');
  const img = uploadRoot.querySelector<HTMLImageElement>('[data-result-img]');
  const meta = uploadRoot.querySelector<HTMLElement>('[data-result-meta-text]');
  const summary = uploadRoot.querySelector<HTMLElement>('[data-result-summary]');
  const summaryText = uploadRoot.querySelector<HTMLElement>('[data-result-summary-text]');
  const link = uploadRoot.querySelector<HTMLAnchorElement>('[data-result-download]');
  const ext = uploadRoot.querySelector<HTMLElement>('[data-result-ext]');
  const error = uploadRoot.querySelector<HTMLElement>('[data-result-error]');

  if (!panel || !img || !meta || !link || !ext) return '';

  // Revoke the previous result URL before replacing it.
  const previous = link.dataset.resultUrl;
  if (previous) URL.revokeObjectURL(previous);

  const url = toBlobUrl(data.blob);
  const extension = EXT_BY_FORMAT[data.format];

  img.src = url;
  meta.textContent = `${data.fileName} · ${data.width} × ${data.height} · ${formatFileSize(data.blob.size)}`;
  link.href = url;
  link.download = `${data.fileName.replace(/\.[^.]+$/, '')}.${extension}`;
  link.dataset.resultUrl = url;
  ext.textContent = extension;

  if (summary && summaryText) {
    summary.hidden = !data.summary;
    if (data.summary) summaryText.textContent = data.summary;
  }

  if (error) error.hidden = true;
  panel.hidden = false;

  return url;
}

/** Hides the result card and revokes any live blob URL it holds. */
export function clearResult(uploadRoot: HTMLElement): void {
  const panel = uploadRoot.querySelector<HTMLElement>('[data-result]');
  const link = uploadRoot.querySelector<HTMLAnchorElement>('[data-result-download]');
  const img = uploadRoot.querySelector<HTMLImageElement>('[data-result-img]');
  const error = uploadRoot.querySelector<HTMLElement>('[data-result-error]');

  if (link?.dataset.resultUrl) URL.revokeObjectURL(link.dataset.resultUrl);
  delete link?.dataset.resultUrl;
  if (img) img.removeAttribute('src');
  if (error) error.hidden = true;
  if (panel) panel.hidden = true;
}

/** Shows an inline error message on the ResultPanel, hiding the card. */
export function showError(uploadRoot: HTMLElement, message: string): void {
  const panel = uploadRoot.querySelector<HTMLElement>('[data-result]');
  const error = uploadRoot.querySelector<HTMLElement>('[data-result-error]');
  if (panel) panel.hidden = false;
  if (error) {
    error.textContent = message;
    error.hidden = false;
  }
}