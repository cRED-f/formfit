import { loadImage, calcAspectFit, cropBounds } from './engine';
import type { SourceRect } from './engine';
import { MIME_BY_FORMAT } from './format';
import type { OutputFormat } from './format';

/**
 * Signature — crop empty space, fit, and re-encode to a small file.
 *
 * Ink detection uses a luminance threshold against near-white paper pixels.
 * Padding around the crop keeps a natural margin in the output frame.
 */

export interface SignatureOptions {
  /** Output width (px). Default 300 if not provided. */
  width?: number;
  /** Output height (px). Default 80 if not provided. */
  height?: number;
  /** Hard file-size ceiling (KB). We step quality down to hit it; warn if impossible. */
  maxKB?: number;
  background: 'original' | 'white' | 'transparent';
  /** Optional source-region crop, normalized 0..1. Applied before ink detection. */
  sourceRect?: SourceRect;
}

export interface SignatureResult {
  blob: Blob;
  width: number;
  height: number;
  /** True when the source was taller/wider than the target and content was scaled down. */
  scaled: boolean;
  /** Whether the output required the quality stepping-down process. */
  reducedQuality: boolean;
}

// ---- Ink detection ---------------------------------------------------------

/** Threshold below which a pixel is considered transparent (for PNG alpha detection). */
const ALPHA_FLOOR = 30;

/**
 * Estimate the background color of a flattened image (e.g. a photo of a
 * signature on paper) by averaging the opaque region around the edge. Returns
 * null when the border is mostly transparent or too dark/busy to be paper, so
 * callers can fall back to plain white.
 */
function samplePaperColor(img: HTMLImageElement): string | null {
  const S = 64;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, S, S);
  const data = ctx.getImageData(0, 0, S, S).data;

  const ring = 4;
  const borderTotal = S * S - (S - ring * 2) * (S - ring * 2);
  let r = 0, g = 0, b = 0, opaque = 0;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const onRing = x < ring || y < ring || x >= S - ring || y >= S - ring;
      if (!onRing) continue;
      const i = (y * S + x) * 4;
      if (data[i + 3] < 200) continue; // transparent border — not solid paper
      r += data[i]; g += data[i + 1]; b += data[i + 2]; opaque++;
    }
  }
  // The border must be mostly opaque (paper fills the frame) and reasonably light.
  if (opaque / borderTotal < 0.6) return null;
  const R = Math.round(r / opaque), G = Math.round(g / opaque), B = Math.round(b / opaque);
  const luminance = 0.299 * R + 0.587 * G + 0.114 * B;
  if (luminance < 180) return null; // too dark/busy an edge to call "paper"
  return `rgb(${R}, ${G}, ${B})`;
}

/** Pixels brighter than this on all three channels are treated as "paper". */
const NEAR_WHITE = 235;

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function bboxEmpty(bbox: BBox): boolean {
  return bbox.maxX < bbox.minX || bbox.maxY < bbox.minY;
}

/**
 * Find the bounding box of all non-paper pixels in the image data. Transparent
 * regions (alpha < ALPHA_FLOOR) are treated as paper, and near-white opaque
 * pixels are treated as paper.
 */
function detectInkBBox(imageData: ImageData): BBox {
  const { data, width, height } = imageData;
  const box: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (a < ALPHA_FLOOR) continue; // transparent — ignore
      if (r > NEAR_WHITE && g > NEAR_WHITE && b > NEAR_WHITE) continue; // near-white — ignore
      if (x < box.minX) box.minX = x;
      if (y < box.minY) box.minY = y;
      if (x > box.maxX) box.maxX = x;
      if (y > box.maxY) box.maxY = y;
    }
  }

  return box;
}

/** Expand the bounding box by a small padding so ink doesn't clip the frame. */
function padBBox(bbox: BBox, imgW: number, imgH: number, paddingFraction = 0.05): BBox {
  const padX = Math.max(2, Math.round((bbox.maxX - bbox.minX) * paddingFraction));
  const padY = Math.max(2, Math.round((bbox.maxY - bbox.minY) * paddingFraction));
  return {
    minX: Math.max(0, bbox.minX - padX),
    minY: Math.max(0, bbox.minY - padY),
    maxX: Math.min(imgW - 1, bbox.maxX + padX),
    maxY: Math.min(imgH - 1, bbox.maxY + padY),
  };
}

// ---- Core pipeline ---------------------------------------------------------

/**
 * Draw the image into a canvas, optionally clipping to a user crop rect first.
 * Returns the canvas so callers can read pixel data or draw further.
 */
function drawSourceRegion(
  img: HTMLImageElement,
  sourceRect?: SourceRect
): HTMLCanvasElement {
  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;
  const { sx, sy, sw, sh } = cropBounds(srcW, srcH, sourceRect);

  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas;
}

/**
 * Detect the ink bounding box within a canvas (assumed to be the source region).
 * Returns pixel bounds, padded, in the canvas's coordinate space.
 */
function detectInkInCanvas(canvas: HTMLCanvasElement): { box: BBox; w: number; h: number } {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.getImageData(0, 0, w, h);

  const rawBox = detectInkBBox(imageData);
  const box = bboxEmpty(rawBox)
    ? { minX: 0, minY: 0, maxX: w - 1, maxY: h - 1 }
    : padBBox(rawBox, w, h);

  return { box, w, h };
}

