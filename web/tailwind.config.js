/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        teal: '#003C3E',
        salvia: '#708D81',
        vino: '#8E0A0A',
        arena: '#F0ECDF',
        marfil: '#FAF8F2',
        tinta: '#040404',
      },
      fontFamily: {
        display: ['"Young Serif"', 'Georgia', 'serif'],
        slab: ['"Josefin Slab"', 'Rockwell', 'Georgia', 'serif'],
        data: ['Montserrat', 'system-ui', 'sans-serif'],
        sans: ['Figtree', 'system-ui', 'sans-serif'],
      },
      borderRadius: { card: '32px', panel: '40px', hero: '44px' },
      boxShadow: { lift: '0 22px 30px -22px rgba(0,60,62,.55)' },
    },
  },
  plugins: [],
};
