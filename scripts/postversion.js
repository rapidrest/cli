import { readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = process.env.npm_package_version;

const templatePkg = join(root, 'templates', 'server', 'package.json');
const content = await readFile(templatePkg, 'utf-8');
const updated = content.replace(
  /"@rapidrest\/cli":\s*"\^[\w.-]+"/,
  `"@rapidrest/cli": "^${version}"`,
);

if (updated === content) {
  process.stderr.write('postversion: @rapidrest/cli entry not found in templates/server/package.json\n');
  process.exit(1);
}

await writeFile(templatePkg, updated, 'utf-8');
console.log(`postversion: @rapidrest/cli → ^${version} in templates/server/package.json`);
