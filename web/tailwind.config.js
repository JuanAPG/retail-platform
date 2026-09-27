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
      keyframes: {
        'cadena-caja': {
          '0%, 6%, 100%': { opacity: '0', transform: 'translateY(0px)' },
          '10%, 16%': { opacity: '1', transform: 'translateY(-3px)' },
          '22%': { opacity: '0', transform: 'translateY(-3px)' },
        },
        'cadena-camion': {
          '0%, 12%, 100%': { opacity: '0', transform: 'translateX(0px)' },
          '18%': { opacity: '1', transform: 'translateX(0px)' },
          '52%': { opacity: '1', transform: 'translateX(122px)' },
          '60%, 98%': { opacity: '0', transform: 'translateX(122px)' },
        },
        'cadena-anaquel': {
          '0%, 55%, 100%': { opacity: '1' },
          '65%, 90%': { opacity: '0' },
        },
        'cadena-tienda': {
          '0%, 55%, 100%': { opacity: '0' },
          '65%, 90%': { opacity: '1' },
        },
      },
      animation: {
        'cadena-caja': 'cadena-caja 7s ease-in-out infinite',
        'cadena-camion': 'cadena-camion 7s ease-in-out infinite',
        'cadena-anaquel': 'cadena-anaquel 7s ease-in-out infinite',
        'cadena-tienda': 'cadena-tienda 7s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
