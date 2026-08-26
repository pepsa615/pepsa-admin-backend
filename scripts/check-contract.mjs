import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';

const current = parse(
  await readFile(new URL('../src/contracts/openapi.yaml', import.meta.url), 'utf8'),
);
const baseline = parse(
  await readFile(
    new URL('../src/contracts/releases/admin-api-v1.0.0.yaml', import.meta.url),
    'utf8',
  ),
);
const methods = ['get', 'post', 'put', 'patch', 'delete'];
const breaks = [];
for (const [path, definition] of Object.entries(baseline.paths ?? {})) {
  if (!current.paths?.[path]) {
    breaks.push(`removed path ${path}`);
    continue;
  }
  for (const method of methods)
    if (definition[method] && !current.paths[path][method])
      breaks.push(`removed operation ${method.toUpperCase()} ${path}`);
}
if (current.info?.version?.split('.')[0] !== baseline.info?.version?.split('.')[0])
  breaks.push('API major version changed without a new baseline');
if (breaks.length) throw new Error(`Breaking API changes detected:\n- ${breaks.join('\n- ')}`);
console.log(`Contract ${current.info.version}: no removed v1 paths or operations`);
