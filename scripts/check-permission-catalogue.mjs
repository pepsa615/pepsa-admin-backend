#!/usr/bin/env node
/**
 * Drift check: order.* and payment.* keys in prisma/seed.ts must match
 * docs/permissions/catalogue.md (and vice versa).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const seed = readFileSync(join(root, 'prisma/seed.ts'), 'utf8');
const catalogue = readFileSync(join(root, 'docs/permissions/catalogue.md'), 'utf8');

const seedKeys = [
  ...seed.matchAll(/\['((?:order|payment)\.[^']+)',\s*'(LOW|MEDIUM|HIGH|CRITICAL)'/g),
].map((match) => match[1]);
const catalogueKeys = [...catalogue.matchAll(/`((?:order|payment)\.[a-z0-9.]+)`/g)].map(
  (match) => match[1],
);

const unique = (values) => [...new Set(values)].sort();
const fromSeed = unique(seedKeys);
const fromCatalogue = unique(catalogueKeys);

const missingInCatalogue = fromSeed.filter((key) => !fromCatalogue.includes(key));
const missingInSeed = fromCatalogue.filter((key) => !fromSeed.includes(key));

if (missingInCatalogue.length || missingInSeed.length) {
  console.error('Permission catalogue drift detected.');
  if (missingInCatalogue.length) {
    console.error('In seed but not catalogue.md:', missingInCatalogue.join(', '));
  }
  if (missingInSeed.length) {
    console.error('In catalogue.md but not seed:', missingInSeed.join(', '));
  }
  process.exit(1);
}

console.log(`Permission catalogue OK (${fromSeed.length} order/payment keys aligned with seed).`);
