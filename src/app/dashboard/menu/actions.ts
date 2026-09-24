"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ALLERGENS, DIETARY_TAGS } from "@/lib/constants";
import { can } from "@/lib/permissions";
import type { ModifierGroupInput } from "@/lib/modifiers";
import { getMemberRole } from "../lib";

const ALLERGEN_VALUES = ALLERGENS as readonly string[];
const DIETARY_VALUES = DIETARY_TAGS as readonly string[];

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Authorisation. RLS enforces tenancy and roles at the DB level; we also check
// here so the app returns friendly errors and never issues a write it can't
// do. Owners and managers may edit the menu (see lib/permissions.ts).
// ---------------------------------------------------------------------------
type Db = Awaited<ReturnType<typeof createClient>>;

async function auth() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

async function canManageRestaurant(
  supabase: Db,
  restaurantId: string,
): Promise<boolean> {
  const role = await getMemberRole(supabase, restaurantId);
  return can(role, "menu:manage");
}

// Walk from a category id up to its restaurant and check the role there.
// Returns the restaurant id when the caller may edit it, else null.
async function managedCategoryRestaurant(
  supabase: Db,
  categoryId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("categories")
    .select("restaurant_id")
    .eq("id", categoryId)
    .maybeSingle<{ restaurant_id: string }>();
  if (!data) return null;
  return (await canManageRestaurant(supabase, data.restaurant_id))
    ? data.restaurant_id
    : null;
}

async function managedDishRestaurant(
  supabase: Db,
  dishId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("dishes")
    .select("restaurant_id")
    .eq("id", dishId)
    .maybeSingle<{ restaurant_id: string }>();
  if (!data) return null;
  return (await canManageRestaurant(supabase, data.restaurant_id))
    ? data.restaurant_id
    : null;
}

function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? "Invalid input";
}

// ===========================================================================
// Categories
// ===========================================================================

const createCategorySchema = z.object({
  restaurantId: z.string().uuid(),
  name: z.string().trim().min(1, "Category name is required").max(80),
});

