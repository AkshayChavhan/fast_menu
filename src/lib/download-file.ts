// Hand the browser a file built in memory. Used by the menu export/sample
// downloads, where the JSON is already in the page and a server round-trip
// would add nothing.
//
// Client-only: touches document/URL, so don't import this from a Server
// Component.
export function downloadJson(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Release the object URL once the click has been dispatched, or the blob
  // stays alive for the life of the document.
  URL.revokeObjectURL(url);
}

// `my-cafe-menu-2026-09-05.json` — dated so successive backups don't overwrite
// each other in the downloads folder.
export function datedFilename(slug: string, suffix = "menu"): string {
  const date = new Date().toISOString().slice(0, 10);
  return `${slug}-${suffix}-${date}.json`;
}
