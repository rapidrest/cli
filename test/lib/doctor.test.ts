///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import os from 'os';
import { applyFixes, checks, CheckContext, runDoctor } from '../../src/lib/doctor.js';

function checkById(id: string) {
  const check = checks.find((c) => c.id === id);
  if (!check) throw new Error(`No check registered with id "${id}"`);
  return check;
}

describe('doctor', () => {
  let cwd: string;
  let templatesDir: string;
  let ctx: CheckContext;

  beforeEach(async () => {
    cwd = await mkdtemp(join(os.tmpdir(), 'rrdoctor-'));
    templatesDir = await mkdtemp(join(os.tmpdir(), 'rrdoctor-tpl-'));
    ctx = { cwd, templatesDir };
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
    await rm(templatesDir, { recursive: true, force: true });
  });

  describe('sql-type-literal', () => {
    const check = checkById('sql-type-literal');

    it('flags a datastore using the CLI feature-flag name instead of the TypeORM driver literal', async () => {
      await mkdir(join(cwd, 'src'), { recursive: true });
      await writeFile(
        join(cwd, 'src', 'config.ts'),
        'export default { datastores: { acl: { type: "postgresql", host: "localhost" } } };',
      );

      const findings = await check.run(ctx);

      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('error');
      expect(findings[0].file).toBe('src/config.ts');
    });

    it('does not flag a datastore already using the correct driver literal', async () => {
      await mkdir(join(cwd, 'src'), { recursive: true });
      await writeFile(
        join(cwd, 'src', 'config.ts'),
        'export default { datastores: { acl: { type: "postgres", host: "localhost" } } };',
      );

      expect(await check.run(ctx)).toHaveLength(0);
    });

    it('checks both src/config.ts and test/config.ts', async () => {
      await mkdir(join(cwd, 'src'), { recursive: true });
      await mkdir(join(cwd, 'test'), { recursive: true });
      await writeFile(join(cwd, 'src', 'config.ts'), 'export default { datastores: { acl: { type: "postgres" } } };');
      await writeFile(join(cwd, 'test', 'config.ts'), 'export default { datastores: { acl: { type: "sqlite" } } };');

      const findings = await check.run(ctx);

      expect(findings).toHaveLength(1);
      expect(findings[0].file).toBe('test/config.ts');
    });

    it('rewrites postgresql/sqlite to postgres/better-sqlite3 when fixed', async () => {
      await mkdir(join(cwd, 'src'), { recursive: true });
      const configPath = join(cwd, 'src', 'config.ts');
      await writeFile(
        configPath,
        'export default { datastores: { acl: { type: "postgresql" }, cache: { type: "sqlite" } } };',
      );

      const findings = await check.run(ctx);
      for (const f of findings) await f.fix?.();

      const updated = await readFile(configPath, 'utf-8');
      expect(updated).toContain('type: "postgres"');
      expect(updated).toContain('type: "better-sqlite3"');
      expect(await check.run(ctx)).toHaveLength(0);
    });

    it('returns no findings when no config file exists', async () => {
      expect(await check.run(ctx)).toHaveLength(0);
    });
  });

  describe('sqlite-missing-host', () => {
    const check = checkById('sqlite-missing-host');

    it('flags a better-sqlite3 datastore with neither host nor url', async () => {
      await mkdir(join(cwd, 'src'), { recursive: true });
      await writeFile(
        join(cwd, 'src', 'config.ts'),
        'export default { datastores: { acl: { type: "better-sqlite3" } } };',
      );

      const findings = await check.run(ctx);

      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('error');
    });

    it('does not flag a better-sqlite3 datastore that already has a host', async () => {
      await mkdir(join(cwd, 'src'), { recursive: true });
      await writeFile(
        join(cwd, 'src', 'config.ts'),
        'export default { datastores: { acl: { type: "better-sqlite3", host: "localhost" } } };',
      );

      expect(await check.run(ctx)).toHaveLength(0);
    });

    it('does not flag a better-sqlite3 datastore that has a url instead of a host', async () => {
      await mkdir(join(cwd, 'src'), { recursive: true });
      await writeFile(
        join(cwd, 'src', 'config.ts'),
        'export default { datastores: { acl: { type: "better-sqlite3", url: "file:./db.sqlite" } } };',
      );

      expect(await check.run(ctx)).toHaveLength(0);
    });

    it('does not flag non-sqlite datastores', async () => {
      await mkdir(join(cwd, 'src'), { recursive: true });
      await writeFile(
        join(cwd, 'src', 'config.ts'),
        'export default { datastores: { acl: { type: "postgres" } } };',
      );

      expect(await check.run(ctx)).toHaveLength(0);
    });

    it('inserts a placeholder host when fixed, without touching other datastores', async () => {
      await mkdir(join(cwd, 'src'), { recursive: true });
      const configPath = join(cwd, 'src', 'config.ts');
      await writeFile(
        configPath,
        'export default { datastores: { acl: { type: "better-sqlite3" }, cache: { type: "postgres", host: "db" } } };',
      );

      const findings = await check.run(ctx);
      expect(findings).toHaveLength(1);
      await findings[0].fix?.();

      const updated = await readFile(configPath, 'utf-8');
      expect(updated).toMatch(/type: "better-sqlite3",\s*\n\s*host: "localhost"/);
      expect(updated).toContain('type: "postgres", host: "db"');
      expect(await check.run(ctx)).toHaveLength(0);
    });

    it('skips over line comments inside the datastores block without misparsing them', async () => {
      await mkdir(join(cwd, 'src'), { recursive: true });
      await writeFile(
        join(cwd, 'src', 'config.ts'),
        [
          'export default { datastores: {',
          '  // acl is file-based and has no host/url yet, see below',
          '  acl: { type: "better-sqlite3" },',
          '} };',
        ].join('\n'),
      );

      const findings = await check.run(ctx);

      expect(findings).toHaveLength(1);
      expect(findings[0].file).toBe('src/config.ts');
    });

    it('fix is a no-op when the file content changed since scanning (block no longer found)', async () => {
      await mkdir(join(cwd, 'src'), { recursive: true });
      const configPath = join(cwd, 'src', 'config.ts');
      await writeFile(
        configPath,
        'export default { datastores: { acl: { type: "better-sqlite3" } } };',
      );

      const findings = await check.run(ctx);
      expect(findings).toHaveLength(1);

      await writeFile(configPath, 'export default { datastores: {} };');
      await findings[0].fix?.();

      expect(await readFile(configPath, 'utf-8')).toBe('export default { datastores: {} };');
    });
  });

  describe('missing-vitest-config', () => {
    const check = checkById('missing-vitest-config');

    it('flags a project with no vitest.config.ts', async () => {
      const findings = await check.run(ctx);
      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('error');
    });

    it('does not flag a project that already has vitest.config.ts', async () => {
      await writeFile(join(cwd, 'vitest.config.ts'), 'export default {};');
      expect(await check.run(ctx)).toHaveLength(0);
    });

    it('copies the canonical template file when fixed', async () => {
      await mkdir(join(templatesDir, 'server'), { recursive: true });
      await writeFile(join(templatesDir, 'server', 'vitest.config.ts'), 'export default { test: {} };');

      const findings = await check.run(ctx);
      await findings[0].fix?.();

      expect(await readFile(join(cwd, 'vitest.config.ts'), 'utf-8')).toBe('export default { test: {} };');
      expect(await check.run(ctx)).toHaveLength(0);
    });
  });

  describe('missing-types-typeorm / missing-types-redis', () => {
    it('does not flag a project without @rapidrest/service-core installed', async () => {
      await writeFile(join(cwd, 'package.json'), JSON.stringify({ dependencies: {} }));
      expect(await checkById('missing-types-typeorm').run(ctx)).toHaveLength(0);
    });

    it('flags a project with service-core installed but typeorm resolvable nowhere', async () => {
      await mkdir(join(cwd, 'node_modules', '@rapidrest', 'service-core'), { recursive: true });
      await writeFile(join(cwd, 'package.json'), JSON.stringify({ dependencies: {}, devDependencies: {} }));

      const findings = await checkById('missing-types-typeorm').run(ctx);

      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('warning');
    });

    it('does not flag when typeorm is already a dependency', async () => {
      await mkdir(join(cwd, 'node_modules', '@rapidrest', 'service-core'), { recursive: true });
      await writeFile(join(cwd, 'package.json'), JSON.stringify({ dependencies: { typeorm: '^1.1.0' } }));

      expect(await checkById('missing-types-typeorm').run(ctx)).toHaveLength(0);
    });

    it('does not flag when redis is already a devDependency', async () => {
      await mkdir(join(cwd, 'node_modules', '@rapidrest', 'service-core'), { recursive: true });
      await writeFile(join(cwd, 'package.json'), JSON.stringify({ devDependencies: { redis: '^6.2.1' } }));

      expect(await checkById('missing-types-redis').run(ctx)).toHaveLength(0);
    });

    it('adds the dependency as a devDependency when fixed, preserving other package.json fields', async () => {
      await mkdir(join(cwd, 'node_modules', '@rapidrest', 'service-core'), { recursive: true });
      const pkgPath = join(cwd, 'package.json');
      await writeFile(pkgPath, JSON.stringify({ name: 'my-app', dependencies: {} }));

      const findings = await checkById('missing-types-typeorm').run(ctx);
      await findings[0].fix?.();

      const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
      expect(pkg.name).toBe('my-app');
      expect(pkg.devDependencies.typeorm).toBe('^1.1.0');
      expect(await checkById('missing-types-typeorm').run(ctx)).toHaveLength(0);
    });

    it('fix is a no-op when package.json is missing at fix time', async () => {
      await mkdir(join(cwd, 'node_modules', '@rapidrest', 'service-core'), { recursive: true });
      await writeFile(join(cwd, 'package.json'), JSON.stringify({}));

      const findings = await checkById('missing-types-typeorm').run(ctx);
      await rm(join(cwd, 'package.json'));

      await expect(findings[0].fix?.()).resolves.toBeUndefined();
    });
  });

  describe('eslint-plugin-import-conflict', () => {
    const check = checkById('eslint-plugin-import-conflict');

    it('flags eslint-plugin-import alongside eslint@10+', async () => {
      await writeFile(
        join(cwd, 'package.json'),
        JSON.stringify({ devDependencies: { eslint: '^10.0.0', 'eslint-plugin-import': '^2.29.0' } }),
      );

      const findings = await check.run(ctx);

      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('error');
    });

    it('does not flag eslint-plugin-import alongside eslint@9', async () => {
      await writeFile(
        join(cwd, 'package.json'),
        JSON.stringify({ devDependencies: { eslint: '^9.0.0', 'eslint-plugin-import': '^2.29.0' } }),
      );

      expect(await check.run(ctx)).toHaveLength(0);
    });

    it('does not flag when eslint-plugin-import is absent', async () => {
      await writeFile(join(cwd, 'package.json'), JSON.stringify({ devDependencies: { eslint: '^10.0.0' } }));
      expect(await check.run(ctx)).toHaveLength(0);
    });

    it('does not flag when there is no package.json', async () => {
      expect(await check.run(ctx)).toHaveLength(0);
    });

    it('removes eslint-plugin-import from both deps and devDeps when fixed', async () => {
      const pkgPath = join(cwd, 'package.json');
      await writeFile(
        pkgPath,
        JSON.stringify({
          dependencies: { 'eslint-plugin-import': '^2.29.0' },
          devDependencies: { eslint: '^10.0.0', 'eslint-plugin-import': '^2.29.0' },
        }),
      );

      const findings = await check.run(ctx);
      await findings[0].fix?.();

      const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
      expect(pkg.dependencies['eslint-plugin-import']).toBeUndefined();
      expect(pkg.devDependencies['eslint-plugin-import']).toBeUndefined();
      expect(pkg.devDependencies.eslint).toBe('^10.0.0');
      expect(await check.run(ctx)).toHaveLength(0);
    });

    it('fix is a no-op when package.json is missing at fix time', async () => {
      await writeFile(
        join(cwd, 'package.json'),
        JSON.stringify({ devDependencies: { eslint: '^10.0.0', 'eslint-plugin-import': '^2.29.0' } }),
      );

      const findings = await check.run(ctx);
      await rm(join(cwd, 'package.json'));

      await expect(findings[0].fix?.()).resolves.toBeUndefined();
    });

    it('removes eslint-plugin-import from dependencies only, when it is not in devDependencies', async () => {
      const pkgPath = join(cwd, 'package.json');
      await writeFile(
        pkgPath,
        JSON.stringify({ dependencies: { eslint: '^10.0.0', 'eslint-plugin-import': '^2.29.0' } }),
      );

      const findings = await check.run(ctx);
      await findings[0].fix?.();

      const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
      expect(pkg.dependencies['eslint-plugin-import']).toBeUndefined();
      expect(pkg.dependencies.eslint).toBe('^10.0.0');
      expect(pkg.devDependencies).toBeUndefined();
    });
  });

  describe('old-acl-format', () => {
    const check = checkById('old-acl-format');

    it('flags a model file using the old boolean-flag ACLRecord shape', async () => {
      await mkdir(join(cwd, 'src', 'models'), { recursive: true });
      await writeFile(
        join(cwd, 'src', 'models', 'Widget.ts'),
        '@Protect({ records: [{ roles: ["admin"], create: true, special: true }] })\nclass Widget {}',
      );

      const findings = await check.run(ctx);

      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('warning');
      expect(findings[0].file).toBe('src/models/Widget.ts');
      expect(findings[0].fix).toBeUndefined();
    });

    it('flags a route file the same way', async () => {
      await mkdir(join(cwd, 'src', 'routes'), { recursive: true });
      await writeFile(
        join(cwd, 'src', 'routes', 'Widget.ts'),
        '@Protect({ records: [{ special: false }] })\nclass WidgetRoute {}',
      );

      const findings = await check.run(ctx);

      expect(findings).toHaveLength(1);
      expect(findings[0].file).toBe('src/routes/Widget.ts');
    });

    it('does not flag a file already using actions[]', async () => {
      await mkdir(join(cwd, 'src', 'models'), { recursive: true });
      await writeFile(
        join(cwd, 'src', 'models', 'Widget.ts'),
        '@Protect({ records: [{ roles: ["admin"], actions: [ACLAction.CREATE] }] })\nclass Widget {}',
      );

      expect(await check.run(ctx)).toHaveLength(0);
    });

    it('returns no findings when src/models and src/routes do not exist', async () => {
      expect(await check.run(ctx)).toHaveLength(0);
    });

    it('ignores .d.ts files', async () => {
      await mkdir(join(cwd, 'src', 'models'), { recursive: true });
      await writeFile(
        join(cwd, 'src', 'models', 'Widget.d.ts'),
        '@Protect({ records: [{ special: true }] })',
      );

      expect(await check.run(ctx)).toHaveLength(0);
    });
  });

  describe('jwtuser-extra-name', () => {
    const check = checkById('jwtuser-extra-name');

    it('flags a createToken call whose user object includes a name field', async () => {
      await mkdir(join(cwd, 'src'), { recursive: true });
      await writeFile(
        join(cwd, 'src', 'server.ts'),
        'const token = await JWTUtils.createToken(auth, { uid: "x", roles: [], name: "svc" });',
      );

      const findings = await check.run(ctx);

      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('warning');
      expect(findings[0].file).toBe('src/server.ts');
      expect(findings[0].fix).toBeUndefined();
    });

    it('flags createTokenSync the same way', async () => {
      await mkdir(join(cwd, 'src'), { recursive: true });
      await writeFile(
        join(cwd, 'src', 'server.ts'),
        'const token = JWTUtils.createTokenSync(auth, { uid: "x", name: "svc" });',
      );

      expect(await check.run(ctx)).toHaveLength(1);
    });

    it('does not flag a createToken call without a name field', async () => {
      await mkdir(join(cwd, 'src'), { recursive: true });
      await writeFile(
        join(cwd, 'src', 'server.ts'),
        'const token = await JWTUtils.createToken(auth, { uid: "x", roles: [] });',
      );

      expect(await check.run(ctx)).toHaveLength(0);
    });

    it('walks nested src directories and ignores non-.ts files', async () => {
      await mkdir(join(cwd, 'src', 'routes'), { recursive: true });
      await writeFile(
        join(cwd, 'src', 'routes', 'Auth.ts'),
        'JWTUtils.createToken(auth, { uid: "x", name: "svc" });',
      );
      await writeFile(join(cwd, 'src', 'routes', 'README.md'), 'JWTUtils.createToken(auth, { name: "svc" });');

      const findings = await check.run(ctx);
      expect(findings).toHaveLength(1);
      expect(findings[0].file).toBe('src/routes/Auth.ts');
    });

    it('returns no findings when src does not exist', async () => {
      expect(await check.run(ctx)).toHaveLength(0);
    });
  });

  describe('runDoctor', () => {
    it('aggregates findings from every check by default', async () => {
      const findings = await runDoctor(ctx);
      // vitest.config.ts is always missing in a bare tmpdir fixture
      expect(findings.some((f) => f.id === 'missing-vitest-config')).toBe(true);
    });

    it('only runs the checks explicitly selected', async () => {
      const findings = await runDoctor(ctx, [checkById('missing-vitest-config')]);
      expect(findings.every((f) => f.id === 'missing-vitest-config')).toBe(true);
    });

    it('returns no findings for a clean project', async () => {
      await writeFile(join(cwd, 'vitest.config.ts'), 'export default {};');
      const findings = await runDoctor(ctx, [checkById('missing-vitest-config'), checkById('sql-type-literal')]);
      expect(findings).toHaveLength(0);
    });
  });

  describe('applyFixes', () => {
    it('applies every finding with a fix and leaves the rest skipped', async () => {
      await writeFile(join(cwd, 'package.json'), JSON.stringify({}));
      const fixable = {
        id: 'fixable',
        severity: 'error' as const,
        message: 'fixable',
        fix: async () => { await writeFile(join(cwd, 'fixed.txt'), 'done'); },
      };
      const unfixable = { id: 'unfixable', severity: 'warning' as const, message: 'unfixable' };

      const result = await applyFixes([fixable, unfixable]);

      expect(result.fixed).toEqual([fixable]);
      expect(result.skipped).toEqual([unfixable]);
      expect(await readFile(join(cwd, 'fixed.txt'), 'utf-8')).toBe('done');
    });

    it('returns empty arrays for an empty findings list', async () => {
      const result = await applyFixes([]);
      expect(result.fixed).toHaveLength(0);
      expect(result.skipped).toHaveLength(0);
    });
  });
});
