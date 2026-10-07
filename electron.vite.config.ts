import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import type { Plugin } from 'vite';

const desktopRoot = import.meta.dirname;
const buildVersion = process.env.TODEX_BUILD_VERSION?.trim() || 'DEV0.0.0';

/**
 * Content Security Policy of the bundled renderer. Scripts only come from the
 * app bundle ('wasm-unsafe-eval' lets Shiki compile its bundled Oniguruma
 * WebAssembly; it does not allow JS eval); connections go to whatever backend the user configured (any
 * http/https/ws/wss host). Images allow remote http(s) for Markdown in chat.
 * Styles keep 'unsafe-inline' because HeroUI and xterm inject <style> tags.
 * Build-only: the dev server needs inline React Refresh code and its HMR socket.
 */
const RENDERER_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: http: https:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob: http: https: ws: wss:",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-src 'none'",
].join('; ');

const rendererCsp: Plugin = {
  name: 'todex-renderer-csp',
  apply: 'build',
  transformIndexHtml: () => [{
    tag: 'meta',
    attrs: { 'http-equiv': 'Content-Security-Policy', content: RENDERER_CSP },
    injectTo: 'head-prepend',
  }],
};

export default defineConfig({
  main: {
    define: {
      __TODEX_BUILD_VERSION__: JSON.stringify(buildVersion),
    },
    // The agent desktop executor speaks the shared protocol from main.
    resolve: {
      alias: {
        '@todex/protocol': resolve(desktopRoot, '../TodeX_protocol/src'),
        '@react-native-community/netinfo': resolve(desktopRoot, 'src/renderer/stubs/netinfo.ts'),
      },
    },
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    define: {
      __TODEX_BUILD_VERSION__: JSON.stringify(buildVersion),
    },
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
        '@todex/protocol': resolve(desktopRoot, '../TodeX_protocol/src'),
        '@noble/ciphers': resolve(desktopRoot, 'node_modules/@noble/ciphers'),
        '@noble/curves': resolve(desktopRoot, 'node_modules/@noble/curves'),
        '@noble/hashes': resolve(desktopRoot, 'node_modules/@noble/hashes'),
        '@noble/post-quantum': resolve(desktopRoot, 'node_modules/@noble/post-quantum'),
        '@react-native-community/netinfo': resolve(desktopRoot, 'src/renderer/stubs/netinfo.ts'),
      },
    },
    plugins: [react(), tailwindcss(), rendererCsp],
  },
});
