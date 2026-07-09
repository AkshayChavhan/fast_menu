"use client";

import { useMemo, useState, useCallback } from "react";
import { Search, X, SlidersHorizontal, SearchX } from "lucide-react";
import { cn } from "@/lib/utils";
import { DishCard } from "./DishCard";
import { DietaryBadge } from "./badges";
import { CategoryNav } from "./CategoryNav";
import type { CategoryView, DishView } from "./types";

// Client-side orchestrator: search box + dietary-tag filter chips + the
// category quick-nav + rendered sections. All data arrives pre-resolved from
// the server, so filtering is instant and there are no client data waterfalls.
export function MenuBrowser({
  categories,
  hideUnavailable,
}: {
  categories: CategoryView[];
  /** When true, 86'd dishes are hidden entirely instead of shown dimmed. */
  hideUnavailable: boolean;
}) {
  const [query, setQuery] = useState("");
  const [activeTags, setActiveTags] = useState<string[]>([]);

  // Every dietary tag actually present on this menu, for the filter chips.
  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const cat of categories) {
      for (const dish of cat.dishes) {
        for (const tag of dish.dietaryTags) set.add(tag);
      }
    }
    return Array.from(set).sort();
  }, [categories]);

  const toggleTag = useCallback((tag: string) => {
    setActiveTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }, []);

  const clearFilters = useCallback(() => {
    setQuery("");
    setActiveTags([]);
  }, []);

  const q = query.trim().toLowerCase();
  const hasFilters = q.length > 0 || activeTags.length > 0;

  const matches = useCallback(
    (dish: DishView) => {
      if (hideUnavailable && !dish.isAvailable) return false;
      if (q && !dish.searchText.includes(q)) return false;
      if (
        activeTags.length > 0 &&
        !activeTags.every((t) => dish.dietaryTags.includes(t))
      ) {
        return false;
      }
      return true;
    },
    [q, activeTags, hideUnavailable],
  );

  // Filtered categories (dropping ones with no surviving dishes).
  const filtered = useMemo(() => {
    return categories
      .map((cat) => ({ ...cat, dishes: cat.dishes.filter(matches) }))
      .filter((cat) => cat.dishes.length > 0);
  }, [categories, matches]);

  const totalMatches = filtered.reduce((n, c) => n + c.dishes.length, 0);

  return (
    <div>
      {/* Controls */}
      <div className="mx-auto max-w-5xl px-4 pt-5">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-400"
            aria-hidden
          />
          <input
            type="search"
            inputMode="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search dishes…"
            aria-label="Search dishes"
            className="w-full rounded-2xl border border-neutral-200 bg-white py-3 pl-12 pr-11 text-base text-neutral-900 shadow-sm outline-none ring-brand-500/20 transition placeholder:text-neutral-400 focus:border-brand-400 focus:ring-4 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>

        {availableTags.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-neutral-500 dark:text-neutral-400">
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
              Filter
            </span>
            {availableTags.map((tag) => {
              const on = activeTags.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  aria-pressed={on}
                  className={cn(
                    "rounded-full transition",
                    on
                      ? "ring-2 ring-brand-400 ring-offset-1 ring-offset-transparent"
                      : "opacity-80 hover:opacity-100",
                  )}
                >
                  <DietaryBadge tag={tag} />
                </button>
              );
            })}
            {hasFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold text-neutral-500 underline-offset-2 transition hover:text-brand-600 hover:underline dark:text-neutral-400"
              >
                <X className="h-3 w-3" aria-hidden />
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      {/* Quick-nav: only meaningful when not filtering to a subset. */}
      {!hasFilters && filtered.length > 1 && (
        <CategoryNav
          categories={filtered.map((c) => ({ id: c.anchor, name: c.name }))}
        />
      )}

      {/* Sections */}
      {filtered.length === 0 ? (
        <EmptyState hasFilters={hasFilters} onClear={clearFilters} />
      ) : (
        <div className="mx-auto max-w-5xl space-y-12 px-4 py-8 sm:py-10">
          {hasFilters && (
            <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
              {totalMatches} {totalMatches === 1 ? "dish" : "dishes"} match
            </p>
          )}
          {filtered.map((cat) => (
            <section
              key={cat.id}
              id={cat.anchor}
              aria-labelledby={`${cat.anchor}-heading`}
              className="scroll-mt-32"
            >
              <div className="mb-5">
                <h2
                  id={`${cat.anchor}-heading`}
                  className="flex items-center gap-3 text-2xl font-extrabold tracking-tight text-neutral-900 dark:text-neutral-50"
                >
                  <span>{cat.name}</span>
                  <span
                    aria-hidden
                    className="h-px flex-1 bg-gradient-to-r from-brand-200 to-transparent dark:from-brand-900"
                  />
                </h2>
                {cat.description && (
                  <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                    {cat.description}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {cat.dishes.map((dish) => (
                  <DishCard key={dish.id} dish={dish} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({
  hasFilters,
  onClear,
}: {
  hasFilters: boolean;
  onClear: () => void;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 text-brand-500 dark:bg-brand-950/50">
        <SearchX className="h-8 w-8" aria-hidden />
      </div>
      <h3 className="text-lg font-bold text-neutral-800 dark:text-neutral-100">
        {hasFilters ? "No matching dishes" : "Nothing on the menu yet"}
      </h3>
      <p className="mt-1.5 text-sm text-neutral-500 dark:text-neutral-400">
        {hasFilters
          ? "Try a different search or clear your filters to see everything."
          : "This restaurant hasn’t added any dishes yet. Check back soon!"}
      </p>
      {hasFilters && (
        <button
          type="button"
          onClick={onClear}
          className="mt-5 rounded-full bg-brand-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
