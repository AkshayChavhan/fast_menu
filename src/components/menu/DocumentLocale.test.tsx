// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

import { DocumentLocale } from "@/components/menu/DocumentLocale";

afterEach(() => {
  cleanup();
  // The component mutates the shared <html> element, so reset between tests.
  document.documentElement.lang = "";
  document.documentElement.dir = "";
});

describe("DocumentLocale", () => {
  it("applies the locale and direction to <html> on a soft navigation", () => {
    document.documentElement.lang = "en";
    document.documentElement.dir = "ltr";

    render(<DocumentLocale locale="ar" dir="rtl" />);

    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
  });

  it("follows a language switch without a reload", () => {
    const { rerender } = render(<DocumentLocale locale="ar" dir="rtl" />);
    rerender(<DocumentLocale locale="ta" dir="ltr" />);

    expect(document.documentElement.lang).toBe("ta");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("restores the previous values when the menu unmounts", () => {
    document.documentElement.lang = "en";
    document.documentElement.dir = "ltr";

    const { unmount } = render(<DocumentLocale locale="ur" dir="rtl" />);
    unmount();

    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("renders the inline script inert on the client so it can't run twice", () => {
    const { container } = render(<DocumentLocale locale="ar" dir="rtl" />);
    const script = container.querySelector("script");

    expect(script).not.toBeNull();
    expect(script?.getAttribute("type")).toBe("text/plain");
  });

  it("escapes the locale so a database value can't break out of the script", () => {
    const { container } = render(
      <DocumentLocale locale={'ar";alert(1);//'} dir="rtl" />,
    );
    const html = container.querySelector("script")?.innerHTML ?? "";

    // The payload survives only as a quoted string literal, never as syntax.
    expect(html).toContain('"ar\\";alert(1);//"');
    expect(html).not.toContain('"ar";alert(1);//"');
  });
});
