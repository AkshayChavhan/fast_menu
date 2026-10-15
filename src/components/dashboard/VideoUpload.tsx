"use client";

import { useRef, useState } from "react";
import { Link2, Loader2, Trash2, Video } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  VIDEO_BUCKET,
  VIDEO_MAX_BYTES,
  VIDEO_MIME_TYPES,
  videoPathFromUrl,
} from "@/lib/storage-url";
import { youtubeIdFromUrl, youtubeThumbnailUrl } from "@/lib/video-link";

const ACCEPT = VIDEO_MIME_TYPES.join(",");
const EXTENSIONS: Record<string, string> = { "video/mp4": "mp4", "video/webm": "webm" };
const MAX_LABEL = `${VIDEO_MAX_BYTES / 1024 / 1024} MB`;

// One year: the name is a fresh id and upsert is off, so the bytes behind a
// URL never change; a replaced clip gets a new name and the old is deleted.
const VIDEO_CACHE_SECONDS = String(60 * 60 * 24 * 365);

function formatBytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

// Best effort, for a clip this browser uploaded but nothing ever saved.
export async function discardVideo(url: string | null): Promise<void> {
  const path = videoPathFromUrl(url);
  if (!path) return;
  const { error } = await createClient().storage.from(VIDEO_BUCKET).remove([path]);
  if (error) console.warn(`Could not remove ${path}: ${error.message}`);
}

// Uploads a short clip to the menu-videos bucket at `<pathPrefix>/<uuid>.<ext>`
// and reports the public URL. Nothing is re-encoded in the browser — video is
// too heavy for that — so the size cap is the whole rule, checked here before
// anything is sent and enforced by the bucket.
export function VideoUpload({
  pathPrefix,
  value,
  onChange,
}: {
  pathPrefix: string;
  value: string | null;
  onChange: (url: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const youtubeId = youtubeIdFromUrl(value);

  function useLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const id = youtubeIdFromUrl(link);
    if (!id) {
      setError("That does not look like a YouTube video link.");
      return;
    }
    // The parent saves whatever it is given; the server keeps one canonical form.
    onChange(`https://www.youtube.com/watch?v=${id}`);
    setLink("");
  }

  async function handleFile(file: File) {
    setError(null);
    if (!(VIDEO_MIME_TYPES as readonly string[]).includes(file.type)) {
      setError("Please choose an MP4 or WebM video.");
      return;
    }
    if (file.size > VIDEO_MAX_BYTES) {
      setError(
        `This video is ${formatBytes(file.size)}; the limit is ${MAX_LABEL}. Export a shorter or smaller clip — 10 to 15 seconds at 720p is plenty.`,
      );
      return;
    }

    try {
      setBusy(true);
      const supabase = createClient();
      const ext = EXTENSIONS[file.type] ?? "mp4";
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const path = `${pathPrefix}/${id}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from(VIDEO_BUCKET)
        .upload(path, file, {
          cacheControl: VIDEO_CACHE_SECONDS,
          upsert: false,
          contentType: file.type,
        });
      if (upErr) {
        setError(upErr.message);
        return;
      }
      const { data } = supabase.storage.from(VIDEO_BUCKET).getPublicUrl(path);
      onChange(data.publicUrl);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start gap-4">
        <div
          className={cn(
            "relative h-24 w-40 shrink-0 overflow-hidden rounded-xl bg-neutral-100 ring-1 ring-neutral-200 dark:bg-neutral-800 dark:ring-neutral-700",
          )}
        >
          {value && youtubeId ? (
            // YouTube's own thumbnail; the player itself only runs on the menu.
            // eslint-disable-next-line @next/next/no-img-element -- a remote thumbnail; next/image would need the host configured
            <img src={youtubeThumbnailUrl(youtubeId)} alt="" className="h-full w-full object-cover" />
          ) : value ? (
            // The owner's own preview: muted, looping, as a guest would see it.
            <video
              src={value}
              muted
              loop
              autoPlay
              playsInline
              preload="metadata"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-neutral-400">
              <Video className="h-7 w-7" aria-hidden />
            </div>
          )}
          {busy ? (
            <div className="absolute inset-0 flex items-center justify-center bg-white/70 dark:bg-neutral-900/70">
              <Loader2 className="h-5 w-5 animate-spin text-brand-600" aria-label="Uploading" />
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
            >
              <Video className="h-4 w-4" aria-hidden />
              {value ? "Replace video" : "Upload video"}
            </button>
            {value ? (
              <button
                type="button"
                onClick={() => onChange(null)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60 dark:text-red-300 dark:hover:bg-red-900/30"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                Remove
              </button>
            ) : null}
          </div>
          <p className="max-w-sm text-xs text-neutral-500">
            Plays silently behind your name and description. MP4 or WebM, up to{" "}
            {MAX_LABEL}; 10–15 seconds is plenty, and a steady shot of the entrance or the
            room works best. Guests on slow connections see the plain banner until it loads.
          </p>
        </div>
      </div>

      <form onSubmit={useLink} className="flex flex-wrap items-end gap-2">
        <label className="block min-w-[14rem] flex-1 text-xs font-medium text-neutral-500">
          Or paste a YouTube link
          <input
            className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-neutral-700 dark:bg-neutral-800"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            inputMode="url"
            placeholder="https://youtu.be/…"
          />
        </label>
        <button
          type="submit"
          disabled={busy || !link.trim()}
          className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
        >
          <Link2 className="h-4 w-4" aria-hidden />
          Use link
        </button>
        <p className="w-full text-xs text-neutral-500">
          Takes no storage. YouTube shows its own logo, may show the title for a moment, and
          can run an ad on a monetised video — an uploaded file never does.
          {youtubeId ? " Currently using a YouTube video." : ""}
        </p>
      </form>
      {error ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />
    </div>
  );
}
