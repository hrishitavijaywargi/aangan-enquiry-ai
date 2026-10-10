import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { 50: "#fbf6f1", 100: "#f4e8dc", 200: "#e8cfb6", 400: "#c98f5a", 500: "#b5733d", 600: "#9a5d2f", 700: "#7a4826", 900: "#3d2414" },
      },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
};
export default config;
