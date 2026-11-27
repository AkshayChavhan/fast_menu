import type { Config } from "tailwindcss";

const config: Config = {
  // Dark when the device is dark, unless the guest chose light on the menu;
  // or when they chose dark. The choice is a class on <html> that
  // app/layout.tsx applies before the first paint (lib/theme.ts). With no
  // choice made this behaves exactly like the old 'media' setting.
  darkMode: [
    "variant",
    // Ancestor selectors, written before the element: a condition written
    // after it would land behind pseudo-elements (dark:file:…) and break.
    ["@media (prefers-color-scheme: dark) { :root:not(.light) & }", ".dark &"],
  ],
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#fff7ed",
          100: "#ffedd5",
          200: "#fed7aa",
          300: "#fdba74",
          400: "#fb923c",
          500: "#f97316",
          600: "#ea580c",
          700: "#c2410c",
          800: "#9a3412",
          900: "#7c2d12",
          950: "#431407",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
