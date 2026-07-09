"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// Sticky horizontal chip nav. Clicking scrolls to the section; an
// IntersectionObserver keeps the chip for the section currently in view
// highlighted and scrolled into the nav's own viewport.
export function CategoryNav({
  categories,
}: {
  categories: { id: string; name: string }[];
}) {
  const [active, setActive] = useState(categories[0]?.id ?? "");
  const navRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef<Map<string, HTMLAnchorElement>>(new Map());

  useEffect(() => {
    const sections = categories
      .map((c) => document.getElementById(c.id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Choose the top-most section currently intersecting the viewport.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      // Trigger a bit below the sticky header, focus on the top slice.
      { rootMargin: "-128px 0px -65% 0px", threshold: 0 },
    );

    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [categories]);

  // Keep the active chip visible within the scrollable nav.
  useEffect(() => {
    const chip = chipRefs.current.get(active);
    if (chip) {
      chip.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    }
  }, [active]);

  function handleClick(
    e: React.MouseEvent<HTMLAnchorElement>,
    id: string,
  ) {
    e.preventDefault();
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActive(id);
      // Reflect the anchor without a jump.
      history.replaceState(null, "", `#${id}`);
    }
  }

  if (categories.length === 0) return null;

  return (
    <nav
      aria-label="Menu sections"
      className="sticky top-[57px] z-30 border-b border-neutral-200/70 bg-white/85 backdrop-blur-md dark:border-neutral-800/70 dark:bg-neutral-950/85 sm:top-[65px]"
    >
      <div
        ref={navRef}
        className="mx-auto flex max-w-5xl gap-2 overflow-x-auto px-4 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {categories.map((c) => {
          const isActive = c.id === active;
          return (
            <a
              key={c.id}
              href={`#${c.id}`}
              ref={(node) => {
                if (node) chipRefs.current.set(c.id, node);
                else chipRefs.current.delete(c.id);
              }}
              onClick={(e) => handleClick(e, c.id)}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-semibold transition",
                isActive
                  ? "bg-brand-600 text-white shadow-sm shadow-brand-600/30"
                  : "bg-neutral-100 text-neutral-600 hover:bg-brand-50 hover:text-brand-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-brand-950/50 dark:hover:text-brand-300",
              )}
            >
              {c.name}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
