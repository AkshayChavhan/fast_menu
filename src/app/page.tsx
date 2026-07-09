import Link from "next/link";
import {
  ArrowRight,
  Ban,
  Check,
  Languages,
  Pencil,
  Printer,
  ShieldCheck,
  Sparkles,
  Star,
  TrendingUp,
} from "lucide-react";
import { Wordmark } from "@/components/Wordmark";
import { cn } from "@/lib/utils";

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-white text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100">
      <TopNav />
      <main>
        <Hero />
        <SegmentStrip />
        <Features />
        <HowItWorks />
        <Pricing />
        <CtaBanner />
      </main>
      <Footer />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Top navigation                                                             */
/* -------------------------------------------------------------------------- */

function TopNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-neutral-200/70 bg-white/80 backdrop-blur-xl dark:border-white/10 dark:bg-neutral-950/70">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" aria-label="fast_menu home">
          <Wordmark />
        </Link>

        <div className="hidden items-center gap-8 text-sm font-medium text-neutral-600 md:flex dark:text-neutral-300">
          <a href="#features" className="transition-colors hover:text-neutral-900 dark:hover:text-white">
            Features
          </a>
          <a href="#how" className="transition-colors hover:text-neutral-900 dark:hover:text-white">
            How it works
          </a>
          <a href="#pricing" className="transition-colors hover:text-neutral-900 dark:hover:text-white">
            Pricing
          </a>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/login"
            className="hidden rounded-lg px-3.5 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 sm:inline-flex dark:text-neutral-200 dark:hover:bg-white/10"
          >
            Login
          </Link>
          <Link
            href="/signup"
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-brand-600/30 transition-all hover:bg-brand-600 hover:shadow-md active:scale-[0.98]"
          >
            Get started
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </nav>
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/* Hero                                                                       */
/* -------------------------------------------------------------------------- */

function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Ambient background glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
      >
        <div className="absolute -top-40 left-1/2 h-[36rem] w-[36rem] -translate-x-1/2 rounded-full bg-brand-400/20 blur-3xl dark:bg-brand-500/10" />
        <div className="absolute right-0 top-1/3 h-96 w-96 rounded-full bg-amber-300/20 blur-3xl dark:bg-amber-500/5" />
      </div>

      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-16 sm:px-6 lg:grid-cols-2 lg:gap-8 lg:pb-28 lg:pt-24">
        {/* Copy */}
        <div className="max-w-xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand-700 dark:border-brand-500/20 dark:bg-brand-500/10 dark:text-brand-300">
            <Sparkles className="h-3.5 w-3.5" />
            Hospitality QR Menus
          </span>

          <h1 className="mt-5 text-4xl font-extrabold leading-[1.05] tracking-tight text-neutral-900 sm:text-5xl lg:text-6xl dark:text-white">
            QR digital menus that{" "}
            <span className="bg-gradient-to-r from-brand-500 to-amber-500 bg-clip-text text-transparent">
              sell more
            </span>{" "}
            & never need a reprint.
          </h1>

          <p className="mt-6 text-lg leading-relaxed text-neutral-600 dark:text-neutral-300">
            Mobile-first menus with photos, allergens and dietary tags. Change a
            price or 86 a dish from your phone — instantly. Built-in pairings and
            add-ons lift spend 10–30%.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-6 py-3.5 text-base font-semibold text-white shadow-lg shadow-brand-600/30 transition-all hover:bg-brand-600 hover:shadow-xl active:scale-[0.98]"
            >
              Get started free
              <ArrowRight className="h-5 w-5" />
            </Link>
            <Link
              href="/m/demo"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-neutral-300 bg-white px-6 py-3.5 text-base font-semibold text-neutral-800 transition-all hover:border-neutral-400 hover:bg-neutral-50 active:scale-[0.98] dark:border-white/15 dark:bg-white/5 dark:text-neutral-100 dark:hover:bg-white/10"
            >
              See a live demo
            </Link>
          </div>

          <dl className="mt-10 grid max-w-md grid-cols-3 gap-6">
            <Stat value="10–30%" label="Higher spend" />
            <Stat value="0" label="Reprints" />
            <Stat value="9+" label="Languages" />
          </dl>
        </div>

        {/* Phone mock */}
        <div className="relative flex justify-center lg:justify-end">
          <PhoneMock />
        </div>
      </div>
    </section>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <dt className="text-2xl font-extrabold tracking-tight text-neutral-900 dark:text-white">
        {value}
      </dt>
      <dd className="mt-0.5 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {label}
      </dd>
    </div>
  );
}

