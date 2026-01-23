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
        "primary": "#d4af35",
        "bougainvillea": "#E11D74",
        "forest": "#1A4338",
        "gold": "#D4AF37",
        "background-light": "#FDFCFB",
        "background-dark": "#0F1211",
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