export async function createCategory(input: {
  restaurantId: string;
  name: string;
}): Promise<ActionResult> {
  const parsed = createCategorySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { restaurantId, name } = parsed.data;

  const { supabase, user } = await auth();
  if (!user) return { ok: false, error: "Not authenticated" };
  if (!(await canManageRestaurant(supabase, restaurantId)))
    return { ok: false, error: "Restaurant not found" };

  // Append to the end: sort_order = current max + 1.
  const { data: last } = await supabase
    .from("categories")
    .select("sort_order")
    .eq("restaurant_id", restaurantId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (last?.sort_order ?? -1) + 1;

  const { error } = await supabase.from("categories").insert({
    restaurant_id: restaurantId,
    name,
    sort_order: nextOrder,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/menu");
  revalidatePath("/dashboard");
  return { ok: true };
}

const updateCategorySchema = z.object({
  categoryId: z.string().uuid(),
  name: z.string().trim().min(1, "Category name is required").max(80),
  description: z
    .string()
    .trim()
    .max(500)
    .transform((s) => (s.length ? s : null))
    .nullable()
    .optional(),
});

export async function updateCategory(input: {
  categoryId: string;
  name: string;
  description?: string | null;
}): Promise<ActionResult> {
  const parsed = updateCategorySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { categoryId, name, description } = parsed.data;

  const { supabase, user } = await auth();
  if (!user) return { ok: false, error: "Not authenticated" };
  if (!(await managedCategoryRestaurant(supabase, categoryId)))
    return { ok: false, error: "Category not found" };

  const patch: Record<string, unknown> = { name };
  if (description !== undefined) patch.description = description;

  const { error } = await supabase
    .from("categories")
    .update(patch)
    .eq("id", categoryId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/menu");
  return { ok: true };
}

const deleteCategorySchema = z.object({ categoryId: z.string().uuid() });

export async function deleteCategory(input: {
  categoryId: string;
}): Promise<ActionResult> {
  const parsed = deleteCategorySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { categoryId } = parsed.data;

  const { supabase, user } = await auth();
  if (!user) return { ok: false, error: "Not authenticated" };
  if (!(await managedCategoryRestaurant(supabase, categoryId)))
    return { ok: false, error: "Category not found" };

  // Dishes reference categories with ON DELETE SET NULL, so deleting a category
  // simply un-files its dishes rather than removing them.
  const { error } = await supabase
    .from("categories")
    .delete()
    .eq("id", categoryId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/menu");
  revalidatePath("/dashboard");
  return { ok: true };
}

const reorderSchema = z.object({
  restaurantId: z.string().uuid(),
  orderedIds: z.array(z.string().uuid()).min(1),
});

export async function reorderCategories(input: {
  restaurantId: string;
  orderedIds: string[];
}): Promise<ActionResult> {
  const parsed = reorderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { restaurantId, orderedIds } = parsed.data;

  const { supabase, user } = await auth();
  if (!user) return { ok: false, error: "Not authenticated" };
  if (!(await canManageRestaurant(supabase, restaurantId)))
    return { ok: false, error: "Restaurant not found" };

  // Persist each new position. Scoped by restaurant_id so RLS + the filter both
  // prevent touching another tenant's rows.
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      supabase
        .from("categories")
        .update({ sort_order: index })
        .eq("id", id)
        .eq("restaurant_id", restaurantId),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return { ok: false, error: failed.error.message };

  revalidatePath("/dashboard/menu");
  return { ok: true };
}

// ===========================================================================
// Dishes
// ===========================================================================

// Dollars string -> integer cents. Accepts "12", "12.5", "$12.50", "12,50".
function dollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[^0-9.,]/g, "").replace(/,/g, ".");
  if (cleaned === "") return 0;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

const priceField = z
  .string()
  .transform((s) => dollarsToCents(s))
  .refine((v): v is number => v !== null, "Enter a valid price")
  .refine((v) => v <= 100_000_00, "Price is too large");

const dishBase = {
  name: z.string().trim().min(1, "Dish name is required").max(120),
  description: z
    .string()
    .trim()
    .max(1000)
    .transform((s) => (s.length ? s : null))
    .nullable(),
  price: priceField,
  categoryId: z
    .string()
    .uuid()
    .nullable()
    .or(z.literal("").transform(() => null)),
  allergens: z.array(z.enum(ALLERGEN_VALUES as [string, ...string[]])),
  dietaryTags: z.array(z.enum(DIETARY_VALUES as [string, ...string[]])),
  isFeatured: z.boolean(),
  imageUrl: z
    .string()
    .url()
    .nullable()
    .or(z.literal("").transform(() => null)),
};

const createDishSchema = z.object({
  restaurantId: z.string().uuid(),
  ...dishBase,
});

export async function createDish(input: {
  restaurantId: string;
  name: string;
  description?: string | null;
  price: string;
  categoryId: string | null;
  allergens: string[];
  dietaryTags: string[];
  isFeatured: boolean;
  imageUrl: string | null;
}): Promise<ActionResult<{ id: string }>> {
  const parsed = createDishSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const d = parsed.data;

  const { supabase, user } = await auth();
  if (!user) return { ok: false, error: "Not authenticated" };
  if (!(await canManageRestaurant(supabase, d.restaurantId)))
    return { ok: false, error: "Restaurant not found" };

  // If a category was chosen, ensure it belongs to this restaurant.
  if (d.categoryId) {
    const owned = await managedCategoryRestaurant(supabase, d.categoryId);
    if (owned !== d.restaurantId)
      return { ok: false, error: "Invalid category" };
  }

  const { data: last } = await supabase
    .from("dishes")
    .select("sort_order")
    .eq("restaurant_id", d.restaurantId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (last?.sort_order ?? -1) + 1;

  // The id comes back so the form can attach variants and add-ons next.
  const { data: created, error } = await supabase
    .from("dishes")
    .insert({
      restaurant_id: d.restaurantId,
      category_id: d.categoryId,
      name: d.name,
      description: d.description,
      price_cents: d.price,
      allergens: d.allergens,
      dietary_tags: d.dietaryTags,
      is_featured: d.isFeatured,
      image_url: d.imageUrl,
      sort_order: nextOrder,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !created) return { ok: false, error: error?.message ?? "Could not create the dish" };

  revalidatePath("/dashboard/menu");
  revalidatePath("/dashboard");
  return { ok: true, data: { id: created.id } };
}

const updateDishSchema = z.object({
  dishId: z.string().uuid(),
  ...dishBase,
});

export async function updateDish(input: {
  dishId: string;
  name: string;
  description?: string | null;
  price: string;
  categoryId: string | null;
  allergens: string[];
  dietaryTags: string[];
  isFeatured: boolean;
  imageUrl: string | null;
}): Promise<ActionResult> {
  const parsed = updateDishSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const d = parsed.data;

  const { supabase, user } = await auth();
  if (!user) return { ok: false, error: "Not authenticated" };
  const restaurantId = await managedDishRestaurant(supabase, d.dishId);
  if (!restaurantId) return { ok: false, error: "Dish not found" };

  if (d.categoryId) {
    const owned = await managedCategoryRestaurant(supabase, d.categoryId);
    if (owned !== restaurantId)
      return { ok: false, error: "Invalid category" };
  }

  const { error } = await supabase
    .from("dishes")
    .update({
      category_id: d.categoryId,
      name: d.name,
      description: d.description,
      price_cents: d.price,
      allergens: d.allergens,
      dietary_tags: d.dietaryTags,
      is_featured: d.isFeatured,
      image_url: d.imageUrl,
    })
    .eq("id", d.dishId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/menu");
  revalidatePath("/dashboard");
  return { ok: true };
}

const toggleSchema = z.object({
  dishId: z.string().uuid(),
  isAvailable: z.boolean(),
});

export async function toggleDishAvailability(input: {
  dishId: string;
  isAvailable: boolean;
}): Promise<ActionResult> {
  const parsed = toggleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { dishId, isAvailable } = parsed.data;

  const { supabase, user } = await auth();
  if (!user) return { ok: false, error: "Not authenticated" };
  if (!(await managedDishRestaurant(supabase, dishId)))
    return { ok: false, error: "Dish not found" };

  const { error } = await supabase
    .from("dishes")
    .update({ is_available: isAvailable })
    .eq("id", dishId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/menu");
  revalidatePath("/dashboard");
  return { ok: true };
}

const deleteDishSchema = z.object({ dishId: z.string().uuid() });

export async function deleteDish(input: {
  dishId: string;
}): Promise<ActionResult> {
  const parsed = deleteDishSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { dishId } = parsed.data;

  const { supabase, user } = await auth();
  if (!user) return { ok: false, error: "Not authenticated" };
  if (!(await managedDishRestaurant(supabase, dishId)))
    return { ok: false, error: "Dish not found" };

  const { error } = await supabase.from("dishes").delete().eq("id", dishId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/menu");
  revalidatePath("/dashboard");
  return { ok: true };
}

// ===========================================================================
// Variants and add-ons
// ===========================================================================

const MODIFIER_MAX_GROUPS = 10;
const MODIFIER_MAX_OPTIONS = 30;

const modifierOptionSchema = z.object({
  name: z.string().trim().min(1, "Every option needs a name").max(80),
  price: priceField,
  is_available: z.boolean(),
  is_default: z.boolean(),
});

const modifierGroupSchema = z
  .object({
    name: z.string().trim().min(1, "Every group needs a name").max(80),
    kind: z.enum(["variant", "addon"]),
    min_select: z.number().int().min(0).max(20),
    max_select: z.number().int().min(1).max(20).nullable(),
    options: z.array(modifierOptionSchema).max(MODIFIER_MAX_OPTIONS),
  })
  .refine((g) => g.kind !== "variant" || g.options.length > 0, {
    message: "A size / variant group needs at least one option",
  })
  .refine((g) => g.max_select === null || g.max_select >= g.min_select, {
    message: "'At most' can't be smaller than 'at least'",
  });

const setModifiersSchema = z.object({
  dishId: z.string().uuid(),
  groups: z.array(modifierGroupSchema).max(MODIFIER_MAX_GROUPS),
});

// Replace a dish's variants and add-ons as a whole. Runs after the dish
// itself is saved; set_dish_modifiers() does the write in one transaction.
export async function setDishModifiers(input: {
  dishId: string;
  groups: ModifierGroupInput[];
}): Promise<ActionResult> {
  const parsed = setModifiersSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { dishId, groups } = parsed.data;

  const { supabase, user } = await auth();
  if (!user) return { ok: false, error: "Not authenticated" };
  if (!(await managedDishRestaurant(supabase, dishId)))
    return { ok: false, error: "Dish not found" };

  const payload = groups.map((g) => ({
    name: g.name,
    kind: g.kind,
    min_select: g.min_select,
    max_select: g.max_select,
    options: g.options.map((o) => ({
      name: o.name,
      price_cents: o.price,
      is_available: o.is_available,
      is_default: o.is_default,
    })),
  }));

  const { error } = await supabase.rpc("set_dish_modifiers", {
    p_dish_id: dishId,
    payload,
  });
  if (error) {
    // 22023 is the function's own validation.
    if (error.code === "22023") return { ok: false, error: error.message };
    if (error.code === "PGRST202") {
      return {
        ok: false,
        error:
          "The set_dish_modifiers database function is missing. Run the files in supabase/migrations/ first.",
      };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/dashboard/menu");
  return { ok: true };
}
