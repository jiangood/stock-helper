import {defineConfig, loadEnv} from 'vite';
import react from '@vitejs/plugin-react';
import openAdmin from '@jiangood/open-admin/vite-plugin';

export default defineConfig(({mode, command}) => {
    const env = loadEnv(mode, process.cwd(), '');
    const servletContext = env.VITE_SERVER_SERVLET_CONTEXT_PATH || '/';
    const serverPort = env.SERVER_PORT || '8080';
    const port = Number(env.PORT || 3000);

    return {
        plugins: [react(), openAdmin()],
        base: command === 'build' ? './' : '/',
        optimizeDeps: {
            entries: [
                'index.html',
                './node_modules/@jiangood/open-admin/src/**/*.{ts,tsx,js,jsx}',
            ],
        },
        server: {
            port,
            proxy: (() => {
                const proxy = {};
                for (const p of ['admin', 'file', 'ureport']) {
                    proxy[servletContext.replace(/\/$/, '') + '/' + p] = {
                        target: `http://127.0.0.1:${serverPort}`,
                        changeOrigin: true,
                        ws: true,
                    };
                }
                return proxy;
            })(),
        },
    };
});
