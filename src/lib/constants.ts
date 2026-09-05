// Controlled vocabularies shared by the dashboard editor and public menu.

export const ALLERGENS = [
  "gluten",
  "dairy",
  "eggs",
  "fish",
  "shellfish",
  "tree-nuts",
  "peanuts",
  "soy",
  "sesame",
  "celery",
  "mustard",
  "sulphites",
] as const;
export type Allergen = (typeof ALLERGENS)[number];

export const DIETARY_TAGS = [
  "vegan",
  "vegetarian",
  "halal",
  "kosher",
  "gluten-free",
  "dairy-free",
  "spicy",
  "chef-special",
] as const;
export type DietaryTag = (typeof DIETARY_TAGS)[number];

// Locales offered for multi-language menus (hotels).
export const SUPPORTED_LOCALES = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "it", label: "Italiano" },
  { code: "pt", label: "Português" },
  { code: "ar", label: "العربية" },
  { code: "zh", label: "中文" },
  { code: "ja", label: "日本語" },
  // Indian regional languages
  { code: "hi", label: "हिन्दी" },
  { code: "bn", label: "বাংলা" },
  { code: "ta", label: "தமிழ்" },
  { code: "te", label: "తెలుగు" },
  { code: "mr", label: "मराठी" },
  { code: "gu", label: "ગુજરાતી" },
  { code: "kn", label: "ಕನ್ನಡ" },
  { code: "ml", label: "മലയാളം" },
  { code: "pa", label: "ਪੰਜਾਬੀ" },
  { code: "ur", label: "اردو" },
] as const;

export const CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "INR",
  "AED",
  "CAD",
  "AUD",
  "JPY",
] as const;

// Starting point for a restaurant's review form, used until the owner saves
// their own set. The ids are stable slugs (not uuids) so that a restaurant
// which never customises its form still produces reviews that all reference
// the same questions. Questions added in the dashboard get a uuid instead.
export const DEFAULT_REVIEW_QUESTIONS = [
  { id: "food", prompt: "How was the food?" },
  { id: "service", prompt: "How was the service?" },
  { id: "ambience", prompt: "How was the ambience?" },
  { id: "value", prompt: "How was the value for money?" },
] as const;

export const REVIEW_MAX_STARS = 5;

// Guardrails for the form builder and the public submit action.
export const REVIEW_MAX_QUESTIONS = 10;
export const REVIEW_MAX_COMMENT_LENGTH = 600;
export const REVIEW_MAX_NAME_LENGTH = 60;
