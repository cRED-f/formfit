/**
 * Preview — debounced live preview for Resize and Signature tools.
 *
 * Reads the current source ({ src, crop }) from the tool's mount context and
 * re-renders whenever inputs change or the crop rect moves. Rendering is
 * capped to ~480px — no full-size encode, just a fast draw for feedback.
 */

import { loadImage, drawFrame } from './engine';
import type { SourceRect } from './engine';
import { previewSignature } from './signature';

/** Match tools.ts — refuse previews for huge dimensions. */
const MAX_PIXELS = 40_000_000;
const MAX_DIM = 12_000;

export interface PreviewSource {
  src: string;
  width: number;
  height: number;
  crop?: SourceRect;
}

type GetCtx = () => PreviewSource | null;

const DEBOUNCE_MS = 220;
/** Cap on the preview canvas so drags stay snappy even on huge images. */
const MAX_PREVIEW = 480;

function previewScale(outW: number, outH: number): number {
  return Math.min(1, MAX_PREVIEW / outW, MAX_PREVIEW / outH);
}

function debounce(fn: () => void, ms: number): () => void {
  let t: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (t) clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}

/** Hide or show the preview panel, returning whether it's practical to render. */
function readyPanel(
  panel: HTMLElement | null,
  w: number,
  h: number
): panel is HTMLElement {
  if (!panel) return false;
  if (!w || !h || w * h > MAX_PIXELS || w > MAX_DIM || h > MAX_DIM) {
    panel.hidden = true;
    return false;
  }
  // Panel only appears once a file is loaded (src set).
  panel.hidden = false;
  return true;
}

function setCanvasSize(canvas: HTMLCanvasElement, w: number, h: number): void {
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
}

function setDimLabel(panel: HTMLElement, text: string): void {
  const label = panel.querySelector<HTMLElement>('[data-live-dim]');
  if (label) label.textContent = text;
}

// ---- Resize preview ---------------------------------------------------------

export function mountResizePreview(root: HTMLElement, prefix: string, getCtx: GetCtx): void {
  const panel = root.querySelector<HTMLElement>('[data-live-preview]');
  const canvas = root.querySelector<HTMLCanvasElement>('[data-live-canvas]');
  const widthInput = root.querySelector<HTMLInputElement>(`#${prefix}resize-width`);
  const heightInput = root.querySelector<HTMLInputElement>(`#${prefix}resize-height`);
  const formatSelect = root.querySelector<HTMLSelectElement>(`#${prefix}resize-format`);
  if (!panel || !canvas || !widthInput || !heightInput || !formatSelect) return;

  let img: HTMLImageElement | null = null;
  let generation = 0;

  function numInput(el: HTMLInputElement): number {
    const v = parseInt(el.value.trim(), 10);
    return Number.isFinite(v) && v > 0 ? v : 0;
  }

  const refresh = debounce(async () => {
    const ctx = getCtx();
    if (!ctx) return;
    const w = numInput(widthInput);
    const h = numInput(heightInput);
    if (!readyPanel(panel, w, h)) return;

    const gen = ++generation;
    if (!img) {
      try {
        img = await loadImage(ctx.src);
      } catch {
        panel.hidden = true;
        return;
      }
    }
    if (gen !== generation) return; // a newer render superseded this one

    const scale = previewScale(w, h);
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    setCanvasSize(canvas, cw, ch);

    const imgCtx = canvas.getContext('2d');
    if (!imgCtx) return;
    drawFrame(imgCtx, img, cw, ch, {
      fit: 'fill',
      sourceRect: ctx.crop,
      backgroundColor: '#ffffff',
      format: formatSelect.value as 'jpeg',
    });

    setDimLabel(panel, `${cw} × ${ch} px`);
  }, DEBOUNCE_MS);

  // Trigger on input changes and crop moves.
  widthInput.addEventListener('input', refresh);
  heightInput.addEventListener('input', refresh);
  formatSelect.addEventListener('change', refresh);
  root.addEventListener('formfit:crop-change', refresh as EventListener);
  // A new file invalidates the cached decoded image.
  root.addEventListener('formfit:file-ready', () => {
    img = null;
    refresh();
  });
  root.addEventListener('formfit:file-cleared', () => {
    generation++;
    img = null;
    panel.hidden = true;
  });
}

// ---- Signature preview ------------------------------------------------------

export function mountSignaturePreview(root: HTMLElement, prefix: string, getCtx: GetCtx): void {
  const panel = root.querySelector<HTMLElement>('[data-live-preview]');
  const canvas = root.querySelector<HTMLCanvasElement>('[data-live-canvas]');
  const widthInput = root.querySelector<HTMLInputElement>(`#${prefix}sig-width`);
  const heightInput = root.querySelector<HTMLInputElement>(`#${prefix}sig-height`);
  const bgSelect = root.querySelector<HTMLSelectElement>(`#${prefix}sig-background`);
  if (!panel || !canvas || !widthInput || !heightInput || !bgSelect) return;

  let generation = 0;

  function numInput(el: HTMLInputElement): number {
    const v = parseInt(el.value.trim(), 10);
    return Number.isFinite(v) && v > 0 ? v : 0;
  }

  const refresh = debounce(async () => {
    const ctx = getCtx();
    if (!ctx) return;
    const w = numInput(widthInput) || 300;
    const h = numInput(heightInput) || 80;
    if (!readyPanel(panel, w, h)) return;

    const gen = ++generation;
    const background = bgSelect.value as 'original' | 'white' | 'transparent';

    try {
      // previewSignature is capped internally and skips quality stepping.
      const { blob, width, height } = await previewSignature(ctx.src, {
        width: w,
        height: h,
        background,
        sourceRect: ctx.crop,
      });
      if (gen !== generation) return;

      const scale = previewScale(width, height);
      setCanvasSize(canvas, width * scale, height * scale);
      const imgCtx = canvas.getContext('2d');
      if (!imgCtx) return;

      const url = URL.createObjectURL(blob);
      const previewImg = new Image();
      previewImg.onload = () => {
        if (gen === generation) {
          imgCtx.drawImage(previewImg, 0, 0, canvas.width, canvas.height);
          setDimLabel(panel, `${Math.round(width * scale)} × ${Math.round(height * scale)} px`);
        }
        URL.revokeObjectURL(url);
      };
      previewImg.onerror = () => URL.revokeObjectURL(url);
      previewImg.src = url;
    } catch {
      panel.hidden = true;
    }
  }, DEBOUNCE_MS);

  widthInput.addEventListener('input', refresh);
  heightInput.addEventListener('input', refresh);
  bgSelect.addEventListener('change', refresh);
  root.addEventListener('formfit:crop-change', refresh as EventListener);
  root.addEventListener('formfit:file-ready', refresh as EventListener);
  root.addEventListener('formfit:file-cleared', () => {
    generation++;
    panel.hidden = true;
  });
}