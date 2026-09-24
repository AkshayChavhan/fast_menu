// @vitest-environment jsdom
import { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

const store = vi.hoisted(() => ({
  uploads: [] as { path: string; type: string }[],
  removed: [] as string[],
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        upload: async (path: string, _file: File, opts: { contentType: string }) => {
          store.uploads.push({ path, type: opts.contentType });
          return { error: null };
        },
        getPublicUrl: (path: string) => ({
          data: {
            publicUrl: `https://abc.supabase.co/storage/v1/object/public/menu-images/${path}`,
          },
        }),
        remove: async (paths: string[]) => {
          store.removed.push(...paths);
          return { error: null };
        },
      }),
    },
  }),
}));

import { ImageUpload } from "@/components/dashboard/ImageUpload";

afterEach(cleanup);
beforeEach(() => {
  store.uploads = [];
  store.removed = [];
});

const MB = 1024 * 1024;

function file(name: string, type: string, bytes: number) {
  return new File([new Uint8Array(bytes)], name, { type });
}

function pick(container: HTMLElement, f: File) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [f] } });
}

// A form that keeps the URL until submit, like the dish and add-staff forms.
function Form({ savesLater }: { savesLater?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  return <ImageUpload pathPrefix="r1" value={url} onChange={setUrl} savesLater={savesLater} />;
}

describe("ImageUpload", () => {
  it("refuses an image over 1 MB before sending anything", async () => {
    const onChange = vi.fn();
    const { container } = render(<ImageUpload pathPrefix="r1" value={null} onChange={onChange} />);
    pick(container, file("big.jpg", "image/jpeg", MB + 1));

    expect(await screen.findByText(/under 1 MB/)).toBeTruthy();
    expect(store.uploads).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("refuses types the browser cannot show, such as HEIC", async () => {
    const onChange = vi.fn();
    const { container } = render(<ImageUpload pathPrefix="r1" value={null} onChange={onChange} />);
    pick(container, file("photo.heic", "image/heic", 1000));

    expect(await screen.findByText(/Please choose a JPG, PNG or WebP image/)).toBeTruthy();
    expect(store.uploads).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("uploads an image within the limit under the prefix and reports its URL", async () => {
    const onChange = vi.fn();
    const { container } = render(<ImageUpload pathPrefix="r1" value={null} onChange={onChange} />);
    pick(container, file("ok.png", "image/png", MB));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(store.uploads).toHaveLength(1);
    expect(store.uploads[0].path).toMatch(/^r1\/[^/]+\.png$/);
    expect(store.uploads[0].type).toBe("image/png");
    expect(onChange.mock.calls[0][0]).toBe(
      `https://abc.supabase.co/storage/v1/object/public/menu-images/${store.uploads[0].path}`,
    );
  });

  it("with savesLater, deletes an unsaved upload when it is replaced or removed", async () => {
    const { container } = render(<Form savesLater />);
    pick(container, file("one.jpg", "image/jpeg", 1000));
    await waitFor(() => expect(store.uploads).toHaveLength(1));

    pick(container, file("two.jpg", "image/jpeg", 1000));
    await waitFor(() => expect(store.uploads).toHaveLength(2));
    await waitFor(() => expect(store.removed).toEqual([store.uploads[0].path]));

    fireEvent.click(screen.getByText("Remove"));
    await waitFor(() =>
      expect(store.removed).toEqual([store.uploads[0].path, store.uploads[1].path]),
    );
  });

  it("without savesLater, leaves deletion to the server action", async () => {
    const { container } = render(<Form />);
    pick(container, file("one.jpg", "image/jpeg", 1000));
    await waitFor(() => expect(store.uploads).toHaveLength(1));
    pick(container, file("two.jpg", "image/jpeg", 1000));
    await waitFor(() => expect(store.uploads).toHaveLength(2));

    expect(store.removed).toEqual([]);
  });
});
