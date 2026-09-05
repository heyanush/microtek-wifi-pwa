import { defineConfig } from 'vite'; import react from '@vitejs/plugin-react'; import path from 'node:path';
export default defineConfig({ plugins:[react()], base:'/microtek-wifi-pwa/', resolve:{alias:{'@':path.resolve(__dirname,'.')}}, build:{outDir:'pages-dist',emptyOutDir:true,rollupOptions:{input:path.resolve(__dirname,'pages.html')}} });
