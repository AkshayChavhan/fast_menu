"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  FileImage,
  Printer,
  QrCode as QrCodeIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

type LayoutId = "tent" | "sticker" | "decal";

interface QrStudioProps {
  /** Menu URL — absolute when the site origin is known, else a relative path. */
  menuUrl: string;
  /** Always the relative `/m/<slug>` path, for resolving against the origin. */
  menuPath: string;
  /** Whether `menuUrl` is already absolute (NEXT_PUBLIC_SITE_URL was set). */
  hasAbsoluteUrl: boolean;
  restaurantName: string;
}

const QR_PX = 1024; // High-res canvas so PNG downloads print crisply.

const LAYOUTS: { id: LayoutId; label: string; blurb: string }[] = [
  { id: "tent", label: "Table tent", blurb: "Folded card for tables" },
  { id: "sticker", label: "Sticker", blurb: "Square peel-and-stick" },
  { id: "decal", label: "Window decal", blurb: "Storefront / door" },
];

export default function QrStudio({
  menuUrl,
  menuPath,
  hasAbsoluteUrl,
  restaurantName,
}: QrStudioProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pngDataUrl, setPngDataUrl] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [layout, setLayout] = useState<LayoutId>("tent");

  // If we don't have an absolute URL from the server, resolve the relative
  // path against the browser origin so the QR encodes a scannable link.
  const resolvedUrl = useMemo(() => {
    if (hasAbsoluteUrl) return menuUrl;
    if (typeof window !== "undefined") {
      return `${window.location.origin}${menuPath}`;
    }
    return menuUrl; // SSR fallback (relative) — replaced on mount.
  }, [hasAbsoluteUrl, menuUrl, menuPath]);

  // Human-friendly display of the link (strip protocol for compactness).
  const displayUrl = useMemo(
    () => resolvedUrl.replace(/^https?:\/\//, ""),
    [resolvedUrl],
  );

  // Render the QR onto the canvas and cache a PNG data URL whenever the URL
  // changes (e.g. after the origin resolves on mount).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    QRCode.toCanvas(canvas, resolvedUrl, {
      width: QR_PX,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#0a0a0a", light: "#ffffff" },
    })
      .then(() => {
        if (cancelled) return;
        setPngDataUrl(canvas.toDataURL("image/png"));
      })
      .catch(() => {
        /* Canvas render failed — downloads simply stay disabled. */
      });

    return () => {
      cancelled = true;
    };
  }, [resolvedUrl]);

  const slugForFilename = useMemo(() => {
    const seg = menuPath.split("/").filter(Boolean).pop() ?? "menu";
    return seg.replace(/[^a-z0-9-]/gi, "") || "menu";
  }, [menuPath]);

  const triggerDownload = useCallback((href: string, filename: string) => {
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  const downloadPng = useCallback(() => {
    const canvas = canvasRef.current;
    const href = pngDataUrl || canvas?.toDataURL("image/png");
    if (!href) return;
    triggerDownload(href, `${slugForFilename}-qr.png`);
  }, [pngDataUrl, slugForFilename, triggerDownload]);

  const downloadSvg = useCallback(async () => {
    try {
      const svg = await QRCode.toString(resolvedUrl, {
        type: "svg",
        margin: 2,
        errorCorrectionLevel: "M",
        color: { dark: "#0a0a0a", light: "#ffffff" },
      });
      const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
      const href = URL.createObjectURL(blob);
      triggerDownload(href, `${slugForFilename}-qr.svg`);
      // Revoke on the next tick so the click has consumed the URL.
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch {
      /* no-op */
    }
  }, [resolvedUrl, slugForFilename, triggerDownload]);

  const copyUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(resolvedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* Clipboard blocked (e.g. insecure context) — silently ignore. */
    }
  }, [resolvedUrl]);

  const print = useCallback(() => window.print(), []);

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,320px)_1fr]">
      {/* ---- Print-only style: show just the active asset, full page ---- */}
      <PrintStyles />

      {/* ================= Left: raw QR + actions ================= */}
      <section className="print:hidden">
        <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div className="mx-auto w-full max-w-[240px] rounded-xl bg-white p-3 ring-1 ring-neutral-200 dark:ring-neutral-700">
            {/* Canvas is the source of truth for the PNG download. */}
            <canvas
              ref={canvasRef}
              width={QR_PX}
              height={QR_PX}
              className="h-auto w-full"
              aria-label={`QR code linking to ${displayUrl}`}
              role="img"
            />
          </div>

          {/* URL + copy */}
          <div className="mt-4">
            <label className="text-xs font-medium text-neutral-500">
              Menu link
            </label>
            <div className="mt-1 flex items-stretch gap-2">
              <div className="flex min-w-0 flex-1 items-center rounded-lg border border-neutral-200 bg-neutral-50 px-3 text-sm dark:border-neutral-700 dark:bg-neutral-800">
                <span className="truncate" title={resolvedUrl}>
                  {displayUrl}
                </span>
              </div>
              <button
                type="button"
                onClick={copyUrl}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                  copied
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                    : "border-neutral-200 bg-white hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800",
                )}
                aria-live="polite"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" /> Copy
                  </>
                )}
              </button>
            </div>
            {!hasAbsoluteUrl && (
              <p className="mt-2 text-xs text-neutral-400">
                Link resolved from this browser. Set{" "}
                <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-800">
                  NEXT_PUBLIC_SITE_URL
                </code>{" "}
                for stable printed codes.
              </p>
            )}
          </div>

          {/* Downloads */}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={downloadPng}
              disabled={!pngDataUrl}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-4 w-4" /> PNG
            </button>
            <button
              type="button"
              onClick={downloadSvg}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
            >
              <FileImage className="h-4 w-4" /> SVG
            </button>
          </div>

          <a
            href={resolvedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            <ExternalLink className="h-4 w-4" /> Open live menu
          </a>
        </div>
      </section>

      {/* ================= Right: print layouts ================= */}
      <section>
        {/* Layout picker + print button */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div
            role="tablist"
            aria-label="Print layout"
            className="inline-flex rounded-lg border border-neutral-200 bg-neutral-50 p-1 dark:border-neutral-800 dark:bg-neutral-900"
          >
            {LAYOUTS.map((l) => (
              <button
                key={l.id}
                role="tab"
                aria-selected={layout === l.id}
                onClick={() => setLayout(l.id)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  layout === l.id
                    ? "bg-white text-brand-700 shadow-sm dark:bg-neutral-800 dark:text-brand-400"
                    : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200",
                )}
                title={l.blurb}
              >
                {l.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={print}
            className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            <Printer className="h-4 w-4" /> Print this
          </button>
        </div>

        {/* Preview stage. The active layout also carries the `qr-print-area`
            class so print CSS can isolate it. */}
        <div className="rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-950 sm:p-8 print:border-0 print:bg-white print:p-0">
          {layout === "tent" && (
            <TableTent
              qrSrc={pngDataUrl}
              url={displayUrl}
              name={restaurantName}
            />
          )}
          {layout === "sticker" && (
            <StickerSheet
              qrSrc={pngDataUrl}
              url={displayUrl}
              name={restaurantName}
            />
          )}
          {layout === "decal" && (
            <WindowDecal
              qrSrc={pngDataUrl}
              url={displayUrl}
              name={restaurantName}
            />
          )}
        </div>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Shared QR image (uses the PNG data URL cached from the canvas).            */
/* -------------------------------------------------------------------------- */

function QrImg({ src, alt }: { src: string; alt: string }) {
  if (!src) {
    return (
      <div className="flex aspect-square w-full items-center justify-center rounded bg-neutral-100 text-neutral-400">
        <QrCodeIcon className="h-8 w-8 animate-pulse" />
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- data URL, not remote.
  return <img src={src} alt={alt} className="h-full w-full object-contain" />;
}

/* -------------------------------------------------------------------------- */
/* Layout 1 — Table tent (folded card; two identical mirrored faces).         */
/* -------------------------------------------------------------------------- */

function TableTent({
  qrSrc,
  url,
  name,
}: {
  qrSrc: string;
  url: string;
  name: string;
}) {
  const Face = (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-xl bg-white px-6 py-8 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-600">
        {name}
      </p>
      <div className="h-40 w-40 rounded-lg bg-white p-2 ring-1 ring-neutral-200">
        <QrImg src={qrSrc} alt={`Scan for the ${name} menu`} />
      </div>
      <div>
        <p className="text-lg font-bold text-neutral-900">Scan for our menu</p>
        <p className="mt-0.5 text-xs text-neutral-400">{url}</p>
      </div>
    </div>
  );

  return (
    <div className="qr-print-area mx-auto flex max-w-md flex-col gap-3">
      {/* Top face (upside down for the fold) */}
      <div className="flex rotate-180 overflow-hidden rounded-2xl border border-brand-100 bg-brand-50 shadow-sm print:shadow-none">
        {Face}
      </div>
      {/* Fold line */}
      <div className="relative h-px bg-neutral-300 print:bg-neutral-400">
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-neutral-50 px-2 text-[10px] uppercase tracking-widest text-neutral-400 dark:bg-neutral-950 print:bg-white">
          fold
        </span>
      </div>
      {/* Bottom face */}
      <div className="flex overflow-hidden rounded-2xl border border-brand-100 bg-brand-50 shadow-sm print:shadow-none">
        {Face}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Layout 2 — Sticker sheet (grid of square peel-and-stick stickers).         */
/* -------------------------------------------------------------------------- */

function StickerSheet({
  qrSrc,
  url,
  name,
}: {
  qrSrc: string;
  url: string;
  name: string;
}) {
  const Sticker = (
    <div className="flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl border-2 border-brand-500 bg-white p-4 text-center">
      <div className="h-24 w-24 rounded bg-white p-1">
        <QrImg src={qrSrc} alt={`Scan for the ${name} menu`} />
      </div>
      <p className="text-sm font-bold leading-tight text-neutral-900">
        Scan for our menu
      </p>
      <p className="max-w-full truncate text-[10px] font-medium uppercase tracking-wide text-brand-600">
        {name}
      </p>
      <p className="max-w-full truncate text-[9px] text-neutral-400">{url}</p>
    </div>
  );

  return (
    <div className="qr-print-area mx-auto grid max-w-lg grid-cols-2 gap-4 sm:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i}>{Sticker}</div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Layout 3 — Window decal (tall storefront/door poster).                     */
/* -------------------------------------------------------------------------- */

function WindowDecal({
  qrSrc,
  url,
  name,
}: {
  qrSrc: string;
  url: string;
  name: string;
}) {
  return (
    <div className="qr-print-area mx-auto flex max-w-sm flex-col items-center gap-6 rounded-3xl bg-brand-600 px-8 py-12 text-center text-white shadow-sm print:shadow-none">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-brand-100">
          {name}
        </p>
        <h2 className="mt-2 text-3xl font-black leading-tight">
          View our
          <br /> menu here
        </h2>
      </div>
      <div className="rounded-2xl bg-white p-4 shadow-lg print:shadow-none">
        <div className="h-56 w-56">
          <QrImg src={qrSrc} alt={`Scan for the ${name} menu`} />
        </div>
      </div>
      <div className="space-y-1">
        <p className="text-lg font-bold">Point your camera &amp; scan</p>
        <p className="text-xs text-brand-100">{url}</p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Print CSS — isolate the active layout, remove app chrome, fit the page.    */
/* -------------------------------------------------------------------------- */

function PrintStyles() {
  return (
    <style>{`
      @media print {
        /* Hide everything, then reveal just the print area subtree. */
        body * {
          visibility: hidden !important;
        }
        .qr-print-area,
        .qr-print-area * {
          visibility: visible !important;
        }
        .qr-print-area {
          position: absolute;
          left: 50%;
          top: 24px;
          transform: translateX(-50%);
          width: auto;
          margin: 0;
        }
        /* Force the brand fills to actually ink on paper. */
        * {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        @page {
          margin: 12mm;
        }
      }
    `}</style>
  );
}
