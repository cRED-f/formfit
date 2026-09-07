import { MIME_BY_FORMAT } from './format';
import type { OutputFormat } from './format';

/** Core canvas pipeline. All functions run in the browser only — no server. */

export interface Source {
  /** Object URL (or any img-eligible string) of the image to process. */
  src: string;
  /** Original filename, used to derive output names. */
  fileName: string;
}

export interface Dimensions {
  width: number;
  height: number;
}

export type FitMode = 'fill' | 'contain';

/** Normalized crop rectangle relative to the source image, each value 0..1. */
export interface SourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** True when the rect spans the full source frame (i.e. "no crop"). */
export function isFullRect(r: SourceRect | undefined): boolean {
  if (!r) return true;
  return r.x <= 0 && r.y <= 0 && r.width >= 1 && r.height >= 1;
}

/** Pixel bounds {sx, sy, sw, sh} for a cropped draw of a natural-width/height image. */
export function cropBounds(
  imgW: number,
  imgH: number,
  rect?: SourceRect
): { sx: number; sy: number; sw: number; sh: number } {
  if (!rect || isFullRect(rect)) return { sx: 0, sy: 0, sw: imgW, sh: imgH };
  const sx = Math.round(rect.x * imgW);
  const sy = Math.round(rect.y * imgH);
  const sw = Math.max(1, Math.round(rect.width * imgW));
  const sh = Math.max(1, Math.round(rect.height * imgH));
  return { sx, sy, sw, sh };
}

/** Source pixel dimensions of the crop region (min 1×1). */
export function cropSourceDims(
  imgW: number,
  imgH: number,
  rect?: SourceRect
): Dimensions {
  const { sw, sh } = cropBounds(imgW, imgH, rect);
  return { width: sw, height: sh };
}

export interface RenderOptions extends Dimensions {
  format: OutputFormat;
  /** 0..1 for jpeg/webp; ignored for png. */
  quality?: number;
  /** Background painted behind the image for non-transparent formats. Defaults to white. */
  backgroundColor?: string;
  /** How the image is placed in the frame. `fill` stretches to exact w×h, `contain` fits + centers. */
  fit?: FitMode;
  /** Optional source-region crop, normalized 0..1. Omit for the full image. */
  sourceRect?: SourceRect;
}

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Loads a src string into a decoded HTMLImageElement. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('We couldn\'t decode this image. Try a JPG, PNG, or WebP.'));
    img.src = src;
  });
}

/** Largest size that fits the image inside the given box, preserving aspect ratio. */
export function calcAspectFit(original: Dimensions, box: Dimensions): Dimensions {
  const scale = Math.min(
    box.width / original.width,
    box.height / original.height,
    1 // never upscale beyond the source
  );
  return {
    width: Math.max(1, Math.round(original.width * scale)),
    height: Math.max(1, Math.round(original.height * scale)),
  };
}

/**
 * Draws an image into a canvas context with fit, background, and optional source crop.
 * This is the single place that owns fit + crop math — used by both renderBlob and live preview.
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  width: number,
  height: number,
  opts: { fit?: FitMode; sourceRect?: SourceRect; backgroundColor?: string; format?: OutputFormat }
): void {
  const { sx, sy, sw, sh } = cropBounds(img.naturalWidth, img.naturalHeight, opts.sourceRect);

  if (opts.format !== 'png') {
    ctx.fillStyle = opts.backgroundColor ?? '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }

  if (opts.fit === 'contain') {
    const fit = calcAspectFit({ width: sw, height: sh }, { width, height });
    ctx.drawImage(img, sx, sy, sw, sh, (width - fit.width) / 2, (height - fit.height) / 2, fit.width, fit.height);
  } else {
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);
  }
}

/**
 * Renders an image into a canvas of the exact requested dimensions and encodes it.
 * `fit: 'fill'` stretches to fill the frame (exact w×h output); `'contain'` fits
 * the whole image inside it, letterboxed. Everything off-canvas is painted with
 * `backgroundColor` (white by default) for formats without alpha.
 */
export async function renderBlob(img: HTMLImageElement, opts: RenderOptions): Promise<Blob> {
  const width = Math.max(1, Math.round(opts.width));
  const height = Math.max(1, Math.round(opts.height));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas isn\'t available in this browser.');

  drawFrame(ctx, img, width, height, {
    fit: opts.fit,
    sourceRect: opts.sourceRect,
    backgroundColor: opts.backgroundColor,
    format: opts.format,
  });

  const mime = MIME_BY_FORMAT[opts.format];
  return canvasToBlob(canvas, mime, opts.quality);
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Encoding failed — this browser may not support that format.'))),
      mime,
      quality
    );
  });
}

/** Same as renderBlob but loads its own source, for one-shot conversions. */
export async function convertSource(options: RenderOptions & Source): Promise<{ blob: Blob; width: number; height: number }> {
  const img = await loadImage(options.src);
  const blob = await renderBlob(img, options);
  return { blob, width: options.width, height: options.height };
}

/** Returns an error message when a File can't be used for the tool, else null. */
export function validateImage(file: File): string | null {
  if (!file.type.startsWith('image/')) return 'That doesn\'t look like an image.';
  if (file.size > MAX_FILE_BYTES) return 'That image is bigger than 25 MB — please pick a smaller one.';
  return null;
}

/** Triggers a browser download of the blob. Cleaned up shortly after. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}