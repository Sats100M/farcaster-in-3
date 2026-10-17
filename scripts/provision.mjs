#!/usr/bin/env node
// Command 0: rent the compute for a Snapchain read node.
//
//   node scripts/provision.mjs                      # AWS (default)
//   node scripts/provision.mjs --provider azure
//   node scripts/provision.mjs --provider hetzner
//
// Each provider lives in scripts/providers/<name>/ and is a plain script.
import { run } from './dispatch.mjs';

await run('provision');
