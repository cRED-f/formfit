/**
 * Crop — interactive drag-handle crop overlay.
 *
 * `mountCrop(root, onRect)` wires pointer events on a CropPanel shell. A
 * child handle drags resize the rect; dragging the rect body moves it. All
 * coordinates are normalized 0..1 relative to the source image.
 */

import type { SourceRect } from './engine';

export function fullRect(): SourceRect {
  return { x: 0, y: 0, width: 1, height: 1 };
}

/** Minimum crop dimension as a fraction of the image (2%). */
const MIN_FRAC = 0.02;
/** Minimum pointer travel before a drag starts (avoids accidental micro-drags). */
const DEAD_ZONE = 3;

interface DragState {
  kind: 'handle' | 'body';
  handle?: string;
  startPointer: { x: number; y: number };
  startRect: SourceRect;
}

interface CropCtx {
  rect: SourceRect;
  frameRect: DOMRect;
  imgW: number;
  imgH: number;
}

type RectEl = HTMLElement;

export function mountCrop(root: HTMLElement, onRect: (rect: SourceRect) => void): void {
  const panel = root.querySelector<HTMLElement>('[data-crop-panel]');
  const frame = root.querySelector<HTMLElement>('[data-crop-frame]');
  const img = root.querySelector<HTMLImageElement>('[data-crop-img]');
  const rectEl = root.querySelector<RectEl>('[data-crop-rect]');
  const dimChip = root.querySelector<HTMLElement>('[data-crop-dim]');
  const resetBtn = root.querySelector<HTMLButtonElement>('[data-crop-reset]');
  if (!panel || !frame || !img || !rectEl || !dimChip || !resetBtn) return;

  let ctx: CropCtx | null = null;
  let drag: DragState | null = null;

  // --- Helpers ---------------------------------------------------------------

  function isFull(r: SourceRect): boolean {
    return r.x <= 0.001 && r.y <= 0.001 && r.width >= 0.999 && r.height >= 0.999;
  }

  /** Clamp so the rect stays in-bounds and never smaller than MIN_FRAC. */
  function clamp(r: SourceRect): SourceRect {
    const x = Math.max(0, Math.min(1 - MIN_FRAC, r.x));
    const y = Math.max(0, Math.min(1 - MIN_FRAC, r.y));
    const w = Math.max(MIN_FRAC, Math.min(1 - x, r.width));
    const h = Math.max(MIN_FRAC, Math.min(1 - y, r.height));
    return { x, y, width: w, height: h };
  }

  function applyRect(r: SourceRect): void {
    if (!ctx) return;
    rectEl.style.left = `${r.x * 100}%`;
    rectEl.style.top = `${r.y * 100}%`;
    rectEl.style.width = `${r.width * 100}%`;
    rectEl.style.height = `${r.height * 100}%`;

    const pxW = Math.round(r.width * ctx.imgW);
    const pxH = Math.round(r.height * ctx.imgH);
    dimChip.textContent = `${pxW} × ${pxH}`;

    const full = isFull(r);
    resetBtn.classList.toggle('hidden', full);
    // Hide the empty-body cursor affordance when the rect spans everything.
    rectEl.classList.toggle('cursor-default', full);
    rectEl.classList.toggle('cursor-move', !full);
  }

  function dispatch(rect: SourceRect): void {
    onRect(rect);
    root.dispatchEvent(new CustomEvent('formfit:crop-change', { bubbles: true, detail: { rect } }));
  }

  // --- Pointer handling (single drag state, handle + body) --------------------

  function startDrag(e: PointerEvent, handle: string | undefined): void {
    if (!ctx) return;
    e.preventDefault();
    const target = e.target as HTMLElement;
    try {
      target.setPointerCapture?.(e.pointerId);
    } catch {
      // Synthetic or already released pointer — drag still works via document moves.
    }
    drag = {
      kind: handle ? 'handle' : 'body',
      handle,
      startPointer: { x: e.clientX, y: e.clientY },
      startRect: { ...ctx.rect },
    };
  }

  function onPointerDown(e: PointerEvent): void {
    const target = e.target as HTMLElement;
    const handle = target.dataset.handle;
    // Handles and rect body both begin here; handle drags also capture pointer.
    startDrag(e, handle);
  }

  function onPointerMove(e: PointerEvent): void {
    if (!drag || !ctx) return;
    const dx = e.clientX - drag.startPointer.x;
    const dy = e.clientY - drag.startPointer.y;
    if (Math.abs(dx) < DEAD_ZONE && Math.abs(dy) < DEAD_ZONE) return;

    const dxf = dx / ctx.frameRect.width;
    const dyf = dy / ctx.frameRect.height;

    if (drag.kind === 'body') {
      ctx.rect = clamp({
        x: drag.startRect.x + dxf,
        y: drag.startRect.y + dyf,
        width: drag.startRect.width,
        height: drag.startRect.height,
      });
    } else {
      const r = { ...drag.startRect };
      const h = drag.handle!;
      if (h.includes('w')) { r.x = drag.startRect.x + dxf; r.width = drag.startRect.width - dxf; }
      if (h.includes('e')) { r.width = drag.startRect.width + dxf; }
      if (h.includes('n')) { r.y = drag.startRect.y + dyf; r.height = drag.startRect.height - dyf; }
      if (h.includes('s')) { r.height = drag.startRect.height + dyf; }
      ctx.rect = clamp(r);
    }
    applyRect(ctx.rect);
  }

  function onPointerUp(): void {
    if (drag && ctx) dispatch(ctx.rect);
    drag = null;
  }

  // --- File ready / reset ----------------------------------------------------

  function onFileReady(e: Event): void {
    const detail = (e as CustomEvent).detail as { objectUrl: string; width: number; height: number };
    panel.hidden = false;
    const { width, height } = detail;

    // Fit the frame to the image's aspect ratio so crop fractions map to pixels.
    frame.style.aspectRatio = `${width} / ${height}`;
    img.src = detail.objectUrl;

    ctx = {
      rect: fullRect(),
      frameRect: frame.getBoundingClientRect(),
      imgW: width,
      imgH: height,
    };
    applyRect(ctx.rect);
    dispatch(ctx.rect);
  }

  function onFileCleared(): void {
    panel.hidden = true;
    img.removeAttribute('src');
    ctx = null;
    drag = null;
  }

  function onReset(): void {
    if (!ctx) return;
    ctx.rect = fullRect();
    applyRect(ctx.rect);
    dispatch(ctx.rect);
  }

  // --- Bind ------------------------------------------------------------------

  rectEl.addEventListener('pointerdown', onPointerDown);
  // listen on document so pointer-captured handle moves still arrive.
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerUp);

  resetBtn.addEventListener('click', onReset);

  root.addEventListener('formfit:file-ready', onFileReady);
  root.addEventListener('formfit:file-cleared', onFileCleared);

  // Keep pixel-coords current when the frame resizes (e.g. layout shift, zoom).
  const ro = new ResizeObserver(() => {
    if (ctx) ctx.frameRect = frame.getBoundingClientRect();
  });
  ro.observe(frame);
}