export async function prepareSignature(
  src: string,
  opts: SignatureOptions = {}
): Promise<SignatureResult> {
  const {
    width: outW = 300,
    height: outH = 80,
    maxKB = 20,
    background,
    sourceRect,
  } = opts;

  const img = await loadImage(src);

  // 1. Draw the user-cropped region (or full source) into a canvas.
  const srcCanvas = drawSourceRegion(img, sourceRect);

  // 2. Detect ink bounding box within that region.
  const { box } = detectInkInCanvas(srcCanvas);

  const cropW = box.maxX - box.minX + 1;
  const cropH = box.maxY - box.minY + 1;

  // 3. Draw the ink-cropped region into a small working canvas.
  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = cropW;
  cropCanvas.height = cropH;
  const cropCtx = cropCanvas.getContext('2d')!;
  cropCtx.drawImage(srcCanvas, box.minX, box.minY, cropW, cropH, 0, 0, cropW, cropH);

  // 4. Fit the crop into the output frame (contain, centered).
  const fit = calcAspectFit({ width: cropW, height: cropH }, { width: outW, height: outH });

  // 5. Encode with the right format + background.
  const isTransparent = background === 'transparent';
  const format: OutputFormat = isTransparent ? 'png' : 'jpeg';

  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = outW;
  outputCanvas.height = outH;
  const outCtx = outputCanvas.getContext('2d')!;

  if (isTransparent) {
    outCtx.clearRect(0, 0, outW, outH);
  } else {
    outCtx.fillStyle = background === 'original' ? (samplePaperColor(img) ?? '#ffffff') : '#ffffff';
    outCtx.fillRect(0, 0, outW, outH);
  }

  outCtx.drawImage(cropCanvas, (outW - fit.width) / 2, (outH - fit.height) / 2, fit.width, fit.height);

  const scaled = fit.width < cropW || fit.height < cropH;

  // 6. Encode at full quality first, then step down until we hit maxKB.
  let quality = 0.92;
  let blob = await canvasToBlob(outputCanvas, MIME_BY_FORMAT[format], quality);
  let reducedQuality = false;

  if (format === 'jpeg') {
    const limit = maxKB * 1024;
    while (blob.size > limit && quality > 0.2) {
      reducedQuality = true;
      quality -= 0.1;
      blob = await canvasToBlob(outputCanvas, MIME_BY_FORMAT[format], quality);
    }
  }

  return { blob, width: outW, height: outH, scaled, reducedQuality };
}

/**
 * Lightweight preview for the signature — capped to 360px, no quality stepping.
 * Used by the live preview panel so the user sees ink-detect + fit in real time.
 */
export async function previewSignature(
  src: string,
  opts: { width?: number; height?: number; background: SignatureOptions['background']; sourceRect?: SourceRect }
): Promise<{ blob: Blob; width: number; height: number }> {
  const {
    width: outW = 300,
    height: outH = 80,
    background,
    sourceRect,
  } = opts;

  const img = await loadImage(src);

  // 1. Draw user-cropped region.
  const srcCanvas = drawSourceRegion(img, sourceRect);

  // 2. Detect ink within that region.
  const { box } = detectInkInCanvas(srcCanvas);

  const cropW = box.maxX - box.minX + 1;
  const cropH = box.maxY - box.minY + 1;

  // 3. Draw ink-cropped region.
  const cropCanvas = document.createElement('canvas');
  cropCanvas.width = cropW;
  cropCanvas.height = cropH;
  const cropCtx = cropCanvas.getContext('2d')!;
  cropCtx.drawImage(srcCanvas, box.minX, box.minY, cropW, cropH, 0, 0, cropW, cropH);

  // 4. Fit into output frame.
  const fit = calcAspectFit({ width: cropW, height: cropH }, { width: outW, height: outH });

  // 5. Render preview (capped to 360px).
  const scale = Math.min(1, 360 / outW, 360 / outH);
  const pw = Math.max(1, Math.round(outW * scale));
  const ph = Math.max(1, Math.round(outH * scale));

  const isTransparent = background === 'transparent';
  const format: OutputFormat = isTransparent ? 'png' : 'jpeg';

  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = pw;
  outputCanvas.height = ph;
  const outCtx = outputCanvas.getContext('2d')!;

  if (isTransparent) {
    outCtx.clearRect(0, 0, pw, ph);
  } else {
    outCtx.fillStyle = background === 'original' ? (samplePaperColor(img) ?? '#ffffff') : '#ffffff';
    outCtx.fillRect(0, 0, pw, ph);
  }

  // Scale fit dimensions to preview size.
  const pFitW = Math.round(fit.width * scale);
  const pFitH = Math.round(fit.height * scale);
  outCtx.drawImage(cropCanvas, (pw - pFitW) / 2, (ph - pFitH) / 2, pFitW, pFitH);

  const blob = await canvasToBlob(outputCanvas, MIME_BY_FORMAT[format], 0.85);
  return { blob, width: pw, height: ph };
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Encoding failed.'))),
      mime,
      quality
    );
  });
}

/** Returns a download-ready base name for a signature result (extension is appended by the UI). */
export function signatureFileName(originalName: string): string {
  const dot = originalName.lastIndexOf('.');
  const base = dot > 0 ? originalName.slice(0, dot) : originalName;
  return `${base}-signature`;
}