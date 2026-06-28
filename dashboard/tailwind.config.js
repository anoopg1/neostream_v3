/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        bg: {
          primary:  '#0F0F13',
          surface:  '#1A1A24',
          elevated: '#222233',
        },
        border: '#2A2A3A',
        accent: {
          DEFAULT: '#6366F1',
          hover:   '#4F46E5',
        },
        success: '#22C55E',
        warning: '#F59E0B',
        danger:  '#EF4444',
        text: {
          primary: '#F1F5F9',
          muted:   '#64748B',
          dim:     '#334155',
        },
      },
    },
  },
  plugins: [],
};
