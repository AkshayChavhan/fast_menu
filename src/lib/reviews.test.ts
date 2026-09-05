import { describe, it, expect } from "vitest";

import {
  publicReviewPath,
  normalizeQuestions,
  normalizeRatings,
  settingsFromForm,
  averageRating,
  DEFAULT_REVIEW_SETTINGS,
} from "@/lib/reviews";
import type { ReviewForm } from "@/types/db";

// A saved row, spread into to vary one field at a time.
function form(over: Partial<ReviewForm> = {}): ReviewForm {
  return {
    id: "f1",
    restaurant_id: "r1",
    is_enabled: true,
    headline: "Custom headline",
    intro: null,
    questions: [{ id: "q1", prompt: "Custom prompt" }],
    ask_name: false,
    ask_comment: true,
    comment_label: "Say more",
    thank_you_message: "Ta",
    show_on_menu: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

describe("publicReviewPath", () => {
  it("builds the /r/<slug> route", () => {
    expect(publicReviewPath("my-cafe")).toBe("/r/my-cafe");
  });
});

describe("normalizeQuestions", () => {
  it("keeps well-formed entries and trims the prompt", () => {
    expect(normalizeQuestions([{ id: "a", prompt: "  How was it?  " }])).toEqual([
      { id: "a", prompt: "How was it?" },
    ]);
  });

  it("returns empty for anything that isn't an array", () => {
    // `questions` is jsonb, so it can be anything if hand-edited in SQL.
    for (const bad of [null, undefined, {}, "nope", 42]) {
      expect(normalizeQuestions(bad)).toEqual([]);
    }
  });

  it("drops entries missing an id or prompt", () => {
    expect(
      normalizeQuestions([
        { id: "a", prompt: "keep" },
        { id: "b" },
        { prompt: "no id" },
        { id: "", prompt: "blank id" },
        { id: "c", prompt: "   " },
        null,
        "string",
      ]),
    ).toEqual([{ id: "a", prompt: "keep" }]);
  });

  it("keeps only the first of a duplicated id", () => {
    // Two rows sharing an id would make one answer overwrite the other.
    expect(
      normalizeQuestions([
        { id: "dup", prompt: "first" },
        { id: "dup", prompt: "second" },
      ]),
    ).toEqual([{ id: "dup", prompt: "first" }]);
  });

  it("rejects non-string ids", () => {
    expect(normalizeQuestions([{ id: 7, prompt: "numeric id" }])).toEqual([]);
  });
});

describe("normalizeRatings", () => {
  it("keeps a well-formed answer", () => {
    expect(
      normalizeRatings([{ question_id: "q1", prompt: "P", rating: 4 }]),
    ).toEqual([{ question_id: "q1", prompt: "P", rating: 4 }]);
  });

  it("clamps out-of-range ratings into 1..5", () => {
    const out = normalizeRatings([
      { question_id: "a", prompt: "P", rating: 0 },
      { question_id: "b", prompt: "P", rating: -3 },
      { question_id: "c", prompt: "P", rating: 99 },
    ]);
    expect(out.map((r) => r.rating)).toEqual([1, 1, 5]);
  });

  it("rounds fractional ratings", () => {
    const out = normalizeRatings([{ question_id: "a", prompt: "P", rating: 3.7 }]);
    expect(out[0].rating).toBe(4);
  });

  it("drops entries with a non-finite or missing rating", () => {
    expect(
      normalizeRatings([
        { question_id: "a", prompt: "P", rating: Number.NaN },
        { question_id: "b", prompt: "P", rating: Number.POSITIVE_INFINITY },
        { question_id: "c", prompt: "P" },
        { question_id: "d", prompt: "P", rating: "5" },
      ]),
    ).toEqual([]);
  });

  it("substitutes empty strings for missing text fields", () => {
    const out = normalizeRatings([{ rating: 3 }]);
    expect(out).toEqual([{ question_id: "", prompt: "", rating: 3 }]);
  });

  it("returns empty for a non-array", () => {
    expect(normalizeRatings("nope")).toEqual([]);
  });
});

describe("settingsFromForm", () => {
  it("falls back to the defaults when no row exists", () => {
    expect(settingsFromForm(null)).toEqual(DEFAULT_REVIEW_SETTINGS);
    expect(settingsFromForm(undefined)).toEqual(DEFAULT_REVIEW_SETTINGS);
  });

  it("returns a copy, so callers can't mutate the shared defaults", () => {
    const a = settingsFromForm(null);
    a.headline = "changed";
    expect(DEFAULT_REVIEW_SETTINGS.headline).not.toBe("changed");
  });

  it("prefers the saved row over the defaults", () => {
    const s = settingsFromForm(form());
    expect(s.headline).toBe("Custom headline");
    expect(s.ask_name).toBe(false);
    expect(s.show_on_menu).toBe(false);
  });

  it("preserves a deliberately empty question list", () => {
    // A saved form with no questions is a comment-only form, not an unsaved
    // one — re-seeding the defaults here would resurrect deleted questions.
    expect(settingsFromForm(form({ questions: [] })).questions).toEqual([]);
  });

  it("cleans malformed questions coming out of jsonb", () => {
    const s = settingsFromForm(
      form({ questions: [{ id: "ok", prompt: "Fine" }, { id: "bad" }] as never }),
    );
    expect(s.questions).toEqual([{ id: "ok", prompt: "Fine" }]);
  });
});

describe("averageRating", () => {
  it("is null when nothing was rated", () => {
    expect(averageRating([])).toBeNull();
  });

  it("averages and rounds to one decimal", () => {
    const r = (rating: number) => ({ question_id: "q", prompt: "p", rating });
    expect(averageRating([r(5), r(4)])).toBe(4.5);
    expect(averageRating([r(5), r(4), r(4)])).toBe(4.3);
    expect(averageRating([r(1), r(2)])).toBe(1.5);
  });

  it("fits the numeric(2,1) column the value is stored in", () => {
    const r = (rating: number) => ({ question_id: "q", prompt: "p", rating });
    const avg = averageRating([r(5), r(5), r(4)]);
    expect(avg).not.toBeNull();
    expect(String(avg)).toMatch(/^\d(\.\d)?$/);
  });
});
