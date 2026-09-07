import { loadImage, renderBlob, calcAspectFit, cropSourceDims } from './engine';
import type { Dimensions, SourceRect } from './engine';
import type { OutputFormat } from './format';

/**
 * Compress — hit a target file size by searching encoder quality, then stepping
 * dimensions down only if even minimum quality overshoots.
 *
 * The search is deliberately pure / injectable: `findLargestFit` takes an
 * `encode` function so the iteration logic can be reasoned about and tested
 * without a DOM. The browser entry point wires it to canvas + toBlob.
 */

export interface CompressOptions {
  targetKB: number;
  format: OutputFormat;
  /** Highest quality the encode loop reports, 1..100. */
  maxQuality?: number;
  /** Optional source-region crop, normalized 0..1. */
  sourceRect?: SourceRect;
}

export interface CompressResult {
  blob: Blob;
  width: number;
  height: number;
  /** True when dimension stepping kicked in (min quality wasn't enough). */
  reducedDimensions: boolean;
  /** The quality the winning encode used, 1..maxQuality. */
  quality: number;
}

export interface EncodeArgs extends Dimensions {
  quality: number;
}

export type Encoder = (args: EncodeArgs) => Promise<Blob>;

/** Bytes that fit the target (targetKB × 1024) with a small tolerance margin. */
function byteBudget(targetKB: number): number {
  return Math.max(1, Math.round(targetKB * 1024));
}

/**
 * Largest quality in [1, maxQuality] whose encode stays within budget. Assumes
 * size is roughly monotonic in quality (true for jpeg/webp in practice).
 */
export async function findLargestFit(
  encode: Encoder,
  width: number,
  height: number,
  budget: number,
  maxQuality = 95
): Promise<{ blob: Blob; quality: number }> {
  const sizeAt = (q: number): Promise<Blob> => encode({ width, height, quality: q });

  // Fast path: the best quality already fits.
  const best = await sizeAt(maxQuality);
  if (best.size <= budget) return { blob: best, quality: maxQuality };

  // Fast path: even the worst quality overshoots → caller should step dimensions.
  const worst = await sizeAt(1);
  if (worst.size > budget) return { blob: worst, quality: 1 };

  // Binary search for the largest quality whose size still fits. `worst` (q=1)
  // already fits here, so any stored candidate is valid — `lo` finalizes to it.
  let lo = 1;
  let hi = maxQuality;
  let candidate = worst;

  while (lo < hi) {
    const mid = Math.round((lo + hi) / 2);
    const blob = await sizeAt(mid);
    if (blob.size <= budget) {
      candidate = blob;
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  return { blob: candidate, quality: lo };
}

export interface SteppingResult {
  blob: Blob;
  width: number;
  height: number;
  reduced: boolean;
  quality: number;
}

/**
 * Drive the size down to the smallest dimension that still fits the budget.
 * Returns immediately when a candidate fits; stops at minPixels to avoid
 * producing an unusably tiny image. The caller (browser glue) surfaces this
 * gracefully.
 */
export async function stepDownToBudget(
  encode: Encoder,
  original: Dimensions,
  budget: number,
  opts: { maxQuality?: number; minPixels?: number; step?: number; maxSteps?: number } = {}
): Promise<SteppingResult> {
  const {
    maxQuality = 95,
    minPixels = 1600, // roughly 40×40 — nothing below this is worth outputting
    step = 0.9,
    maxSteps = 24,
  } = opts;

  let { width, height } = original;
  let reduced = false;

  for (let i = 0; i < maxSteps; i++) {
    const fit = await findLargestFit(encode, width, height, budget, maxQuality);
    if (fit.blob.size <= budget) {
      return { blob: fit.blob, width, height, reduced, quality: fit.quality };
    }
    // Stepped too far down already — just return the last attempt.
    if (width * height <= minPixels) return { blob: fit.blob, width, height, reduced, quality: fit.quality };

    const next = {
      width: Math.max(1, Math.round(width * step)),
      height: Math.max(1, Math.round(height * step)),
    };
    reduced = wOrHChanged(original, next);
    width = next.width;
    height = next.height;
  }

  const fit = await findLargestFit(encode, width, height, budget, maxQuality);
  return { blob: fit.blob, width, height, reduced, quality: fit.quality };
}

function wOrHChanged(original: Dimensions, next: Dimensions): boolean {
  return next.width < original.width || next.height < original.height;
}

/**
 * Browser entry point: encodes against canvas at the given dimensions+quality,
 * then searches quality and (if needed) dimensions until the target fits.
 */
export async function compressToTarget(
  src: string,
  options: CompressOptions
): Promise<CompressResult> {
  const { targetKB, format, maxQuality = 95, sourceRect } = options;
  const img = await loadImage(src);
  const original = cropSourceDims(img.naturalWidth, img.naturalHeight, sourceRect);
  const budget = byteBudget(targetKB);

  const encode: Encoder = async ({ width, height, quality }) =>
    renderBlob(img, { width, height, format, quality: quality / 100, fit: 'fill', sourceRect });

  const winning = await stepDownToBudget(encode, original, budget, { maxQuality });

  return {
    blob: winning.blob,
    width: winning.width,
    height: winning.height,
    reducedDimensions: winning.reduced,
    quality: winning.quality,
  };
}

/** For the Convert tool — map a friendly quality label to an encoder quality. */
export function qualityToValue(level: 'high' | 'balanced' | 'small'): number {
  if (level === 'high') return 0.92;
  if (level === 'small') return 0.6;
  return 0.8;
}