"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { youtubeEmbedUrl, youtubeIdFromUrl } from "@/lib/video-link";

// The clip behind the welcome banner. Muted and looping, as browsers require
// for autoplay; held still for anyone who asked their device to reduce
// motion; and hidden entirely if it fails to load, so the banner beneath
// simply shows through. Decorative: no controls, no sound, nothing it says.
// play() returns a promise in today's browsers and nothing in old ones (and
// in test DOMs); autoplay being refused is not an error worth surfacing.
function tryPlay(video: HTMLVideoElement) {
  const p: unknown = video.play();
  if (p && typeof (p as Promise<void>).catch === "function") {
    (p as Promise<void>).catch(() => undefined);
  }
}

export function HeroVideo({ src }: { src: string }) {
  const youtubeId = youtubeIdFromUrl(src);
  return youtubeId ? <YoutubeBackdrop id={youtubeId} /> : <FileBackdrop src={src} />;
}

// YouTube's player, sized to cover the banner whatever its shape: a 16:9
// frame at least as wide and as tall as the box, centred. It is an iframe,
// so it cannot be hidden on error the way a file can; YouTube draws its own
// placeholder then. Not rendered at all for anyone who asked for less
// motion — a still frame from YouTube would be another request for nothing.
const REDUCED = "(prefers-reduced-motion: reduce)";
function subscribeReducedMotion(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const mq = window.matchMedia(REDUCED);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
const readReducedMotion = () =>
  typeof window.matchMedia === "function" && window.matchMedia(REDUCED).matches;
// On the server, and for the first client paint, hold still: the frame is
// decoration and a flash of it before the preference is known helps nobody.
const assumeStill = () => true;

function YoutubeBackdrop({ id }: { id: string }) {
  const still = useSyncExternalStore(subscribeReducedMotion, readReducedMotion, assumeStill);
  if (still) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <iframe
        src={youtubeEmbedUrl(id)}
        title=""
        tabIndex={-1}
        allow="autoplay; encrypted-media"
        referrerPolicy="strict-origin-when-cross-origin"
        className="absolute left-1/2 top-1/2 h-[max(100%,56.25vw)] w-[max(100%,177.78vh)] -translate-x-1/2 -translate-y-1/2 border-0"
        style={{ minWidth: "100%", minHeight: "100%", aspectRatio: "16 / 9" }}
      />
    </div>
  );
}

function FileBackdrop({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    // Older browsers (and test DOMs) have no matchMedia: just play.
    if (typeof window.matchMedia !== "function") {
      tryPlay(video);
      return;
    }
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      if (still.matches) video.pause();
      else tryPlay(video);
    };
    apply();
    still.addEventListener("change", apply);
    return () => still.removeEventListener("change", apply);
  }, []);

  if (failed) return null;
  return (
    <video
      ref={ref}
      src={src}
      muted
      loop
      playsInline
      autoPlay
      preload="metadata"
      aria-hidden
      onError={() => setFailed(true)}
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
}
