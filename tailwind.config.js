/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  // The affiliate summary cards build color classes dynamically (bg-${color}-500/10
  // etc.), so any color not present as a literal elsewhere gets purged. 'sky' (used
  // by the "Total songs" / Songs column) needs these pinned.
  safelist: ["bg-sky-500/10", "border-sky-500/20", "text-sky-400"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // ── Cenzo brand palette ───────────────────────────────────────────
        // Source of truth: public/brand/cenzo/BRAND-BIBLE.html. Each hue has a
        // print/light value and a lifted dark-surface value; the customer site
        // runs on the warm dark surface, so the DEFAULT stop is the dark-mode
        // variant and `-deep` is the print value.
        terra: { DEFAULT: "#E4795A", deep: "#B44F35", soft: "#F2A98F" },
        marigold: { DEFAULT: "#E8B44A", deep: "#C98A1B", soft: "#F4D08A" },
        magenta: { DEFAULT: "#E7699F", deep: "#B62463", soft: "#F2A0C2" },
        turquesa: { DEFAULT: "#43C2BA", deep: "#1F8C86", soft: "#89DAD4" },
        anil: { DEFAULT: "#8E90E8", deep: "#3B3D8F", soft: "#BCBDF2" },
        // Neutrals — indigo night, cream ink. Never pure black or gray.
        crema: "#FBF6EC",
        tinta: "#2A1D18",
        // Noche de Anil: the customer surface is an indigo night sky that settles
        // into warm brown at the horizon. `paper` is the base, `card` one step up.
        paper: "#191A45",
        card: "#262756",
        horizon: "#241B3A",
        ink: { DEFAULT: "#F0E6D8", 2: "#BFC0DE", 3: "#8A8BB0" },

        // ── Legacy token names, repointed at Cenzo ────────────────────────
        // ~450 class usages across the funnel reference these. Repointing them
        // here re-skins every screen at once; do not re-add the old pink hexes.
        "primary": "#E4795A",          // was #f20d80 — main CTA
        "bougainvillea": "#E7699F",    // was #f20d80 — accent (the flower is magenta)
        "forest": "#232459",           // panel one step above the night sky
        "gold": "#E8B44A",             // was #f20d80 — highlights, progress, dots
        "background-light": "#FBF6EC",
        "background-dark": "#1B1C48",
        "landing-bg": "#1B1C48",
        "landing-primary": "#E4795A",
      },
      fontFamily: {
        "display": ["Playfair Display", "serif"],
        "body": ["Be Vietnam Pro", "sans-serif"]
      },
      borderRadius: {
        "DEFAULT": "0.5rem",
        "lg": "1rem",
        "xl": "1.5rem",
        "2xl": "2rem",
        "full": "9999px"
      },
      animation: {
        'bounce-slow': 'bounce 2s ease-in-out infinite',
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'slide-in': 'slideIn 0.3s ease-out',
      },
      keyframes: {
        slideIn: {
          '0%': { transform: 'translateX(120%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
      }
    },
  },
  plugins: [],
}
