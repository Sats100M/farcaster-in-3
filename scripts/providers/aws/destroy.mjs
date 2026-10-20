// Terminates the node instance (its volumes go with it) and deletes the security group.
//
// Usage:  node scripts/destroy.mjs --provider aws [--yes]

import { createInterface } from 'node:readline/promises';
import { forgetServer } from '../../server.mjs';
import { aws, requireLogin, NAME_FILTER } from './cli.mjs';

requireLogin();

const instances = aws(['ec2', 'describe-instances', '--filters', NAME_FILTER,
  'Name=instance-state-name,Values=pending,running,stopping,stopped'], { quiet: true })
  .Reservations.flatMap((r) => r.Instances);
const groups = aws(['ec2', 'describe-security-groups', '--filters', NAME_FILTER], { quiet: true }).SecurityGroups;

if (!instances.length && !groups.length) {
  forgetServer();
  console.log('Nothing to delete.');
  process.exit(0);
}

console.log('This will permanently delete:');
for (const i of instances) console.log(`  instance       ${i.InstanceId}  ${i.InstanceType}  ${i.PublicIpAddress ?? ''}  (and its volumes)`);
for (const g of groups) console.log(`  security group ${g.GroupId}  ${g.GroupName}`);

if (!process.argv.includes('--yes')) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Type "delete" to confirm: ');
  rl.close();
  if (answer.trim() !== 'delete') process.exit(0);
}

if (instances.length) {
  const ids = instances.map((i) => i.InstanceId);
  aws(['ec2', 'terminate-instances', '--instance-ids', ...ids], { quiet: true });
  console.log('  terminating (1-2 minutes)...');
  aws(['ec2', 'wait', 'instance-terminated', '--instance-ids', ...ids], { quiet: true });
  console.log(`✓ terminated ${ids.join(', ')}`);
}
// A security group can only go once no instance uses it.
for (const g of groups) {
  aws(['ec2', 'delete-security-group', '--group-id', g.GroupId], { quiet: true });
  console.log(`✓ deleted security group ${g.GroupId}`);
}
forgetServer();
console.log('All gone. Billing for these resources has stopped.');
