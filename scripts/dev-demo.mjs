// Serves only the renderer (no Electron, no backend) for the `?demo` design
// preview, which runs the app against in-memory fixture data.
import { resolve } from 'node:path';
import { createServer, loadConfigFromFile } from 'vite';

const root = resolve(import.meta.dirname, '..');
const env = { command: 'serve', mode: 'development' };
const loaded = await loadConfigFromFile(env, resolve(root, 'electron.vite.config.ts'), root);
if (!loaded) throw new Error('electron.vite.config.ts not found');
const config = typeof loaded.config === 'function' ? await loaded.config(env) : loaded.config;
const { renderer } = config;
const port = Number(process.env.PORT) || 5199;

const server = await createServer({
  ...renderer,
  configFile: false,
  root: resolve(root, 'src/renderer'),
  server: { ...renderer.server, port },
});
await server.listen();
const url = server.resolvedUrls?.local[0] ?? `http://127.0.0.1:${port}/`;
console.log(`\n  TodeX demo preview: ${url}?demo   (dark: ${url}?demo&theme=dark)\n`);
