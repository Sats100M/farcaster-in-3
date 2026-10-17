// Shared entry point for provision.mjs / destroy.mjs: load .env, pick the provider, run it.
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const envFile = root + '.env';
// Tokens such as HCLOUD_TOKEN can live in a .env at the repo root (Node 20.12+).
if (existsSync(envFile) && process.loadEnvFile) process.loadEnvFile(envFile);

export async function run(command) {
  const i = process.argv.indexOf('--provider');
  const provider = i > -1 ? process.argv[i + 1] : process.env.PROVIDER || 'aws';
  const providers = readdirSync(new URL('./providers', import.meta.url));
  if (!providers.includes(provider)) {
    console.error(`Unknown provider "${provider}". Available: ${providers.join(', ')}`);
    process.exit(1);
  }
  await import(`./providers/${provider}/${command}.mjs`);
}
