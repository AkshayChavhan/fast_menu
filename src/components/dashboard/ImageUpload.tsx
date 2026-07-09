"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const BUCKET = "menu-images";
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

// Uploads an image to the menu-images bucket at `<pathPrefix>/<uuid>.<ext>` and
// reports the resulting public URL. Used for both dish photos and the logo.
export function ImageUpload({
  pathPrefix,
  value,
  onChange,
  shape = "square",
  label = "image",
}: {
  pathPrefix: string;
  value: string | null;
  onChange: (url: string | null) => void;
  shape?: "square" | "wide";
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);

    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("Image must be under 5 MB.");
      return;
    }

    setUploading(true);
    try {
      const supabase = createClient();
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const path = `${pathPrefix}/${id}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from(BUCKET)
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
      } = supabase.storage.from(BUCKET).getPublicUrl(path);
      onChange(publicUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const box =
    shape === "wide" ? "aspect-[3/1] w-full" : "aspect-square w-28";

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
              onClick={() => onChange(null)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </button>
          )}
          <p className="text-[11px] text-neutral-400">JPG/PNG/WebP, up to 5 MB.</p>
        </div>
      </div>

      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
    </div>
  );
}
