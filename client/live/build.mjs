// Builds the live client for the tutorial site: docs/app/index.html + live.js.
// The page is client/web/index.html with live.js loaded first. Run: npm run build:live
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const out = new URL('../../docs/app/', import.meta.url);
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [new URL('./live.mjs', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'eof',
  // lib.mjs imports @farcaster/hub-nodejs, which wraps @farcaster/core with gRPC.
  // The browser only needs core.
  alias: { '@farcaster/hub-nodejs': '@farcaster/core' },
  define: { global: 'globalThis' },
  plugins: [{
    // @farcaster/core's bundle includes test factories that import faker (3.6 MB).
    // Nothing here calls them, so a stand-in that accepts any use is enough.
    name: 'no-faker',
    setup(b) {
      b.onResolve({ filter: /^@faker-js\/faker$/ }, () => ({ path: 'faker', namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        contents: 'const any = new Proxy(function () {}, { get: () => any, apply: () => any }); export const faker = any; export default any;',
      }));
    },
  }],
  outfile: new URL('live.js', out).pathname.replace(/^\/(\w:)/, '$1'),
});

const page = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8')
  .replace('<title>farcaster-in-3</title>', `<title>Try it live · farcaster-in-3</title>
<meta name="description" content="A Farcaster client in your browser, reading straight from a Snapchain read node. No API keys, no backend.">`)
  .replace('<script>', '<script src="live.js"></script>\n<script>');
writeFileSync(new URL('index.html', out), page);
console.log('built docs/app/');
