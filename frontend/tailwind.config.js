/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  // Class-based so the ThemeProvider can override the system preference.
  darkMode: 'class',
  theme: {
    extend: {
      keyframes: {
        floatIn: {
          from: { opacity: '0', transform: 'translateY(14px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        floatIn: 'floatIn 0.45s ease-out both',
      },
    },
  },
  plugins: [],
};
