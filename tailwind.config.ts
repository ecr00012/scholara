import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cream: '#FAFAF7',
        ink: {
          DEFAULT: '#1F1B16',
          muted: 'rgba(31, 27, 22, 0.7)',
        },
        accent: {
          amber: '#C9892F',
          gold: '#D4A24C',
          orange: '#C8702C',
        },
      },
      fontFamily: {
        serif: ['"Iowan Old Style"', '"Palatino Linotype"', 'Georgia', 'serif'],
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
      },
      keyframes: {
        'banner-in': {
          '0%': { opacity: '0', transform: 'translateY(-4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'banner-in': 'banner-in 200ms ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
