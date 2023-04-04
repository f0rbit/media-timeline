/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', 'sans-serif'],
      },
      colors: {
        'base-primary': "hsl(235deg 19% 14%)",
        'base-secondary': "hsl(235deg 19% 17%)",
        'base-tertiary': "hsl(235deg 20% 19%)",
        'base-border': "hsl(235deg 18% 20%)",
        "button-accent": "hsl(233deg 76% 65%)",
        "button-accent-hover": "hsl(233deg 76% 68%)",
        "button-accent-border": "hsl(233deg 72% 72%)",
        "button-selected": "#272c46",
        "text-accent": "#6370e4",
      },
    },
  },
  variants: {},
  plugins: [require('@tailwindcss/typography'), require('@tailwindcss/forms')],
};
