// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/m/mayavi",
  useSearchParams: () => new URLSearchParams(),
}));

import { MenuHeader, MENU_HERO_ID } from "@/components/menu/MenuHeader";
import { MenuHero } from "@/components/menu/MenuHero";

// jsdom has no IntersectionObserver: a stand-in the test can drive.
type Entry = Pick<IntersectionObserverEntry, "isIntersecting"> & {
  boundingClientRect: { bottom: number };
};
let fire: ((e: Entry) => void) | null = null;
let observed: Element | null = null;
const disconnect = vi.fn();

beforeEach(() => {
  fire = null;
  observed = null;
  disconnect.mockReset();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: (entries: Entry[]) => void) {
        fire = (e) => cb([e]);
      }
      observe(el: Element) {
        observed = el;
      }
      disconnect = disconnect;
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Page() {
  return (
    <>
      <MenuHeader name="Mayavi" logoUrl={null} locales={["en"]} activeLocale="en" />
      <MenuHero name="Mayavi" description={null} logoUrl={null} />
    </>
  );
}

const header = () => screen.getByRole("banner", { hidden: true });

describe("MenuHeader", () => {
  it("watches the banner MenuHero renders", () => {
    render(<Page />);
    expect(observed).not.toBeNull();
    expect(observed!.id).toBe(MENU_HERO_ID);
  });

  it("is hidden on load, while the banner is on screen", () => {
    render(<Page />);
    act(() => fire!({ isIntersecting: true, boundingClientRect: { bottom: 300 } }));
    expect(header().dataset.shown).toBe("false");
    expect(header().getAttribute("aria-hidden")).toBe("true");
    expect(header().hasAttribute("inert")).toBe(true);
  });

  it("shows once the banner's bottom edge has passed the top of the screen", () => {
    render(<Page />);
    act(() => fire!({ isIntersecting: false, boundingClientRect: { bottom: -1 } }));
    expect(header().dataset.shown).toBe("true");
    expect(header().hasAttribute("inert")).toBe(false);
  });

  it("hides again when the guest scrolls back up to the banner", () => {
    render(<Page />);
    act(() => fire!({ isIntersecting: false, boundingClientRect: { bottom: -1 } }));
    act(() => fire!({ isIntersecting: true, boundingClientRect: { bottom: 40 } }));
    expect(header().dataset.shown).toBe("false");
  });

  it("stays hidden when the banner is out of view below the screen", () => {
    render(<Page />);
    act(() => fire!({ isIntersecting: false, boundingClientRect: { bottom: 2000 } }));
    expect(header().dataset.shown).toBe("false");
  });

  it("leaves the page's only heading to the banner", () => {
    render(<Page />);
    expect(screen.getAllByRole("heading", { level: 1, hidden: true })).toHaveLength(1);
  });

  it("stops watching when it unmounts", () => {
    const { unmount } = render(<Page />);
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});
