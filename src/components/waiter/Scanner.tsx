"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CameraOff, Loader2, ScanLine } from "lucide-react";

import { codeFromScan, normaliseOrderCode as normalise } from "@/lib/order-code";

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<{ rawValue: string }[]>;
};

// Camera scanner for the waiter. Uses the browser's BarcodeDetector where it
// exists (Chrome, Android) and falls back to decoding frames with jsQR
// (iOS Safari). Manual entry is always there for a dead camera.
export function Scanner() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"starting" | "scanning" | "denied" | "found">("starting");
  const [manual, setManual] = useState("");

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    let raf = 0;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch {
        if (!cancelled) setStatus("denied");
        return;
      }
      const video = videoRef.current;
      if (!video || cancelled) return;
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      if (cancelled) return;
      setStatus("scanning");

      const detector: BarcodeDetectorLike | null =
        "BarcodeDetector" in window
          ? new (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => BarcodeDetectorLike }).BarcodeDetector({ formats: ["qr_code"] })
          : null;
      const jsQR = detector ? null : (await import("jsqr")).default;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      let last = 0;

      const tick = async (now: number) => {
        if (cancelled) return;
        // Ten frames a second is plenty and keeps the phone cool.
        if (now - last > 100 && video.readyState >= 2) {
          last = now;
          let text: string | null = null;
          try {
            if (detector) {
              const found = await detector.detect(video);
              text = found[0]?.rawValue ?? null;
            } else if (jsQR && ctx) {
              const w = Math.min(640, video.videoWidth);
              const h = Math.round((w / video.videoWidth) * video.videoHeight) || 0;
              if (w > 0 && h > 0) {
                canvas.width = w;
                canvas.height = h;
                ctx.drawImage(video, 0, 0, w, h);
                const img = ctx.getImageData(0, 0, w, h);
                text = jsQR(img.data, w, h, { inversionAttempts: "dontInvert" })?.data ?? null;
              }
            }
          } catch {
            text = null;
          }
          const code = text ? codeFromScan(text) : null;
          if (code) {
            setStatus("found");
            if (navigator.vibrate) navigator.vibrate(60);
            router.push(`/waiter/orders/${code}`);
            return;
          }
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }

    void start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [router]);

  function go(e: React.FormEvent) {
    e.preventDefault();
    const code = normalise(manual);
    if (code) router.push(`/waiter/orders/${code}`);
  }

  return (
    <div className="space-y-4">
      <div className="relative aspect-square w-full overflow-hidden rounded-3xl bg-neutral-900">
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
        {status === "scanning" ? (
          <div className="pointer-events-none absolute inset-8 rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" aria-hidden />
        ) : null}
        {status === "starting" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/80">
            <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
            <p className="text-sm">Starting the camera…</p>
          </div>
        ) : null}
        {status === "found" ? (
          <div className="absolute inset-0 flex items-center justify-center bg-green-600/80 text-white">
            <p className="text-lg font-bold">Got it</p>
          </div>
        ) : null}
        {status === "denied" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-white/90">
            <CameraOff className="h-8 w-8" aria-hidden />
            <p className="text-sm font-semibold">Camera not available</p>
            <p className="text-xs text-white/70">Allow camera access in your browser, or type the code below.</p>
          </div>
        ) : null}
      </div>

      <form onSubmit={go} className="flex gap-2">
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value.toUpperCase())}
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          maxLength={8}
          placeholder="Or type the code, e.g. K7M2QD"
          aria-label="Order code"
          className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 font-mono text-base uppercase tracking-widest outline-none transition focus:border-brand-400 focus:ring-4 focus:ring-brand-500/20 dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          type="submit"
          disabled={!normalise(manual)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-2xl bg-brand-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          <ScanLine className="h-4 w-4" aria-hidden /> Open
        </button>
      </form>
    </div>
  );
}
