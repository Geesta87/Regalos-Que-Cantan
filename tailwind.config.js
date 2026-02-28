/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "primary": "#f20d80",
        "bougainvillea": "#f20d80",
        "forest": "#181114",
        "gold": "#f20d80",
        "background-light": "#FDFCFB",
        "background-dark": "#181114",
        "landing-bg": "#181114",
        "landing-primary": "#f20d80",
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
      }
    },
  },
  plugins: [],
}
