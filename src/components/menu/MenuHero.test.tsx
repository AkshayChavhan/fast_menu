// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { MenuHero } from "@/components/menu/MenuHero";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    // Drop next/image's own props; a plain img is enough for these tests.
    const rest = Object.fromEntries(
      Object.entries(props).filter(([k]) => k !== "fill" && k !== "priority"),
    );
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...(rest as React.ImgHTMLAttributes<HTMLImageElement>)} />;
  },
}));

describe("MenuHero", () => {
  it("is the plain banner when there is no video", () => {
    const { container } = render(<MenuHero name="Mayavi" description="Cave dining" logoUrl={null} />);
    expect(screen.getByRole("heading", { level: 1, name: "Mayavi" })).toBeTruthy();
    expect(container.querySelector("video")).toBeNull();
    expect(screen.queryByTestId("hero-shade")).toBeNull();
  });

  it("plays the clip behind the text under a top-heavy shade", () => {
    const { container } = render(
      <MenuHero
        name="Mayavi"
        description="Cave dining"
        logoUrl={null}
        videoUrl="https://x.supabase.co/storage/v1/object/public/menu-videos/r/a.mp4"
      />,
    );
    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    // Autoplay on phones needs muted + playsInline; it is decoration, not content.
    expect(video?.muted).toBe(true);
    expect(video?.getAttribute("playsinline")).not.toBeNull();
    expect(video?.getAttribute("aria-hidden")).toBe("true");

    const shade = screen.getByTestId("hero-shade");
    expect(shade.className).toContain("from-black/70");
    expect(shade.className).toContain("to-black/30");

    // The text is above the shade, in the DOM order the browser paints.
    const heading = screen.getByRole("heading", { level: 1, name: "Mayavi" });
    expect(shade.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(heading.className).toContain("text-white");
  });
});
