/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      // World Mod radii: panel 30 / card 22 / inner 16 / pill. See /DESIGN.md.
      borderRadius: { md: "16px", lg: "22px", xl: "22px", "2xl": "30px", "3xl": "30px" },
      fontFamily: { sans: ["var(--font-manrope)", "ui-sans-serif", "system-ui", "sans-serif"], mono: ["Geist Mono", "ui-monospace", "monospace"] },
    },
  },
  plugins: [],
};
