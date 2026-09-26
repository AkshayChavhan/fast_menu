// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MobileNav } from "@/components/dashboard/MobileNav";

// The nav uses usePathname(); jsdom has no Next router.
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard/reviews" }));

afterEach(cleanup);

const setup = () =>
  render(<MobileNav restaurantName="Yaadi Jagadamba" role="owner" />);

// The drawer stays mounted so it can slide, which is what made both of these
// bugs possible: it was overflowing and focusable while "closed".
const panel = () => document.querySelector(".fixed.inset-0") as HTMLElement;

// React 19 renders `inert` as a bare attribute and omits it when false. jsdom
// doesn't implement the reflected `.inert` property, so assert the attribute.
const isInert = () => panel().hasAttribute("inert");

describe("MobileNav", () => {
  it("opens and closes from the hamburger", async () => {
    const user = userEvent.setup();
    setup();

    expect(isInert()).toBe(true);

    await user.click(screen.getByLabelText("Open navigation"));
    expect(isInert()).toBe(false);

    await user.click(screen.getByLabelText("Close navigation"));
    expect(isInert()).toBe(true);
  });

  it("keeps the closed drawer out of the tab order and the a11y tree", () => {
    setup();
    expect(panel().getAttribute("aria-hidden")).toBe("true");
    // inert removes the whole subtree from focus, so the links inside can't be
    // tabbed into while the drawer is off-screen.
    expect(isInert()).toBe(true);
  });

  // The reported bug: with 10 items and the Review group auto-expanded, the
  // list was taller than the panel and painted over the page behind it.
  it("scrolls the nav inside the panel instead of overflowing it", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByLabelText("Open navigation"));

    const scroller = screen.getByRole("navigation").parentElement!;
    expect(scroller.className).toContain("overflow-y-auto");
    // Without min-h-0 a flex child refuses to shrink below its content, so the
    // overflow-y-auto above would never actually engage.
    expect(scroller.className).toContain("min-h-0");
    expect(scroller.className).toContain("flex-1");
  });

  it("closes when a destination is chosen", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByLabelText("Open navigation"));

    await user.click(screen.getByRole("link", { name: /Overview/ }));
    expect(isInert()).toBe(true);
  });
});
