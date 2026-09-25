// Runs in the default `node` environment (no jsdom) so `typeof window` is
// "undefined", exercising the server-render branch — the one that matters for
// a QR scan, where the script has to run before the first paint.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { DocumentLocale } from "@/components/menu/DocumentLocale";

describe("DocumentLocale (server render)", () => {
  it("emits an executable script that sets lang and dir", () => {
    const html = renderToStaticMarkup(
      <DocumentLocale locale="ar" dir="rtl" />,
    );

    expect(html).toContain('type="text/javascript"');
    expect(html).toContain('document.documentElement.lang="ar"');
    expect(html).toContain('document.documentElement.dir="rtl"');
  });
});
