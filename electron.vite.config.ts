import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const desktopRoot = import.meta.dirname;
const buildVersion = process.env.TODEX_BUILD_VERSION?.trim() || 'DEV0.0.0';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          format: 'cjs',
          inlineDynamicImports: true,
          entryFileNames: '[name].cjs',
          chunkFileNames: '[name].cjs',
          assetFileNames: '[name].[ext]',
        },
      },
    },
  },
  renderer: {
    esbuild: {
      tsconfigRaw: JSON.stringify({
        compilerOptions: {
          jsx: 'react-jsx',
          useDefineForClassFields: true,
        },
      }),
    },
    define: {
      __TODEX_BUILD_VERSION__: JSON.stringify(buildVersion),
    },
    server: {
      host: '127.0.0.1',
    },
    resolve: {
      alias: {
        '@renderer': resolve(desktopRoot, 'src/renderer'),
        '@todex/protocol': resolve(desktopRoot, '../TodeX_app/src/lib'),
        '@noble/ciphers': resolve(desktopRoot, 'node_modules/@noble/ciphers'),
        '@noble/curves': resolve(desktopRoot, 'node_modules/@noble/curves'),
        '@noble/hashes': resolve(desktopRoot, 'node_modules/@noble/hashes'),
        '@noble/post-quantum': resolve(desktopRoot, 'node_modules/@noble/post-quantum'),
        '@react-native-community/netinfo': resolve(desktopRoot, 'src/renderer/stubs/netinfo.ts'),
      },
    },
    plugins: [react(), tailwindcss()],
  },
});
