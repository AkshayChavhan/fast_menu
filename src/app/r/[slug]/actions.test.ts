import { describe, it, expect, vi, beforeEach } from "vitest";

import type { ReviewForm } from "@/types/db";

// --- Test doubles -----------------------------------------------------------

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  restaurant: null as Row | null,
  form: null as Row | null,
  insertError: null as { message: string } | null,
  inserted: [] as Row[],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from(table: string) {
      if (table === "reviews") {
        return {
          insert: (row: Row) => {
            state.inserted.push(row);
            return Promise.resolve({ error: state.insertError });
          },
        };
      }
      // restaurants / review_forms both end in .maybeSingle()
      const data = table === "restaurants" ? state.restaurant : state.form;
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve({ data, error: null }),
      };
      return chain;
    },
  }),
}));

import { submitReview } from "@/app/r/[slug]/actions";

function form(over: Partial<ReviewForm> = {}): Row {
  return {
    id: "f1",
    restaurant_id: "r1",
    is_enabled: true,
    headline: "How was it?",
    intro: null,
    questions: [
      { id: "food", prompt: "How was the food?" },
      { id: "service", prompt: "How was the service?" },
    ],
    ask_name: true,
    ask_comment: true,
    comment_label: "More?",
    thank_you_message: "Cheers!",
    show_on_menu: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function submission(over: {
  slug?: string;
  guest_name?: string;
  comment?: string;
  answers?: unknown;
} = {}) {
  const fd = new FormData();
  fd.set("slug", over.slug ?? "my-cafe");
  fd.set("guest_name", over.guest_name ?? "");
  fd.set("comment", over.comment ?? "");
  fd.set(
    "answers",
    typeof over.answers === "string"
      ? over.answers
      : JSON.stringify(over.answers ?? [{ question_id: "food", rating: 5 }]),
  );
  return fd;
}

const run = (fd: FormData) => submitReview(null, fd);

beforeEach(() => {
  state.restaurant = { id: "r1" };
  state.form = form();
  state.insertError = null;
  state.inserted = [];
});

// --- Tests ------------------------------------------------------------------

describe("submitReview — reachability", () => {
  it("refuses when the slug resolves to nothing", async () => {
    // RLS hides unpublished and expired-trial restaurants, so "not found" here
    // is also how "not allowed" arrives.
    state.restaurant = null;
    const res = await run(submission());
    expect(res).toEqual({ ok: false, error: "This review page is no longer available" });
    expect(state.inserted).toHaveLength(0);
  });

  it("refuses when the form is switched off", async () => {
    state.form = form({ is_enabled: false });
    const res = await run(submission());
    expect(res.ok).toBe(false);
    expect(state.inserted).toHaveLength(0);
  });

  it("works before any form row exists, using the defaults", async () => {
    state.form = null;
    const res = await run(
      submission({ answers: [{ question_id: "food", rating: 4 }] }),
    );
    expect(res.ok).toBe(true);
    expect(state.inserted[0].ratings).toEqual([
      { question_id: "food", prompt: "How was the food?", rating: 4 },
    ]);
  });
});

describe("submitReview — hostile input", () => {
  it("always writes status 'pending'", async () => {
    await run(submission());
    expect(state.inserted[0].status).toBe("pending");
  });

  it("takes the restaurant from the slug, never from the payload", async () => {
    const fd = submission();
    fd.set("restaurant_id", "attacker-controlled");
    await run(fd);
    expect(state.inserted[0].restaurant_id).toBe("r1");
  });

  it("drops answers to questions that aren't on the live form", async () => {
    const res = await run(
      submission({
        answers: [
          { question_id: "food", rating: 5 },
          { question_id: "not-a-real-question", rating: 1 },
        ],
      }),
    );
    expect(res.ok).toBe(true);
    expect(state.inserted[0].ratings).toEqual([
      { question_id: "food", prompt: "How was the food?", rating: 5 },
    ]);
  });

  it("ignores a client-supplied prompt and uses the stored wording", async () => {
    // Otherwise a guest could write arbitrary text into the owner's dashboard.
    await run(
      submission({
        answers: [
          { question_id: "food", rating: 5, prompt: "<script>alert(1)</script>" },
        ],
      }),
    );
    expect(state.inserted[0].ratings).toEqual([
      { question_id: "food", prompt: "How was the food?", rating: 5 },
    ]);
  });

  it("keeps only the first answer to a repeated question", async () => {
    await run(
      submission({
        answers: [
          { question_id: "food", rating: 5 },
          { question_id: "food", rating: 1 },
        ],
      }),
    );
    expect(state.inserted[0].ratings).toHaveLength(1);
    expect((state.inserted[0].ratings as { rating: number }[])[0].rating).toBe(5);
  });

  it("rejects a rating outside 1..5", async () => {
    for (const rating of [0, 6, -1, 2.5]) {
      state.inserted = [];
      const res = await run(submission({ answers: [{ question_id: "food", rating }] }));
      expect(res.ok, `rating ${rating} should be rejected`).toBe(false);
      expect(state.inserted).toHaveLength(0);
    }
  });

  it("rejects malformed JSON in the answers field", async () => {
    const res = await run(submission({ answers: "{not json" }));
    expect(res).toEqual({ ok: false, error: "Could not read your ratings" });
  });

  it("rejects a comment over the length limit", async () => {
    const res = await run(submission({ comment: "x".repeat(601) }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/600 characters/);
  });

  it("discards a name when the form doesn't ask for one", async () => {
    state.form = form({ ask_name: false });
    await run(submission({ guest_name: "Sneaky" }));
    expect(state.inserted[0].guest_name).toBeNull();
  });

  it("discards a comment when the form doesn't ask for one", async () => {
    state.form = form({ ask_comment: false });
    await run(submission({ comment: "Unwanted" }));
    expect(state.inserted[0].comment).toBeNull();
  });
});

describe("submitReview — empty submissions", () => {
  it("rejects one with no ratings and no comment", async () => {
    const res = await run(submission({ answers: [] }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/rate at least one/);
    expect(state.inserted).toHaveLength(0);
  });

  it("accepts a comment-only submission on a form with no questions", async () => {
    state.form = form({ questions: [] });
    const res = await run(submission({ answers: [], comment: "Lovely evening" }));
    expect(res.ok).toBe(true);
    expect(state.inserted[0].overall_rating).toBeNull();
  });

  it("asks for a comment when the form has no star questions", async () => {
    state.form = form({ questions: [] });
    const res = await run(submission({ answers: [], comment: "" }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/write a short comment/);
  });

  it("treats a whitespace-only comment as empty", async () => {
    const res = await run(submission({ answers: [], comment: "   " }));
    expect(res.ok).toBe(false);
  });
});

describe("submitReview — stored values", () => {
  it("averages the ratings into overall_rating", async () => {
    await run(
      submission({
        answers: [
          { question_id: "food", rating: 5 },
          { question_id: "service", rating: 4 },
        ],
      }),
    );
    expect(state.inserted[0].overall_rating).toBe(4.5);
  });

  it("trims the name and stores an empty one as null", async () => {
    await run(submission({ guest_name: "  Asha  " }));
    expect(state.inserted[0].guest_name).toBe("Asha");

    state.inserted = [];
    await run(submission({ guest_name: "   " }));
    expect(state.inserted[0].guest_name).toBeNull();
  });

  it("returns the restaurant's thank-you message", async () => {
    state.form = form({ thank_you_message: "Dhanyavaad!" });
    const res = await run(submission());
    expect(res).toEqual({ ok: true, message: "Dhanyavaad!" });
  });

  it("returns the default thank-you message when no form is saved", async () => {
    state.form = null;
    const res = await run(submission());
    expect(res.ok && res.message).toBe("Thank you for your feedback!");
  });

  it("hides the database error behind a friendly message", async () => {
    state.insertError = { message: 'duplicate key value violates "reviews_pkey"' };
    const res = await run(submission());
    expect(res).toEqual({
      ok: false,
      error: "We couldn't save your review. Please try again.",
    });
  });
});
