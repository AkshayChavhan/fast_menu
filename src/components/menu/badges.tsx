import {
  Wheat,
  Milk,
  Egg,
  Fish,
  Shell,
  Nut,
  Bean,
  Sprout,
  Leaf,
  Salad,
  Moon,
  Star,
  Flame,
  CircleSlash,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Allergen badges — small, muted, warning-toned. Purely informational.
// ---------------------------------------------------------------------------
const ALLERGEN_ICON: Record<string, LucideIcon> = {
  gluten: Wheat,
  dairy: Milk,
  eggs: Egg,
  fish: Fish,
  shellfish: Shell,
  "tree-nuts": Nut,
  peanuts: Nut,
  soy: Bean,
  sesame: Sprout,
  celery: Sprout,
  mustard: Sprout,
  sulphites: CircleSlash,
};

function labelize(value: string): string {
  return value
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function AllergenBadge({ allergen }: { allergen: string }) {
  const Icon = ALLERGEN_ICON[allergen] ?? CircleSlash;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200/70 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-800/50"
      title={`Contains ${labelize(allergen)}`}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      {labelize(allergen)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Dietary tags — positive, appetizing accents. chef-special / spicy stand out.
// ---------------------------------------------------------------------------
type TagStyle = { icon: LucideIcon; className: string; label?: string };

const TAG_STYLE: Record<string, TagStyle> = {
  vegan: {
    icon: Leaf,
    className:
      "bg-emerald-50 text-emerald-700 ring-emerald-200/70 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800/50",
  },
  vegetarian: {
    icon: Salad,
    className:
      "bg-green-50 text-green-700 ring-green-200/70 dark:bg-green-950/40 dark:text-green-300 dark:ring-green-800/50",
  },
  halal: {
    icon: Moon,
    className:
      "bg-teal-50 text-teal-700 ring-teal-200/70 dark:bg-teal-950/40 dark:text-teal-300 dark:ring-teal-800/50",
  },
  kosher: {
    icon: Star,
    className:
      "bg-sky-50 text-sky-700 ring-sky-200/70 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-800/50",
  },
  "gluten-free": {
    icon: Wheat,
    className:
      "bg-lime-50 text-lime-700 ring-lime-200/70 dark:bg-lime-950/40 dark:text-lime-300 dark:ring-lime-800/50",
    label: "Gluten-free",
  },
  "dairy-free": {
    icon: Milk,
    className:
      "bg-cyan-50 text-cyan-700 ring-cyan-200/70 dark:bg-cyan-950/40 dark:text-cyan-300 dark:ring-cyan-800/50",
    label: "Dairy-free",
  },
  spicy: {
    icon: Flame,
    className:
      "bg-red-50 text-red-700 ring-red-200/70 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-800/50",
  },
  "chef-special": {
    icon: Star,
    className:
      "bg-brand-100 text-brand-700 ring-brand-300/70 dark:bg-brand-950/50 dark:text-brand-300 dark:ring-brand-700/60",
    label: "Chef's Special",
  },
};

export function DietaryBadge({ tag }: { tag: string }) {
  const style = TAG_STYLE[tag];
  const Icon = style?.icon ?? Leaf;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
        style?.className ??
          "bg-neutral-100 text-neutral-700 ring-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:ring-neutral-700",
      )}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      {style?.label ?? labelize(tag)}
    </span>
  );
}

export { labelize };
