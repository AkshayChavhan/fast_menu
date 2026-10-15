"use client";

import { useEffect, useRef, useState } from "react";

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
