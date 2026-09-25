// Shrinks an image that is over the upload limit until it fits, losing as
// little as the eye can tell. A file already under the limit is returned
// untouched, bytes and all.
//
// Order of sacrifice, least visible first:
//   1. Resolution, down to 1024 px on the longest side. A phone menu card
//      never shows more, so nothing visible is lost.
//   2. Encoder quality, from 0.9 down to 0.8. Each quality step is tried at
//      every size before the next step, because 1600 px at 0.9 looks better
//      on a phone than 2048 px at 0.8. 0.8 is where JPEG artefacts start to
//      show in smooth areas, so it is the normal floor.
//   3. A last-resort 0.7 at the smallest size. Below that we give up rather
//      than upload a visibly damaged photo.
//
// A PNG gets a lossless pass first (only the resize), so a logo keeps its
// crisp edges and transparency. Only when that still does not fit does it
// move to a lossy encoding: WebP where the browser can write it, else JPEG
// for an opaque image. A transparent image the browser cannot write as WebP
// is refused rather than flattened onto white.
//
// Re-encoding drops EXIF, including any GPS position, which is a bonus for
// photos taken on someone's phone.

import { IMAGE_MAX_BYTES } from "@/lib/storage-url";

// Longest-edge sizes to try, largest first.
export const EDGE_STEPS = [2048, 1600, 1280, 1024] as const;
// Encoder quality steps, best first; every size is tried at one step before
// moving to the next.
export const QUALITY_STEPS = [0.9, 0.85, 0.8] as const;
// Tried once, at the smallest size, before giving up.
export const QUALITY_FLOOR = 0.7;

export type Encoder = (edge: number, quality: number) => Promise<Blob>;

export interface Fit {
  blob: Blob;
  edge: number;
  // null for a lossless encoding.
  quality: number | null;
}

// Longest-edge sizes to try for a source whose longest edge is `sourceEdge`:
// never upscale, and skip any step the source is already below.
export function candidateEdges(sourceEdge: number): number[] {
  const first = Math.min(sourceEdge, EDGE_STEPS[0]);
  return [first, ...EDGE_STEPS.filter((e) => e < first)];
}

// Walk the ladder for one encoding and return the first result under
// `maxBytes`, or null when even the last rung is too big.
export async function searchFit(
  encode: Encoder,
  opts: { maxBytes: number; sourceEdge: number; lossless?: boolean },
): Promise<Fit | null> {
  const edges = candidateEdges(opts.sourceEdge);
  const smallest = edges[edges.length - 1];

  if (opts.lossless) {
    for (const edge of edges) {
      const blob = await encode(edge, 1);
      if (blob.size <= opts.maxBytes) return { blob, edge, quality: null };
      // Lossless size tracks pixel count, so if even the smallest size
      // could not close the gap, stop encoding and let the caller go lossy.
      if (blob.size > opts.maxBytes * (edge / smallest) ** 2) return null;
    }
    return null;
  }

  for (const quality of QUALITY_STEPS) {
    for (const edge of edges) {
      const blob = await encode(edge, quality);
      if (blob.size <= opts.maxBytes) return { blob, edge, quality };
    }
  }
  const blob = await encode(smallest, QUALITY_FLOOR);
  return blob.size <= opts.maxBytes ? { blob, edge: smallest, quality: QUALITY_FLOOR } : null;
}

export type FitResult =
  | { changed: false; blob: File }
  | { changed: true; blob: Blob; width: number; height: number; quality: number | null };

// Bring `file` under `maxBytes`, or return null when it cannot be done
// without visible loss. Throws when the browser cannot read the file.
export async function fitImageUnder(
  file: File,
  maxBytes: number = IMAGE_MAX_BYTES,
): Promise<FitResult | null> {
  if (file.size <= maxBytes) return { changed: false, blob: file };

  const decoded = await decode(file);
  try {
    const { source, width, height } = decoded;
    const sourceEdge = Math.max(width, height);

    // Each size is resampled once and re-encoded as often as the ladder needs.
    const scaled = new Map<number, HTMLCanvasElement>();
    const canvasFor = (edge: number): HTMLCanvasElement => {
      let c = scaled.get(edge);
      if (!c) {
        c = drawScaled(source, width, height, edge);
        scaled.set(edge, c);
      }
      return c;
    };
    const encodeAs =
      (type: string): Encoder =>
      (edge, quality) =>
        toBlob(canvasFor(edge), type, quality);
    const done = (fit: Fit): FitResult => {
      const c = canvasFor(fit.edge);
      return { changed: true, blob: fit.blob, width: c.width, height: c.height, quality: fit.quality };
    };

    if (file.type === "image/png") {
      const fit = await searchFit(encodeAs("image/png"), { maxBytes, sourceEdge, lossless: true });
      if (fit) return done(fit);
    }

    const transparent =
      file.type !== "image/jpeg" && hasTransparency(source, width, height);
    const webp = await canEncodeWebp();
    let type: string;
    if (transparent) {
      if (!webp) return null;
      type = "image/webp";
    } else {
      type = webp && file.type === "image/webp" ? "image/webp" : "image/jpeg";
    }

    const fit = await searchFit(encodeAs(type), { maxBytes, sourceEdge });
    return fit ? done(fit) : null;
  } finally {
    decoded.close();
  }
}

// --- Browser plumbing --------------------------------------------------------

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      // from-image applies the EXIF rotation, so a portrait phone photo
      // stays portrait once the metadata is gone.
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      // Older Safari: fall through to an <img>, which auto-orients as well.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("That file is not an image the browser can read."));
      el.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

function context(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext("2d");
  if (!g) throw new Error("This browser cannot resize images.");
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  return g;
}

// Resample to `edge` on the longest side. Halving in steps until within 2×
// of the target keeps every source pixel contributing; a single big
// downscale can skip pixels and look jagged in some browsers.
function drawScaled(
  source: CanvasImageSource,
  sw: number,
  sh: number,
  edge: number,
): HTMLCanvasElement {
  const scale = Math.min(1, edge / Math.max(sw, sh));
  const tw = Math.max(1, Math.round(sw * scale));
  const th = Math.max(1, Math.round(sh * scale));

  let current: CanvasImageSource = source;
  let cw = sw;
  let ch = sh;
  while (cw / 2 >= tw && ch / 2 >= th) {
    const half = makeCanvas(Math.round(cw / 2), Math.round(ch / 2));
    context(half).drawImage(current, 0, 0, half.width, half.height);
    current = half;
    cw = half.width;
    ch = half.height;
  }
  const out = makeCanvas(tw, th);
  context(out).drawImage(current, 0, 0, tw, th);
  return out;
}

function toBlob(c: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    c.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the image."))),
      type,
      quality,
    );
  });
}

// Sampled on a small copy: enough to catch a transparent background or
// rounded corners, cheap enough to run on every PNG.
function hasTransparency(source: CanvasImageSource, sw: number, sh: number): boolean {
  const c = drawScaled(source, sw, sh, 256);
  const data = context(c).getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 250) return true;
  }
  return false;
}

let webpSupport: Promise<boolean> | null = null;

// Chrome, Edge and Firefox write WebP from a canvas; Safari silently hands
// back a PNG instead, which is how we tell.
function canEncodeWebp(): Promise<boolean> {
  webpSupport ??= (async () => {
    try {
      const blob = await toBlob(makeCanvas(2, 2), "image/webp", 0.8);
      return blob.type === "image/webp";
    } catch {
      return false;
    }
  })();
  return webpSupport;
}
