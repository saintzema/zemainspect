import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // Prefer SF Pro on Apple hardware and Inter where it is installed,
        // then fall back to the platform UI face. Kept as a system stack so
        // builds stay hermetic and pages render instantly with no font fetch —
        // which also matters on a factory tablet behind a slow link.
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Text",
          "Inter",
          "Segoe UI",
          "Roboto",
          "Noto Sans SC",
          "PingFang SC",
          "Microsoft YaHei",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
      },
      colors: {
        // Accent flips to deep purple inside /admin so the founder can never
        // mistake the admin console for a customer dashboard.
        accent: "rgb(var(--accent) / <alpha-value>)",
        "accent-soft": "rgb(var(--accent-soft) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        "ink-muted": "rgb(var(--ink-muted) / <alpha-value>)",
        pass: "rgb(var(--pass) / <alpha-value>)",
        fail: "rgb(var(--fail) / <alpha-value>)",
        warn: "rgb(var(--warn) / <alpha-value>)",
        glass: {
          light: "rgba(255, 255, 255, 0.62)",
          "light-strong": "rgba(255, 255, 255, 0.78)",
          dark: "rgba(18, 20, 28, 0.55)",
          "dark-strong": "rgba(18, 20, 28, 0.72)",
        },
      },
      borderRadius: {
        glass: "20px",
        "glass-lg": "24px",
      },
      backdropBlur: {
        glass: "20px",
        "glass-lg": "32px",
      },
      boxShadow: {
        glass:
          "0 4px 24px -2px rgba(15, 23, 42, 0.12), 0 1px 2px rgba(15, 23, 42, 0.06)",
        "glass-lg":
          "0 18px 48px -8px rgba(15, 23, 42, 0.24), 0 2px 6px rgba(15, 23, 42, 0.08)",
        "glass-inset": "inset 0 1px 0 0 rgba(255, 255, 255, 0.28)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "fade-up": "fade-up 320ms cubic-bezier(0.22, 1, 0.36, 1) both",
        shimmer: "shimmer 1.4s infinite",
      },
    },
  },
  plugins: [],
};

export default config;
