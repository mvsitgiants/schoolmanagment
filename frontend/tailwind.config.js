/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // RGB channels (index.css --rgb-*) so opacity modifiers work: bg-bg/60, border-border/70, text-ink/80 …
        bg: 'rgb(var(--rgb-bg) / <alpha-value>)',
        surface: 'rgb(var(--rgb-surface) / <alpha-value>)',
        'surface-raised': 'rgb(var(--rgb-surface-raised) / <alpha-value>)',
        border: 'rgb(var(--rgb-border) / <alpha-value>)',
        ink: {
          DEFAULT: 'rgb(var(--rgb-ink) / <alpha-value>)',
          muted: 'rgb(var(--rgb-ink-muted) / <alpha-value>)',
          faint: 'rgb(var(--rgb-ink-faint) / <alpha-value>)'
        },
        brand: {
          50: 'rgb(var(--brand-50) / <alpha-value>)',
          100: 'rgb(var(--brand-100) / <alpha-value>)',
          200: 'rgb(var(--brand-200) / <alpha-value>)',
          300: 'rgb(var(--brand-300) / <alpha-value>)',
          400: 'rgb(var(--brand-400) / <alpha-value>)',
          500: 'rgb(var(--brand-500) / <alpha-value>)',
          600: 'rgb(var(--brand-600) / <alpha-value>)',
          700: 'rgb(var(--brand-700) / <alpha-value>)',
          800: 'rgb(var(--brand-800) / <alpha-value>)',
          900: 'rgb(var(--brand-900) / <alpha-value>)'
        },
        navy: {
          900: '#0B1220',
          800: '#111A2E',
          700: '#182338'
        },
        // The sidebar surface. Tenant-settable (utils/sidebarTheme.js); `sidebar-fg` is
        // derived from the background's luminance so white text flips to dark on a pale
        // colour. Everything in the sidebar paints with fg-at-an-opacity over bg.
        sidebar: {
          DEFAULT: 'rgb(var(--sidebar-bg) / <alpha-value>)',
          fg: 'rgb(var(--sidebar-fg) / <alpha-value>)'
        },
        amber: {
          50: '#FCF3E3',
          400: '#E2A63A',
          600: '#B9821F'
        },
        success: { 50: '#E8F6EE', 100: '#CDEBDB', 200: '#A6DBBF', 500: '#1F9D66', 600: '#187E52', 700: '#136341' },
        danger: { 50: '#FBEAEA', 100: '#F6D5D5', 200: '#EFB8B8', 300: '#E58F8F', 500: '#D64545', 600: '#B22E2E', 700: '#8F2424' },
        info: { 50: '#EAF0FE', 100: '#D5E0FC', 200: '#B3C6F8', 500: '#3358D6', 600: '#28449E', 700: '#1F3478' }
      },
      fontFamily: {
        // var(--font-script): the active language's Noto family (index.css, i18n/fonts.js)
        display: ['"Sora"', 'var(--font-script, system-ui)', 'system-ui', 'sans-serif'],
        body: ['"Inter"', 'var(--font-script, system-ui)', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace']
      },
      borderRadius: {
        sm: '6px',
        md: '8px',
        lg: '10px',
        xl: '12px',
        '2xl': '14px'
      },
      boxShadow: {
        card: '0 1px 3px 0 rgba(16, 24, 40, 0.05), 0 1px 2px -1px rgba(16, 24, 40, 0.04)',
        'card-hover': '0 10px 25px -4px rgba(16, 24, 40, 0.08), 0 4px 10px -2px rgba(16, 24, 40, 0.04)',
        pop: '0 16px 36px -4px rgba(16, 24, 40, 0.12), 0 6px 16px -2px rgba(16, 24, 40, 0.06)',
        'glow-brand': '0 0 24px -2px rgba(14, 124, 134, 0.25)',
        'glow-success': '0 0 24px -2px rgba(31, 157, 102, 0.25)',
        'glow-info': '0 0 24px -2px rgba(51, 88, 214, 0.25)',
        'glow-amber': '0 0 24px -2px rgba(226, 166, 58, 0.25)',
        'glow-danger': '0 0 24px -2px rgba(214, 69, 69, 0.25)',
      }
    }
  },
  plugins: []
}
