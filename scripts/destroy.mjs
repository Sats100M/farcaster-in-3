#!/usr/bin/env node
// Deletes everything provision.mjs created, so billing stops.
//
//   node scripts/destroy.mjs                        # AWS (default)
//   node scripts/destroy.mjs --provider azure
//   node scripts/destroy.mjs --provider hetzner
import { run } from './dispatch.mjs';

await run('destroy');
