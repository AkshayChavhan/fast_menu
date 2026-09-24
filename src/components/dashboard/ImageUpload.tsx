"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  IMAGE_BUCKET,
  IMAGE_MAX_BYTES,
  IMAGE_MIME_TYPES,
  imagePathFromUrl,
} from "@/lib/storage-url";

const ACCEPT = IMAGE_MIME_TYPES.join(",");
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// Delete a file this browser uploaded but nothing ever saved: an upload that
// was replaced or removed before its form was submitted, or a cancelled form.
// Images that were saved are cleaned up by the server action that replaces
// them (lib/storage-cleanup.ts). Best effort; an orphan only costs storage.
export async function discardImage(url: string | null): Promise<void> {
  const path = imagePathFromUrl(url);
  if (!path) return;
  const { error } = await createClient().storage.from(IMAGE_BUCKET).remove([path]);
  if (error) console.warn(`Could not remove ${path}: ${error.message}`);
}

// Uploads an image to the menu-images bucket at `<pathPrefix>/<uuid>.<ext>` and
// reports the resulting public URL. Used for dish photos, the logo and staff
// profile photos. Type and size are checked here before anything is sent, and
// the bucket enforces the same limits (migrations/*_image_size_limit.sql).
export function ImageUpload({
  pathPrefix,
  value,
  onChange,
  shape = "square",
  label = "image",
  savesLater = false,
}: {
  pathPrefix: string;
  value: string | null;
  onChange: (url: string | null) => void;
  shape?: "square" | "wide" | "round";
  label?: string;
  // The parent keeps the URL in form state and saves it on submit. Until
  // then an upload that is replaced or removed here is deleted, since no row
  // will ever point at it. Leave off when every change is saved straight
  // away: the server action then deletes the previous file, and only once
  // the new URL is safely stored.
  savesLater?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // URLs this control uploaded that the parent has not saved yet.
  const unsaved = useRef(new Set<string>());

  function replace(next: string | null) {
    if (savesLater && value && unsaved.current.has(value)) {
      unsaved.current.delete(value);
      void discardImage(value);
    }
    if (savesLater && next) unsaved.current.add(next);
    onChange(next);
  }

  async function handleFile(file: File) {
    setError(null);

    if (!(IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) {
      setError("Please choose a JPG, PNG or WebP image.");
      return;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      setError("Image must be under 1 MB. Try a smaller or more compressed photo.");
      return;
    }

    setUploading(true);
    try {
      const supabase = createClient();
      const ext = EXTENSIONS[file.type] ?? "jpg";
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const path = `${pathPrefix}/${id}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from(IMAGE_BUCKET)
        .upload(path, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type,
        });
      if (upErr) {
        setError(upErr.message);
        return;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
      replace(publicUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const box =
    shape === "wide"
      ? "aspect-[3/1] w-full"
      : shape === "round"
        ? "aspect-square w-28 rounded-full"
        : "aspect-square w-28";

  return (
    <div>
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-neutral-300 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800/50",
            box,
          )}
        >
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={value}
              alt={label}
              className="h-full w-full object-cover"
            />
          ) : (
            <ImagePlus className="h-6 w-6 text-neutral-400" />
          )}
          {uploading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/70 dark:bg-black/60">
              <Loader2 className="h-5 w-5 animate-spin text-brand-600" />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
          >
            <ImagePlus className="h-3.5 w-3.5" />
            {value ? `Replace ${label}` : `Upload ${label}`}
          </button>
          {value && (
            <button
              type="button"
              disabled={uploading}
              onClick={() => replace(null)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </button>
          )}
          <p className="text-[11px] text-neutral-400">JPG, PNG or WebP, up to 1 MB.</p>
        </div>
      </div>

      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
    </div>
  );
}
