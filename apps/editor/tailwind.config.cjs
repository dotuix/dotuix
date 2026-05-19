/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/renderer/**/*.{html,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: ["JetBrains Mono", "Menlo", "monospace"],
      },
      colors: {
        surface: {
          50: "#f5f5f5",
          100: "#eeeeee",
          800: "#1e1e1e",
          850: "#252526",
          900: "#1a1a1a",
          950: "#141414",
        },
        accent: {
          DEFAULT: "#0ea5e9",
          dim: "#0369a1",
        },
      },
    },
  },
  plugins: [],
};
