// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  applyTheme,
  currentTheme,
  subscribeTheme,
} from "@/lib/theme";

const html = () => document.documentElement;

function deviceIsDark(dark: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: dark && q.includes("dark"),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

beforeEach(() => {
  html().className = "";
  localStorage.clear();
  deviceIsDark(false);
});
afterEach(() => vi.unstubAllGlobals());

describe("theme", () => {
  it("follows the device until the guest chooses", () => {
    expect(currentTheme()).toBe("light");
    deviceIsDark(true);
    expect(currentTheme()).toBe("dark");
  });

  it("a choice beats the device and is remembered", () => {
    deviceIsDark(true);
    applyTheme("light");
    expect(currentTheme()).toBe("light");
    expect(html().classList.contains("dark")).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    applyTheme("dark");
    expect(html().className).toBe("dark");
  });

  it("the head script restores a saved choice", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    new Function(THEME_INIT_SCRIPT)();
    expect(html().classList.contains("dark")).toBe(true);
  });

  it("the head script ignores anything that isn't a theme", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "evil onload=x");
    new Function(THEME_INIT_SCRIPT)();
    expect(html().className).toBe("");
  });

  it("the head script survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => new Function(THEME_INIT_SCRIPT)()).not.toThrow();
    vi.restoreAllMocks();
  });

  it("still applies when storage refuses to save", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    applyTheme("dark");
    expect(currentTheme()).toBe("dark");
    vi.restoreAllMocks();
  });

  it("notices a class change on <html>", async () => {
    const onChange = vi.fn();
    const stop = subscribeTheme(onChange);
    html().classList.add("dark");
    await Promise.resolve();
    expect(onChange).toHaveBeenCalled();
    stop();
  });
});
