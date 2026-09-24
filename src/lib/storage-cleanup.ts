import { IMAGE_BUCKET, imagePathForRestaurant } from "@/lib/storage-url";

// The slice of a Supabase client this needs; test doubles satisfy it too.
export interface ImageStore {
  storage: {
    from(bucket: string): {
      remove(paths: string[]): Promise<{ error: { message: string } | null }>;
    };
  };
}

// Delete the files behind `urls` once no row points at them any more: the
// previous logo or photo after a replacement, or a removed dish's picture.
// `keep` is the URL still in use (the new value) and is never touched, and
// only files under the restaurant's own folder are removed.
//
// Best effort: the row change has already succeeded, so a failure here only
// leaves an orphan behind for `pnpm images:prune`, and must not fail the
// action that called us.
export async function removeRestaurantImages(
  store: ImageStore,
  restaurantId: string,
  urls: ReadonlyArray<string | null | undefined>,
  keep: string | null = null,
): Promise<void> {
  const paths = Array.from(
    new Set(
      urls
        .filter((url): url is string => !!url && url !== keep)
        .map((url) => imagePathForRestaurant(url, restaurantId))
        .filter((path): path is string => path !== null),
    ),
  );
  if (paths.length === 0) return;

  try {
    const { error } = await store.storage.from(IMAGE_BUCKET).remove(paths);
    if (error) {
      console.warn(`Could not remove ${paths.length} image(s) from storage: ${error.message}`);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`Could not remove ${paths.length} image(s) from storage: ${message}`);
  }
}
