const c = (n) => `rgb(var(--${n}) / <alpha-value>)`;
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: c('bg'), card: c('card'), ink: c('ink'), muted: c('muted'), line: c('line'), soft: c('soft'),
        brand: c('brand'), 'brand-ink': c('brand-ink'), 'brand-soft': c('brand-soft'), sun: c('sun'), mark: c('mark'),
        danger: c('danger'), warn: c('warn'), ok: c('ok'),
        'danger-bg': c('danger-bg'), 'warn-bg': c('warn-bg'), 'ok-bg': c('ok-bg'),
      },
      fontFamily: { sans: ['Poppins', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
};