/* A tasteful mock phone showing a menu — pure Tailwind, no images. */
function PhoneMock() {
  return (
    <div className="relative">
      {/* Floating "price updated" chip */}
      <div className="absolute -left-6 top-20 z-20 hidden rotate-[-4deg] items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 shadow-xl sm:flex dark:border-white/10 dark:bg-neutral-800 dark:text-neutral-100">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300">
          <Check className="h-3.5 w-3.5" />
        </span>
        Price updated live
      </div>

      {/* Floating "86'd" chip */}
      <div className="absolute -right-4 bottom-24 z-20 hidden rotate-[5deg] items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 shadow-xl sm:flex dark:border-white/10 dark:bg-neutral-800 dark:text-neutral-100">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-300">
          <Ban className="h-3.5 w-3.5" />
        </span>
        Sea Bass 86&rsquo;d
      </div>

      {/* Phone frame */}
      <div className="relative w-[290px] rounded-[2.75rem] border-[10px] border-neutral-900 bg-neutral-900 shadow-2xl dark:border-neutral-800 sm:w-[320px]">
        {/* Notch */}
        <div className="absolute left-1/2 top-0 z-10 h-6 w-32 -translate-x-1/2 rounded-b-2xl bg-neutral-900 dark:bg-neutral-800" />
        {/* Screen */}
        <div className="overflow-hidden rounded-[2rem] bg-white dark:bg-neutral-950">
          {/* Menu header */}
          <div className="relative h-28 bg-gradient-to-br from-brand-500 to-amber-500 px-5 pb-4 pt-8">
            <div className="text-xs font-medium uppercase tracking-widest text-white/80">
              The Copper Fork
            </div>
            <div className="mt-1 text-lg font-bold text-white">Dinner Menu</div>
            <div className="absolute right-4 top-8 flex gap-1">
              {["EN", "ES", "FR"].map((l, i) => (
                <span
                  key={l}
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
                    i === 0
                      ? "bg-white text-brand-600"
                      : "bg-white/20 text-white",
                  )}
                >
                  {l}
                </span>
              ))}
            </div>
          </div>

          {/* Menu items */}
          <div className="space-y-3 p-4">
            <MenuRow
              name="Truffle Arancini"
              desc="Crispy risotto, parmesan"
              price="$12"
              tags={["veg"]}
              featured
            />
            <MenuRow
              name="Pan-Seared Sea Bass"
              desc="Sold out for tonight"
              price="$28"
              soldOut
            />
            <MenuRow
              name="Wagyu Sliders"
              desc="Brioche, aged cheddar"
              price="$19"
              tags={["gf"]}
            />

            {/* Upsell / pairing card */}
            <div className="rounded-2xl border border-brand-200 bg-brand-50 p-3 dark:border-brand-500/20 dark:bg-brand-500/10">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-700 dark:text-brand-300">
                <Sparkles className="h-3.5 w-3.5" />
                Pairs perfectly with
              </div>
              <div className="mt-2 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-neutral-900 dark:text-white">
                    Malbec, glass
                  </div>
                  <div className="text-xs text-neutral-500 dark:text-neutral-400">
                    Add to the table
                  </div>
                </div>
                <span className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-bold text-white">
                  +$9
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MenuRow({
  name,
  desc,
  price,
  tags = [],
  featured = false,
  soldOut = false,
}: {
  name: string;
  desc: string;
  price: string;
  tags?: string[];
  featured?: boolean;
  soldOut?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3",
        soldOut && "opacity-50",
      )}
    >
      {/* Thumbnail */}
      <div
        className={cn(
          "h-12 w-12 shrink-0 rounded-xl bg-gradient-to-br",
          featured
            ? "from-brand-300 to-brand-500"
            : "from-neutral-200 to-neutral-300 dark:from-neutral-700 dark:to-neutral-800",
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "truncate text-sm font-semibold text-neutral-900 dark:text-white",
              soldOut && "line-through",
            )}
          >
            {name}
          </span>
          {featured && (
            <Star className="h-3 w-3 shrink-0 fill-brand-400 text-brand-400" />
          )}
        </div>
        <div className="truncate text-xs text-neutral-500 dark:text-neutral-400">
          {desc}
        </div>
        {tags.length > 0 && (
          <div className="mt-1 flex gap-1">
            {tags.map((t) => (
              <span
                key={t}
                className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
      <div
        className={cn(
          "shrink-0 text-sm font-bold text-neutral-900 dark:text-white",
          soldOut && "line-through",
        )}
      >
        {price}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Segment strip                                                              */
/* -------------------------------------------------------------------------- */

function SegmentStrip() {
  const segments = ["Hotels", "Restaurants", "Cafés", "Bars"];
  return (
    <section className="border-y border-neutral-200 bg-neutral-50 dark:border-white/10 dark:bg-neutral-900/40">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-neutral-400 dark:text-neutral-500">
          Built for hospitality
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 sm:gap-x-14">
          {segments.map((s) => (
            <span
              key={s}
              className="text-xl font-bold tracking-tight text-neutral-700 sm:text-2xl dark:text-neutral-200"
            >
              {s}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Features                                                                    */
/* -------------------------------------------------------------------------- */

const FEATURES = [
  {
    icon: Pencil,
    title: "Instant edits, no reprints",
    body: "Change a price, swap a photo or add a special from your phone. Every scan shows today's menu — never a stale laminate.",
  },
  {
    icon: Ban,
    title: "86 a dish in one tap",
    body: "Out of the sea bass? Mark it 86'd and it greys out live for every diner. No awkward apologies at the table.",
  },
  {
    icon: ShieldCheck,
    title: "Allergens & dietary tags",
    body: "Flag gluten, nuts, dairy and more. Vegan, halal and gluten-free badges help guests order with confidence.",
  },
  {
    icon: TrendingUp,
    title: "Upsell pairings (+10–30%)",
    body: "Suggest the perfect wine, side or dessert on every dish. Engineered add-ons quietly lift average check size.",
  },
  {
    icon: Languages,
    title: "Multi-language for hotels",
    body: "Offer the same menu in 19+ languages, including major Indian regional languages. International guests read comfortably in their own language, instantly.",
  },
  {
    icon: Printer,
    title: "Print assets included",
    body: "Table tents, stickers and window decals with your QR — generated ready to print, so you're live the same day.",
  },
];

function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
      <SectionHeading
        eyebrow="Everything on one menu"
        title="Run a smarter menu from your pocket"
        subtitle="fast_menu replaces printed menus with a living, revenue-aware experience your guests actually enjoy."
      />

      <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <div
            key={f.title}
            className="group relative rounded-2xl border border-neutral-200 bg-white p-6 transition-all hover:-translate-y-1 hover:border-brand-200 hover:shadow-lg hover:shadow-brand-500/5 dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-brand-500/30"
          >
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-100 transition-colors group-hover:bg-brand-500 group-hover:text-white dark:bg-brand-500/10 dark:text-brand-300 dark:ring-brand-500/20">
              <f.icon className="h-5 w-5" />
            </div>
            <h3 className="mt-5 text-lg font-bold tracking-tight text-neutral-900 dark:text-white">
              {f.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
              {f.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* How it works                                                                */
/* -------------------------------------------------------------------------- */

const STEPS = [
  {
    n: "01",
    title: "Build your menu",
    body: "Add categories and dishes with photos, prices, allergens and pairings. Publish in minutes.",
  },
  {
    n: "02",
    title: "Print your QR",
    body: "Download table tents, stickers and window decals with your unique QR code — ready to place.",
  },
  {
    n: "03",
    title: "Diners scan & order more",
    body: "Guests scan, browse in their language, and get nudged toward pairings that grow your check.",
  },
];

function HowItWorks() {
  return (
    <section
      id="how"
      className="border-y border-neutral-200 bg-neutral-50 dark:border-white/10 dark:bg-neutral-900/40"
    >
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
        <SectionHeading
          eyebrow="Live the same day"
          title="Three steps to a smarter menu"
        />

        <div className="mt-14 grid gap-8 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <div key={step.n} className="relative">
              {/* Connector line */}
              {i < STEPS.length - 1 && (
                <div className="absolute left-14 top-6 hidden h-px w-[calc(100%-2rem)] bg-gradient-to-r from-brand-300 to-transparent md:block dark:from-brand-500/40" />
              )}
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500 text-sm font-extrabold text-white shadow-lg shadow-brand-600/30">
                {step.n}
              </div>
              <h3 className="mt-5 text-xl font-bold tracking-tight text-neutral-900 dark:text-white">
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
                {step.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Pricing                                                                      */
/* -------------------------------------------------------------------------- */

const TIERS = [
  {
    name: "Starter",
    price: "$0",
    cadence: "/mo",
    tagline: "For a single café or bar getting online.",
    features: [
      "1 menu, unlimited dishes",
      "Photos, allergens & dietary tags",
      "Instant edits & 86 a dish",
      "QR code + printable table tent",
    ],
    cta: "Start free",
    featured: false,
  },
  {
    name: "Pro",
    price: "$29",
    cadence: "/mo",
    tagline: "For restaurants that want to sell more.",
    features: [
      "Everything in Starter",
      "Upsell pairings & add-ons",
      "Featured dishes & specials",
      "Stickers & window decals",
      "Priority support",
    ],
    cta: "Start 14-day trial",
    featured: true,
  },
  {
    name: "Hotel",
    price: "$99",
    cadence: "/mo",
    tagline: "For hotels & groups with many outlets.",
    features: [
      "Everything in Pro",
      "Up to 10 menus / outlets",
      "Multi-language (19+ locales)",
      "Custom branding & domain",
      "Dedicated onboarding",
    ],
    cta: "Talk to us",
    featured: false,
  },
];

function Pricing() {
  return (
    <section id="pricing" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
      <SectionHeading
        eyebrow="Simple pricing"
        title="Plans that pay for themselves"
        subtitle="One extra pairing per table more than covers your subscription. Cancel anytime."
      />

      <div className="mt-14 grid items-start gap-6 lg:grid-cols-3">
        {TIERS.map((tier) => (
          <div
            key={tier.name}
            className={cn(
              "relative flex flex-col rounded-3xl border p-7 transition-all",
              tier.featured
                ? "border-brand-500 bg-white shadow-2xl shadow-brand-500/10 lg:-my-2 lg:scale-[1.02] dark:border-brand-500 dark:bg-neutral-900"
                : "border-neutral-200 bg-white hover:border-neutral-300 dark:border-white/10 dark:bg-white/[0.03]",
            )}
          >
            {tier.featured && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand-500 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white shadow-md">
                Most popular
              </span>
            )}

            <h3 className="text-lg font-bold tracking-tight text-neutral-900 dark:text-white">
              {tier.name}
            </h3>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              {tier.tagline}
            </p>

            <div className="mt-5 flex items-baseline gap-1">
              <span className="text-4xl font-extrabold tracking-tight text-neutral-900 dark:text-white">
                {tier.price}
              </span>
              <span className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
                {tier.cadence}
              </span>
            </div>

            <ul className="mt-6 space-y-3">
              {tier.features.map((feat) => (
                <li key={feat} className="flex items-start gap-2.5 text-sm text-neutral-700 dark:text-neutral-300">
                  <Check
                    className={cn(
                      "mt-0.5 h-4 w-4 shrink-0",
                      tier.featured ? "text-brand-500" : "text-emerald-500",
                    )}
                  />
                  {feat}
                </li>
              ))}
            </ul>

            <Link
              href="/signup"
              className={cn(
                "mt-8 inline-flex items-center justify-center gap-1.5 rounded-xl px-5 py-3 text-sm font-semibold transition-all active:scale-[0.98]",
                tier.featured
                  ? "bg-brand-500 text-white shadow-lg shadow-brand-600/30 hover:bg-brand-600"
                  : "border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50 dark:border-white/15 dark:bg-white/5 dark:text-neutral-100 dark:hover:bg-white/10",
              )}
            >
              {tier.cta}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Final CTA                                                                    */
/* -------------------------------------------------------------------------- */

function CtaBanner() {
  return (
    <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-500 to-amber-500 px-6 py-14 text-center shadow-2xl sm:px-12 sm:py-20">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-20 [background-image:radial-gradient(circle_at_1px_1px,white_1px,transparent_0)] [background-size:24px_24px]"
        />
        <h2 className="relative text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
          Ditch the reprints. Lift every check.
        </h2>
        <p className="relative mx-auto mt-4 max-w-xl text-base text-white/90 sm:text-lg">
          Launch your QR menu today — table tents, stickers and decals included.
          No card required to start.
        </p>
        <div className="relative mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link
            href="/signup"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-6 py-3.5 text-base font-semibold text-brand-600 shadow-lg transition-all hover:bg-neutral-50 active:scale-[0.98]"
          >
            Get started free
            <ArrowRight className="h-5 w-5" />
          </Link>
          <Link
            href="/m/demo"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/40 bg-white/10 px-6 py-3.5 text-base font-semibold text-white backdrop-blur transition-all hover:bg-white/20 active:scale-[0.98]"
          >
            See a live demo
          </Link>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Footer                                                                       */
/* -------------------------------------------------------------------------- */

function Footer() {
  return (
    <footer className="border-t border-neutral-200 bg-white dark:border-white/10 dark:bg-neutral-950">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-4 py-10 sm:flex-row sm:px-6">
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-6">
          <Wordmark size="sm" />
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            QR digital menus for hotels, restaurants, cafés &amp; bars.
          </p>
        </div>
        <div className="flex items-center gap-6 text-sm font-medium text-neutral-500 dark:text-neutral-400">
          <a href="#features" className="transition-colors hover:text-neutral-900 dark:hover:text-white">
            Features
          </a>
          <a href="#pricing" className="transition-colors hover:text-neutral-900 dark:hover:text-white">
            Pricing
          </a>
          <Link href="/login" className="transition-colors hover:text-neutral-900 dark:hover:text-white">
            Login
          </Link>
        </div>
      </div>
      <div className="border-t border-neutral-100 py-6 dark:border-white/5">
        <p className="text-center text-xs text-neutral-400 dark:text-neutral-500">
          © {new Date().getFullYear()} fast_menu. All rights reserved.
        </p>
      </div>
    </footer>
  );
}

/* -------------------------------------------------------------------------- */
/* Shared bits                                                                  */
/* -------------------------------------------------------------------------- */

function SectionHeading({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-600 dark:text-brand-400">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-neutral-900 sm:text-4xl dark:text-white">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-4 text-lg leading-relaxed text-neutral-600 dark:text-neutral-400">
          {subtitle}
        </p>
      )}
    </div>
  );
}
