import { loadImage, renderBlob, isFullRect, cropSourceDims } from './engine';
import type { SourceRect } from './engine';
import { baseName } from './format';
import type { OutputFormat } from './format';
import { compressToTarget, qualityToValue } from './compress';
import { prepareSignature, signatureFileName } from './signature';
import { showResult, clearResult, showError } from './result';
import type { ResultData } from './result';
import { mountCrop } from './crop';
import { mountResizePreview, mountSignaturePreview } from './preview';

/**
 * tools — mounts each tool's behaviour onto an UploadPanel root.
 *
 * A single UploadPanel emits `formfit:file-ready`; each tool listens, keeps the
 * decoded source, and on its Run button produces a `ResultData` shown in the
 * ResultPanel. `prefix` distinguishes the standalone tool pages ('') from the
 * homepage's inline panels ('home-') so control ids resolve per instance.
 */

interface SourceCtx {
  file: File;
  src: string;
  width: number;
  height: number;
  crop?: SourceRect;
}

const MAX_PIXELS = 40_000_000; // guard against canvas memory blow-ups (~40 MP)
const MAX_DIM = 12_000;

function el<T extends Element>(root: HTMLElement, id: string): T | null {
  return root.querySelector<T>(`#${id}`);
}
function qs<T extends Element>(root: HTMLElement, selector: string): T | null {
  return root.querySelector<T>(selector);
}
function num(root: HTMLElement, id: string): number {
  const raw = el<HTMLInputElement>(root, id)?.value.trim() ?? '';
  const value = parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Disables the Run button and swaps its label (icon + text) while busy. */
function bindBusy(runBtn: HTMLButtonElement): (busy: boolean) => void {
  const idleInner = runBtn.innerHTML;
  return (busy: boolean) => {
    runBtn.disabled = busy;
    runBtn.innerHTML = busy ? 'Preparing…' : idleInner;
  };
}

function assertSaneDimensions(w: number, h: number): void {
  if (w * h > MAX_PIXELS || w > MAX_DIM || h > MAX_DIM) {
    throw new Error('That size is too large to process. Pick something under 12,000 px per side.');
  }
}

/** Wires up the shared bits: file-ready capture, Run button, Clear button, crop. */
function mount(
  root: HTMLElement,
  runBtn: HTMLButtonElement,
  onFileReady: (ctx: SourceCtx) => void,
  onRun: (ctx: SourceCtx) => Promise<void>,
  onChange?: (ctx: SourceCtx) => void
): () => SourceCtx | null {
  let ctx: SourceCtx | null = null;
  const setBusy = bindBusy(runBtn);

  root.addEventListener('formfit:file-ready', (e) => {
    const { file, objectUrl, width, height } = (e as CustomEvent).detail as {
      file: File;
      objectUrl: string;
      width: number;
      height: number;
    };
    ctx = { file, src: objectUrl, width, height };
    clearResult(root);
    onFileReady(ctx);
  });

  root.addEventListener('formfit:file-cleared', () => {
    ctx = null;
  });

  // Wire crop — updates ctx.crop and triggers onChange for live preview.
  mountCrop(root, (rect) => {
    if (!ctx) return;
    ctx.crop = isFullRect(rect) ? undefined : rect;
    onChange?.(ctx);
  });

  runBtn.addEventListener('click', async () => {
    if (!ctx) {
      showError(root, 'Upload an image first — click, drop, or paste one above.');
      return;
    }
    clearResult(root);
    setBusy(true);
    try {
      await onRun(ctx);
    } catch (err) {
      showError(root, err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  });

  root.querySelector<HTMLButtonElement>('[data-result-clear]')?.addEventListener('click', () => {
    clearResult(root);
  });

  /** Read the live source (used by preview mounts). */
  return () => ctx;
}

// ---- Resize -----------------------------------------------------------------

export function mountResize(root: HTMLElement, prefix = ''): void {
  const widthInput = el<HTMLInputElement>(root, `${prefix}resize-width`);
  const heightInput = el<HTMLInputElement>(root, `${prefix}resize-height`);
  const aspectLock = el<HTMLInputElement>(root, `${prefix}resize-aspect`);
  const formatSelect = el<HTMLSelectElement>(root, `${prefix}resize-format`);
  const runBtn = qs<HTMLButtonElement>(root, `[data-run="${prefix}resize"]`);
  if (!widthInput || !heightInput || !formatSelect || !runBtn) return;

  let natural = { width: 0, height: 0 };

  const syncFromWidth = () => {
    if (!aspectLock?.checked || !natural.width) return;
    const w = num(root, `${prefix}resize-width`);
    if (w) heightInput.value = String(Math.max(1, Math.round((w * natural.height) / natural.width)));
  };
  const syncFromHeight = () => {
    if (!aspectLock?.checked || !natural.height) return;
    const h = num(root, `${prefix}resize-height`);
    if (h) widthInput.value = String(Math.max(1, Math.round((h * natural.width) / natural.height)));
  };
  widthInput.addEventListener('input', syncFromWidth);
  heightInput.addEventListener('input', syncFromHeight);

  const getCtx = mount(
    root,
    runBtn,
    (ctx) => {
      natural = { width: ctx.width, height: ctx.height };
      widthInput.value = String(ctx.width);
      heightInput.value = String(ctx.height);
    },
    async (ctx) => {
      if (aspectLock?.checked && natural.width) {
        const w = num(root, `${prefix}resize-width`);
        const h = num(root, `${prefix}resize-height`);
        if (w && !h) heightInput.value = String(Math.max(1, Math.round((w * natural.height) / natural.width)));
        if (h && !w) widthInput.value = String(Math.max(1, Math.round((h * natural.width) / natural.height)));
      }
      const w = num(root, `${prefix}resize-width`);
      const h = num(root, `${prefix}resize-height`);
      if (!w || !h) throw new Error('Enter a width and height in pixels.');
      assertSaneDimensions(w, h);

      const format = formatSelect.value as OutputFormat;
      const img = await loadImage(ctx.src);
      const blob = await renderBlob(img, {
        width: w,
        height: h,
        format,
        quality: 0.9,
        fit: 'fill',
        sourceRect: ctx.crop,
      });

      const result: ResultData = {
        blob,
        fileName: `${baseName(ctx.file.name)}-resized`,
        width: w,
        height: h,
        format,
      };
      showResult(root, result);
    }
  );

  mountResizePreview(root, prefix, getCtx);
}

// ---- Compress ---------------------------------------------------------------

export function mountCompress(root: HTMLElement, prefix = ''): void {
  const targetInput = el<HTMLInputElement>(root, `${prefix}compress-target`);
  const formatSelect = el<HTMLSelectElement>(root, `${prefix}compress-format`);
  const runBtn = qs<HTMLButtonElement>(root, `[data-run="${prefix}compress"]`);
  if (!targetInput || !formatSelect || !runBtn) return;

  mount(
    root,
    runBtn,
    () => {
      /* no prefill needed */
    },
    async (ctx) => {
      let targetKB = num(root, `${prefix}compress-target`);
      if (!targetKB) throw new Error('Enter a target file size in KB.');
      targetKB = Math.min(targetKB, 1000);

      const format = formatSelect.value as OutputFormat;
      const result = await compressToTarget(ctx.src, { targetKB, format, sourceRect: ctx.crop });

      const saved = Math.round((1 - result.blob.size / ctx.file.size) * 100);
      const summary = result.reducedDimensions
        ? `Too big even at minimum quality — resized to ${result.width} × ${result.height}`
        : saved > 0
          ? `Reduced ${saved}% — no quality lost below the limit`
          : undefined;

      const data: ResultData = {
        blob: result.blob,
        fileName: `${baseName(ctx.file.name)}-compressed`,
        width: result.width,
        height: result.height,
        format,
        summary,
      };
      showResult(root, data);
    }
  );
}

// ---- Signature --------------------------------------------------------------

export function mountSignature(root: HTMLElement, prefix = ''): void {
  const widthInput = el<HTMLInputElement>(root, `${prefix}sig-width`);
  const heightInput = el<HTMLInputElement>(root, `${prefix}sig-height`);
  const kbInput = el<HTMLInputElement>(root, `${prefix}sig-kb`);
  const bgSelect = el<HTMLSelectElement>(root, `${prefix}sig-background`);
  const runBtn = qs<HTMLButtonElement>(root, `[data-run="${prefix}signature"]`);
  if (!widthInput || !heightInput || !kbInput || !bgSelect || !runBtn) return;

  const getCtx = mount(
    root,
    runBtn,
    () => {
      /* Keep the user's width/height — only resize prefills from the upload. */
    },
    async (ctx) => {
      const width = num(root, `${prefix}sig-width`) || 300;
      const height = num(root, `${prefix}sig-height`) || 80;
      const maxKB = num(root, `${prefix}sig-kb`) || 20;
      const background = bgSelect.value as 'original' | 'white' | 'transparent';
      assertSaneDimensions(width, height);

      const result = await prepareSignature(ctx.src, { width, height, maxKB, background, sourceRect: ctx.crop });
      const format: OutputFormat = background === 'transparent' ? 'png' : 'jpeg';
      const summary = result.reducedQuality
        ? 'Quality reduced to fit the size limit'
        : result.scaled
          ? 'Cropped, centered, and resized'
          : 'Cropped and centered';

      const data: ResultData = {
        blob: result.blob,
        fileName: signatureFileName(ctx.file.name),
        width: result.width,
        height: result.height,
        format,
        summary,
      };
      showResult(root, data);
    }
  );

  mountSignaturePreview(root, prefix, getCtx);
}

// ---- Convert ----------------------------------------------------------------

export function mountConvert(root: HTMLElement, prefix = ''): void {
  const formatSelect = el<HTMLSelectElement>(root, `${prefix}conv-format`);
  const qualitySelect = el<HTMLSelectElement>(root, `${prefix}conv-quality`);
  const runBtn = qs<HTMLButtonElement>(root, `[data-run="${prefix}convert"]`);
  if (!formatSelect || !qualitySelect || !runBtn) return;

  mount(
    root,
    runBtn,
    () => {
      /* no prefill needed */
    },
    async (ctx) => {
      const format = formatSelect.value as OutputFormat;
      const quality = qualityToValue(qualitySelect.value as 'high' | 'balanced' | 'small');
      const img = await loadImage(ctx.src);
      const blob = await renderBlob(img, {
        width: ctx.width,
        height: ctx.height,
        format,
        quality,
        fit: 'contain',
        sourceRect: ctx.crop,
      });

      const { width, height } = isFullRect(ctx.crop)
        ? { width: ctx.width, height: ctx.height }
        : cropSourceDims(ctx.width, ctx.height, ctx.crop);

      const data: ResultData = {
        blob,
        fileName: `${baseName(ctx.file.name)}-converted`,
        width,
        height,
        format,
      };
      showResult(root, data);
    }
  );
}