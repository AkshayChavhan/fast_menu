"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ALLERGENS, DIETARY_TAGS } from "@/lib/constants";

const ALLERGEN_VALUES = ALLERGENS as readonly string[];
const DIETARY_VALUES = DIETARY_TAGS as readonly string[];

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Ownership guard. RLS enforces tenancy at the DB level; we also verify here so
// that the app returns friendly errors and never issues a write it can't do.
// ---------------------------------------------------------------------------
async function auth() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

async function assertOwnsRestaurant(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  restaurantId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("restaurants")
    .select("id")
    .eq("id", restaurantId)
    .eq("owner_id", userId)
    .maybeSingle();
  return !!data;
}

// The embedded relation can come back typed as an object or an array depending
// on inference; normalize to the single owner_id either way.
function relationOwnerId(rel: unknown): string | null {
  if (!rel) return null;
  const one = Array.isArray(rel) ? rel[0] : rel;
  const owner = (one as { owner_id?: string } | undefined)?.owner_id;
  return owner ?? null;
}

// Verify ownership by walking from a category id up to its restaurant.
async function assertOwnsCategory(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  categoryId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("categories")
    .select("restaurant_id, restaurants!inner(owner_id)")
    .eq("id", categoryId)
    .maybeSingle();
  if (!data) return null;
  const owner = relationOwnerId((data as { restaurants: unknown }).restaurants);
  return owner === userId ? (data.restaurant_id as string) : null;
}

async function assertOwnsDish(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  dishId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("dishes")
    .select("restaurant_id, restaurants!inner(owner_id)")
    .eq("id", dishId)
    .maybeSingle();
  if (!data) return null;
  const owner = relationOwnerId((data as { restaurants: unknown }).restaurants);
  return owner === userId ? (data.restaurant_id as string) : null;
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
  if (!(await assertOwnsRestaurant(supabase, user.id, restaurantId)))
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
  if (!(await assertOwnsCategory(supabase, user.id, categoryId)))
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
  if (!(await assertOwnsCategory(supabase, user.id, categoryId)))
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
  if (!(await assertOwnsRestaurant(supabase, user.id, restaurantId)))
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
}): Promise<ActionResult> {
  const parsed = createDishSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const d = parsed.data;

  const { supabase, user } = await auth();
  if (!user) return { ok: false, error: "Not authenticated" };
  if (!(await assertOwnsRestaurant(supabase, user.id, d.restaurantId)))
    return { ok: false, error: "Restaurant not found" };

  // If a category was chosen, ensure it belongs to this restaurant.
  if (d.categoryId) {
    const owned = await assertOwnsCategory(supabase, user.id, d.categoryId);
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

  const { error } = await supabase.from("dishes").insert({
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
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/menu");
  revalidatePath("/dashboard");
  return { ok: true };
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
  const restaurantId = await assertOwnsDish(supabase, user.id, d.dishId);
  if (!restaurantId) return { ok: false, error: "Dish not found" };

  if (d.categoryId) {
    const owned = await assertOwnsCategory(supabase, user.id, d.categoryId);
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
  if (!(await assertOwnsDish(supabase, user.id, dishId)))
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
  if (!(await assertOwnsDish(supabase, user.id, dishId)))
    return { ok: false, error: "Dish not found" };

  const { error } = await supabase.from("dishes").delete().eq("id", dishId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/menu");
  revalidatePath("/dashboard");
  return { ok: true };
}
