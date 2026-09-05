// @vitest-environment jsdom
import { useState } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { StarRating } from "@/components/reviews/StarRating";

afterEach(cleanup);

// The component is controlled, so interaction tests need a parent that holds
// the value — otherwise a click calls onChange and nothing visibly changes.
function Controlled({ initial = 0 }: { initial?: number }) {
  const [value, setValue] = useState(initial);
  return <StarRating value={value} onChange={setValue} label="How was it?" />;
}

const isLit = (star: HTMLElement) =>
  star.querySelector("svg")?.getAttribute("class")?.includes("fill-amber-400") ??
  false;

const litCount = () => screen.getAllByRole("radio").filter(isLit).length;

describe("StarRating — read-only", () => {
  it("renders no interactive controls", () => {
    render(<StarRating value={3} />);
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("announces the score", () => {
    render(<StarRating value={3} />);
    screen.getByLabelText("3 out of 5 stars");
  });

  it("lights a whole number of stars", () => {
    const { container } = render(<StarRating value={3} />);
    const lit = container.querySelectorAll("svg.fill-amber-400");
    expect(lit).toHaveLength(3);
  });

  it("rounds a fractional average for display", () => {
    // overall_rating is numeric(2,1), so 4.4 and 4.5 both reach this.
    const { container } = render(<StarRating value={4.4} />);
    expect(container.querySelectorAll("svg.fill-amber-400")).toHaveLength(4);
    cleanup();
    const next = render(<StarRating value={4.5} />);
    expect(next.container.querySelectorAll("svg.fill-amber-400")).toHaveLength(5);
  });
});

describe("StarRating — interactive", () => {
  it("exposes a labelled radiogroup of five options", () => {
    render(<Controlled />);
    screen.getByRole("radiogroup", { name: "How was it?" });
    expect(screen.getAllByRole("radio")).toHaveLength(5);
  });

  it("starts with nothing lit", () => {
    render(<Controlled />);
    expect(litCount()).toBe(0);
    expect(screen.queryByRole("radio", { checked: true })).toBeNull();
  });

  it("lights up to the clicked star", async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.click(screen.getByRole("radio", { name: "4 stars" }));
    expect(litCount()).toBe(4);
    expect(
      screen.getByRole("radio", { name: "4 stars" }).getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("singularises the one-star label", () => {
    render(<Controlled />);
    screen.getByRole("radio", { name: "1 star" });
    screen.getByRole("radio", { name: "2 stars" });
  });

  it("can be lowered as well as raised", async () => {
    const user = userEvent.setup();
    render(<Controlled initial={5} />);
    await user.click(screen.getByRole("radio", { name: "2 stars" }));
    expect(litCount()).toBe(2);
  });

  it("reports each change to the parent", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StarRating value={0} onChange={onChange} />);
    await user.click(screen.getByRole("radio", { name: "5 stars" }));
    expect(onChange).toHaveBeenCalledWith(5);
  });

  it("previews on hover without committing", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StarRating value={0} onChange={onChange} />);

    await user.hover(screen.getByRole("radio", { name: "3 stars" }));
    expect(litCount()).toBe(3);
    expect(onChange).not.toHaveBeenCalled();

    await user.unhover(screen.getByRole("radio", { name: "3 stars" }));
    expect(litCount()).toBe(0);
  });
});

describe("StarRating — keyboard", () => {
  it("is a single tab stop, entered at the first star when unset", async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("radio", { name: "1 star" }),
    );
  });

  it("moves the tab stop to the selected star", () => {
    render(<Controlled initial={3} />);
    const stars = screen.getAllByRole("radio");
    expect(stars.map((s) => s.getAttribute("tabindex"))).toEqual([
      "-1",
      "-1",
      "0",
      "-1",
      "-1",
    ]);
  });

  it("raises the score with ArrowRight and ArrowUp", async () => {
    const user = userEvent.setup();
    render(<Controlled initial={2} />);
    screen.getByRole("radio", { name: "2 stars" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(litCount()).toBe(3);
    await user.keyboard("{ArrowUp}");
    expect(litCount()).toBe(4);
  });

  it("lowers the score with ArrowLeft and ArrowDown", async () => {
    const user = userEvent.setup();
    render(<Controlled initial={4} />);
    screen.getByRole("radio", { name: "4 stars" }).focus();
    await user.keyboard("{ArrowLeft}");
    expect(litCount()).toBe(3);
    await user.keyboard("{ArrowDown}");
    expect(litCount()).toBe(2);
  });

  it("clamps at both ends", async () => {
    const user = userEvent.setup();
    render(<Controlled initial={5} />);
    screen.getByRole("radio", { name: "5 stars" }).focus();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(litCount()).toBe(5);

    cleanup();
    render(<Controlled initial={1} />);
    screen.getByRole("radio", { name: "1 star" }).focus();
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(litCount()).toBe(1);
  });

  it("picks the first star when arrowing up from unset", async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(litCount()).toBe(1);
  });

  it("selects with Enter or Space like any button", async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.tab();
    await user.keyboard("{Enter}");
    expect(litCount()).toBe(1);
  });
});
