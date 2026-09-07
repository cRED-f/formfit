# FormFit

**Make any image upload-ready — free, in your browser.**

FormFit is a collection of browser-based image tools that resize, compress, convert, and prepare images and signatures for online forms. No uploads, no servers, no accounts — everything runs on your device.

Live site: [formfit-f1l.pages.dev](https://formfit-f1l.pages.dev)

---

## Features

### Resize Image
Set exact pixel dimensions with aspect-ratio lock. Choose output format (JPG, PNG, WebP). Live preview updates as you type.

### Compress Image
Shrink images to a target file size in KB. Select output format and quality. Intelligent compression that preserves visual quality and warns when dimensions need reducing instead.

### Signature Resizer
Upload a scanned signature, crop to the ink area, and resize for online form fields — "300 × 80 px, under 20 KB." White, transparent, or original background with automatic ink detection and empty-space removal.

### Image Converter
Convert between JPG, PNG, and WebP formats with high, balanced, or small quality presets.

### Interactive Crop
All four tools include a Figma-style drag-handle crop overlay with 8 handles (4 corners + 4 edges). Drag to select the exact region you need before processing.

### Live Preview
Resize and Signature tools show a real-time canvas preview that updates as you change dimensions, crop, or settings — no waiting for the Run button.

---

## Tech Stack

| Technology | Role |
|---|---|
| [Astro](https://astro.build) 7.3 | Static site generation, island architecture |
| [Tailwind CSS](https://tailwindcss.com) v4 | Utility-first styling via `@tailwindcss/vite` |
| TypeScript | Type-safe image processing modules |
| Canvas API | Image rendering, cropping, and preview |
| Pointer Events API | Touch/mouse/pen crop handle dragging |

No React, Vue, or Svelte — all interactivity is vanilla TypeScript islands bundled by Vite.

---

## Getting Started

### Prerequisites
- Node.js ≥ 22.12.0
- npm

### Install & Run

```sh
npm install
npm run dev
```

The dev server starts at `http://localhost:4325`.

### Commands

| Command | Action |
|---|---|
| `npm run dev` | Start dev server at localhost:4325 |
| `npm run build` | Build production site to `./dist/` |
| `npm run preview` | Preview the production build locally |

---

## Project Structure

```
src/
├── components/
│   ├── layout/          # Container, Header, Footer
│   ├── seo/             # Breadcrumbs, FAQList, SEO meta
│   ├── tool/            # Core tool UI components
│   │   ├── CropPanel.astro      # Interactive crop overlay shell
│   │   ├── HeroUpload.astro     # Homepage hero upload zone
│   │   ├── PreviewPanel.astro   # Live preview canvas shell
│   │   ├── ResultPanel.astro    # Download result area
│   │   ├── ToolShell.astro      # Standalone page wrapper
│   │   └── UploadPanel.astro    # Animated upload box with drag/drop/paste
│   └── ui/              # Reusable primitives (Button, Input, Select, Icon, etc.)
├── layouts/
│   └── Layout.astro     # Base HTML layout
├── lib/
│   └── image/           # Image processing engine
│       ├── engine.ts    # Core: SourceRect, drawFrame, renderBlob, loadImage
│       ├── compress.ts  # Binary-search compression to target file size
│       ├── signature.ts # Signature ink detection + background removal
│       ├── format.ts    # Format encoding (JPEG/PNG/WebP quality ladders)
│       ├── crop.ts      # Crop overlay behavior (mountCrop, drag state machine)
│       ├── preview.ts   # Debounced live preview (resize + signature)
│       ├── result.ts    # Result UI helpers (bindBusy, clearResult)
│       └── tools.ts     # Mount pattern wiring crop, preview, and Run handlers
├── pages/
│   ├── index.astro              # Homepage with hero + 4 inline tool panels
│   ├── resize-image/index.astro # Resize tool page
│   ├── compress-image/index.astro # Compress tool page
│   ├── signature-resizer/index.astro # Signature tool page
│   ├── image-converter/index.astro # Converter tool page
│   ├── about.astro              # About page
│   ├── contact.astro            # Contact page
│   ├── privacy.astro            # Privacy policy
│   └── 404.astro                # Not found page
└── styles/
    └── global.css       # Apple-inspired design tokens, Tailwind v4 config, animations
```

---

## Architecture

### Island Architecture

FormFit uses Astro's static site generation. Each tool page is pre-rendered HTML with vanilla TypeScript `<script>` blocks that Vite bundles at build time. No client-side framework — just DOM manipulation with typed event dispatching.

### Component Communication

Components communicate via **CustomEvents** that bubble up through the DOM:

```
UploadPanel         →  formfit:file-ready    { file, objectUrl, width, height }
CropPanel (via crop.ts)  →  formfit:crop-change    { rect: SourceRect }
UploadPanel         →  formfit:file-cleared  (on remove)
```

The `mount()` function in `tools.ts` listens for these events on the root `[data-formfit-upload]` element and maintains a `SourceCtx` that flows to the engine.

### Image Processing Pipeline

All processing is pure client-side using the Canvas API:

```
File → loadImage() → HTMLImageElement
                    ↓
          cropBounds(sourceRect) → source pixel region
                    ↓
          drawFrame() → scaled to target dimensions
                    ↓
          Canvas → Blob (via canvas.toBlob / toDataURL)
                    ↓
          ResultPanel → download link
```

### Crop System

The crop overlay (`CropPanel.astro` + `crop.ts`) uses a normalized `SourceRect` (values 0..1) that maps to source image pixels:

- **Frame aspect-ratio** dynamically matches the uploaded image
- **8 drag handles** (corners + edges) with Pointer Events for mouse/touch/pen
- **Body drag** to reposition the crop region
- **Minimum 2% floor** prevents degenerate crops
- **Reset button** restores the full image
- `formfit:crop-change` events propagate to preview and engine

### Live Preview

The preview system (`PreviewPanel.astro` + `preview.ts`) renders a capped canvas (max 480px) with 220ms debounce and generation counters to prevent stale renders:

- **Resize preview**: Uses `drawFrame()` directly — no blob encoding, just canvas drawing
- **Signature preview**: Uses `previewSignature()` with shared ink-detect algorithm
- Updates on: width/height input, crop change, format/background change, new file

### Mount Pattern

Each tool page follows a consistent pattern:

```typescript
const root = document.querySelector('[data-formfit-upload]');
if (root) mountResize(root);  // or mountCompress, mountSignature, mountConvert
```

The shared `mount()` helper wires:
1. `formfit:file-ready` → stores SourceCtx
2. `formfit:file-cleared` → clears context
3. `mountCrop(root, onRect)` → crop overlay + crop-change events
4. Run button → calls tool-specific processing
5. Optional `onChange` → triggers live preview refresh

Homepage inline panels use the same mount functions with a `'home-'` prefix for element IDs.

---

## Design System

FormFit uses an Apple-inspired design language defined in `global.css`:

- **Colors**: Single blue accent (`#0066cc`), near-black ink (`#1d1d1f`), parchment off-white (`#f5f5f7`)
- **Typography**: SF Pro Display/Text with system-ui fallback, negative letter-spacing at display sizes
- **Spacing**: 8px base unit with 4/8/12/17/24/32/48/80px tokens
- **Radii**: 5px (xs) / 8px (sm) / 11px (md) / 18px (lg) / pill (CTAs)
- **Animations**: Glassy morphing icons, shimmer strips, ring-draw loading states

---

## Privacy

- All image processing runs in the browser via Canvas API
- No files are uploaded to any server
- No analytics tracking of file content
- No account or login required

---

## Browser Support

FormFit works in all modern browsers supporting Canvas API and ES2022:
- Chrome 100+
- Firefox 100+
- Safari 16+
- Edge 100+

---

## License

MIT
