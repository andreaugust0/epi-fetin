import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // O terceiro argumento vazio faz o loadEnv trazer todas as variáveis,
  // não só as prefixadas com VITE_ — precisamos dela aqui no config, que
  // roda em Node e não no navegador.
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    server: {
      port: 5174,
      // Proxy para a API: no desenvolvimento o navegador fala com o Vite e
      // o Vite repassa para o FastAPI. Assim não há CORS para configurar
      // nem URL absoluta espalhada pelo código.
      proxy: {
        '/api': {
          target: env.VITE_API_ALVO || 'http://localhost:8000',
          changeOrigin: true,
        },
      },
    },
  };
});
