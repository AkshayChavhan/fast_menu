// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThemeToggle } from "@/components/menu/ThemeToggle";

beforeEach(() => {
  document.documentElement.className = "";
  localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ThemeToggle", () => {
  it("flips between light and dark and says what it will do", async () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: "Switch to dark mode" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    // The label follows once the class change is observed.
    fireEvent.click(await screen.findByRole("button", { name: "Switch to light mode" }));
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(await screen.findByRole("button", { name: "Switch to dark mode" })).toBeTruthy();
  });
});
