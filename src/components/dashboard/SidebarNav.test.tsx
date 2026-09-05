// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const usePathname = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ usePathname }));

// Real next/link renders an <a href> that jsdom then tries to navigate,
// logging "Not implemented: navigation to another Document". Swap in an
// anchor that blocks the navigation but still forwards the click handler,
// so the onNavigate assertions stay meaningful.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    onClick,
    ...rest
  }: React.ComponentProps<"a"> & { href: string }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        onClick?.(e);
      }}
      {...rest}
    >
      {children}
    </a>
  ),
}));

import { SidebarNav } from "@/components/dashboard/SidebarNav";

afterEach(cleanup);

function renderAt(pathname: string, onNavigate?: () => void) {
  usePathname.mockReturnValue(pathname);
  return render(<SidebarNav onNavigate={onNavigate} />);
}

// The active item is the one carrying the brand background.
const isActive = (el: HTMLElement) =>
  el.className.includes("bg-brand-50");

describe("SidebarNav — top-level items", () => {
  it("renders every destination", () => {
    renderAt("/dashboard");
    for (const label of ["Overview", "Menu", "Preview & QR", "Import / Export", "Settings"]) {
      screen.getByRole("link", { name: label });
    }
  });

  it("marks Overview active only on an exact match", () => {
    renderAt("/dashboard");
    expect(isActive(screen.getByRole("link", { name: "Overview" }))).toBe(true);

    cleanup();
    renderAt("/dashboard/menu");
    // Without the exact flag, Overview would match every dashboard route.
    expect(isActive(screen.getByRole("link", { name: "Overview" }))).toBe(false);
    expect(isActive(screen.getByRole("link", { name: "Menu" }))).toBe(true);
  });

  it("keeps a section active on its sub-routes", () => {
    renderAt("/dashboard/menu/something-deeper");
    expect(isActive(screen.getByRole("link", { name: "Menu" }))).toBe(true);
  });

  it("calls onNavigate when a link is followed", async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    renderAt("/dashboard", onNavigate);
    await user.click(screen.getByRole("link", { name: "Menu" }));
    expect(onNavigate).toHaveBeenCalled();
  });
});

describe("SidebarNav — the Review group", () => {
  it("is collapsed elsewhere in the dashboard", () => {
    renderAt("/dashboard");
    const toggle = screen.getByRole("button", { name: /Review/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("link", { name: "Reviews" })).toBeNull();
  });

  it("expands automatically inside the section", () => {
    renderAt("/dashboard/reviews");
    expect(
      screen.getByRole("button", { name: /Review/ }).getAttribute("aria-expanded"),
    ).toBe("true");
    screen.getByRole("link", { name: "Reviews" });
    screen.getByRole("link", { name: "Review Settings" });
  });

  it("opens and closes on click when you're outside the section", async () => {
    const user = userEvent.setup();
    renderAt("/dashboard");
    const toggle = screen.getByRole("button", { name: /Review/ });

    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    screen.getByRole("link", { name: "Reviews" });

    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("link", { name: "Reviews" })).toBeNull();
  });

  it("marks the group active anywhere inside it", () => {
    renderAt("/dashboard/reviews/settings");
    expect(isActive(screen.getByRole("button", { name: /Review/ }))).toBe(true);
  });

  it("distinguishes the two children by exact match", () => {
    renderAt("/dashboard/reviews/settings");
    const reviews = screen.getByRole("link", { name: "Reviews" });
    const settings = screen.getByRole("link", { name: "Review Settings" });
    // "Reviews" is exact, so it must not light up on the settings sub-route.
    expect(reviews.className).not.toContain("font-medium");
    expect(settings.className).toContain("font-medium");
  });

  it("points its children at the right routes", () => {
    renderAt("/dashboard/reviews");
    expect(
      screen.getByRole("link", { name: "Reviews" }).getAttribute("href"),
    ).toBe("/dashboard/reviews");
    expect(
      screen.getByRole("link", { name: "Review Settings" }).getAttribute("href"),
    ).toBe("/dashboard/reviews/settings");
  });

  it("calls onNavigate from a child link too", async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    renderAt("/dashboard/reviews", onNavigate);
    await user.click(screen.getByRole("link", { name: "Review Settings" }));
    expect(onNavigate).toHaveBeenCalled();
  });

  it("does not make Settings active while in Review Settings", () => {
    renderAt("/dashboard/reviews/settings");
    const nav = screen.getByRole("navigation");
    const settings = within(nav).getByRole("link", { name: "Settings" });
    expect(isActive(settings)).toBe(false);
  });
});
