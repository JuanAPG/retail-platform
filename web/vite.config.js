import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        host: true,
        // Docker Desktop en Windows no reenvía los eventos de inotify del
        // bind mount al contenedor: sin polling, Vite nunca se entera de que
        // un archivo cambió en el host y hay que reiniciar el contenedor a
        // mano para ver cualquier edición. En Linux/Mac esto no hace falta,
        // pero no hace daño dejarlo activo para todo el equipo.
        watch: {
            usePolling: true,
            interval: 300,
        },
    },
});
