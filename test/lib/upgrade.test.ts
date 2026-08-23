///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import os from 'os';
import { applyUpgrade, planUpgrade, UpgradeContext } from '../../src/lib/upgrade.js';

async function writeFileDeep(path: string, content: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content, 'utf-8');
}

describe('upgrade', () => {
  let cwd: string;
  let templatesDir: string;
  let ctx: UpgradeContext;

  beforeEach(async () => {
    cwd = await mkdtemp(join(os.tmpdir(), 'rrupgrade-'));
    templatesDir = await mkdtemp(join(os.tmpdir(), 'rrupgrade-tpl-'));
    ctx = { cwd, templatesDir };

    // Minimal fixture templates dir mirroring the real templates/{server,docker,helm,default-route}
    // shape upgrade.ts relies on — kept deliberately tiny so tests aren't coupled to the real
    // templates' actual content.
    // Built as raw text with Handlebars conditional blocks (mirrors the real template's
    // approach) rather than JSON.stringify, since the placeholder needs to sit inside the JSON
    // structure conditionally, not as a JSON value itself.
    await writeFileDeep(
      join(templatesDir, 'server', 'package.json'),
      [
        '{',
        '  "dependencies": {',
        '    "@rapidrest/core": "^5.1.0"{{#if features.hasSqlDatastore}},',
        '    "typeorm": "^1.1.0"{{/if}}',
        '  },',
        '  "devDependencies": {',
        '    "typescript": "^6.0.3"',
        '  }',
        '}',
      ].join('\n'),
    );
    await writeFileDeep(join(templatesDir, 'server', 'eslint.config.mjs'), 'export default { rule: "new" };\n');
    await writeFileDeep(join(templatesDir, 'server', 'README.md'), '# {{project_name}}\n\n{{description}}\n\ngit clone {{repository}}\n');
    await writeFileDeep(
      join(templatesDir, 'server', 'src', 'routes', 'HelloRoute.ts'),
      '// Copyright (C) {{year}} {{author}}\n@{{#if apiRoute}}Api{{/if}}Route("/hello"{{#if apiVersion}}, "{{apiVersion}}"{{/if}})\nexport default class HelloRoute {}\n',
    );
    await writeFileDeep(join(templatesDir, 'docker', 'Dockerfile'), 'FROM node:latest\n');
    await writeFileDeep(join(templatesDir, 'helm', 'helm', 'Chart.yaml'), 'name: {{project_name}}\n');
    await writeFileDeep(join(templatesDir, 'helm', 'patches', 'package.json'), JSON.stringify({ dependencies: { 'helm-dep': '^1.0.0' } }));
    await writeFileDeep(
      join(templatesDir, 'default-route', 'src', 'routes', 'StatusRoute.ts'),
      '@{{#if apiRoute}}Api{{/if}}Route("/status"{{#if apiVersion}}, "{{apiVersion}}"{{/if}})\nexport class StatusRoute {}\n',
    );
    await writeFileDeep(join(templatesDir, 'react', 'patches', 'package.json'), JSON.stringify({ dependencies: { 'react-dep': '^1.0.0' } }));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
    await rm(templatesDir, { recursive: true, force: true });
  });

  async function scaffoldProject(overrides: Partial<{
    packageJson: { name: string; description?: string; repository?: string } & Record<string, unknown>;
    eslintConfig: string;
    helloRoute: string;
    statusRoute: string;
    configTs: string;
    readme: string;
    dockerfile: boolean;
    helmChart: boolean;
    viteConfig: boolean;
  }> = {}): Promise<void> {
    const pkg = overrides.packageJson ?? {
      name: 'my-app',
      description: 'An example app',
      repository: 'git/my-app',
      dependencies: { '@rapidrest/core': '^5.1.0' },
      devDependencies: { typescript: '^6.0.3' },
    };
    // Written tab-indented (JSON.stringify's third arg) to match the real server template's
    // package.json convention, so detectIndent() picks up "\t" rather than falling back to "  ".
    await writeFileDeep(join(cwd, 'package.json'), JSON.stringify(pkg, null, '\t') + '\n');
    await writeFileDeep(
      join(cwd, 'README.md'),
      overrides.readme ?? `# ${pkg.name}\n\n${pkg.description ?? ''}\n\ngit clone ${pkg.repository ?? ''}\n`,
    );

    await writeFileDeep(join(cwd, 'eslint.config.mjs'), overrides.eslintConfig ?? 'export default { rule: "old" };\n');
    await writeFileDeep(
      join(cwd, 'src', 'routes', 'HelloRoute.ts'),
      overrides.helloRoute ?? '// Copyright (C) 2020 Old Author\n@Route("/hello")\nexport default class HelloRoute {}\n',
    );
    if (overrides.statusRoute !== undefined) {
      await writeFileDeep(join(cwd, 'src', 'routes', 'StatusRoute.ts'), overrides.statusRoute);
    }
    await writeFileDeep(join(cwd, 'src', 'config.ts'), overrides.configTs ?? 'export default { datastores: { acl: { type: "postgres" } } };');
    if (overrides.dockerfile) await writeFileDeep(join(cwd, 'Dockerfile'), 'FROM node:old\n');
    if (overrides.helmChart) await writeFileDeep(join(cwd, 'helm', 'Chart.yaml'), 'name: old\n');
    if (overrides.viteConfig) await writeFileDeep(join(cwd, 'vite.config.ts'), 'export default {};\n');
  }

  describe('planUpgrade — file changes', () => {
    it('reports a file change when boilerplate content differs from the current template', async () => {
      await scaffoldProject();

      const plan = await planUpgrade(ctx);

      const eslintChange = plan.fileChanges.find((f) => f.relPath === 'eslint.config.mjs');
      expect(eslintChange).toBeDefined();
      expect(eslintChange!.templateDir).toBe('server');
      expect(eslintChange!.content).toBe('export default { rule: "new" };\n');
    });

    it('does not report a change when content already matches', async () => {
      await scaffoldProject({ eslintConfig: 'export default { rule: "new" };\n' });

      const plan = await planUpgrade(ctx);

      expect(plan.fileChanges.find((f) => f.relPath === 'eslint.config.mjs')).toBeUndefined();
    });

    it('never reports a file that does not already exist in the project (Dockerfile absent)', async () => {
      await scaffoldProject({ dockerfile: false });

      const plan = await planUpgrade(ctx);

      expect(plan.fileChanges.find((f) => f.relPath === 'Dockerfile')).toBeUndefined();
    });

    it('reports a Dockerfile change when the project already has one and it differs', async () => {
      await scaffoldProject({ dockerfile: true });

      const plan = await planUpgrade(ctx);

      const change = plan.fileChanges.find((f) => f.relPath === 'Dockerfile');
      expect(change).toBeDefined();
      expect(change!.content).toBe('FROM node:latest\n');
    });

    it('never includes src/config.ts in fileChanges, even though it is a real templates/server output file that differs', async () => {
      await writeFileDeep(
        join(templatesDir, 'server', 'src', 'config.ts'),
        'export default { datastores: { acl: { type: "{{#if features.postgresql}}postgres{{/if}}" } } };',
      );
      await scaffoldProject({
        configTs: 'export default { datastores: { acl: { type: "postgres" }, orders: { type: "mongodb" } } };',
      });

      const plan = await planUpgrade(ctx);

      expect(plan.fileChanges.find((f) => f.relPath === 'src/config.ts')).toBeUndefined();
    });

    it('never includes test/config.ts in fileChanges', async () => {
      await writeFileDeep(join(templatesDir, 'server', 'test', 'config.ts'), 'export default {};');
      await writeFileDeep(join(cwd, 'test', 'config.ts'), 'export default { custom: true };');
      await scaffoldProject();

      const plan = await planUpgrade(ctx);

      expect(plan.fileChanges.find((f) => f.relPath === 'test/config.ts')).toBeUndefined();
    });

    it('applyUpgrade never writes to src/config.ts even when other server files change', async () => {
      await writeFileDeep(
        join(templatesDir, 'server', 'src', 'config.ts'),
        'export default { datastores: { acl: { type: "{{#if features.postgresql}}postgres{{/if}}" } } };',
      );
      const customConfig = 'export default { datastores: { acl: { type: "postgres" }, orders: { type: "mongodb" } } };';
      await scaffoldProject({ configTs: customConfig });

      const plan = await planUpgrade(ctx);
      await applyUpgrade(ctx, plan);

      expect(await readFile(join(cwd, 'src', 'config.ts'), 'utf-8')).toBe(customConfig);
    });

    it('never includes package.json in fileChanges even though its content differs', async () => {
      await scaffoldProject();

      const plan = await planUpgrade(ctx);

      expect(plan.fileChanges.find((f) => f.relPath === 'package.json')).toBeUndefined();
    });

    it('treats CRLF vs LF as equivalent (no false-positive change from line endings alone)', async () => {
      await scaffoldProject({ eslintConfig: 'export default { rule: "new" };\r\n' });

      const plan = await planUpgrade(ctx);

      expect(plan.fileChanges.find((f) => f.relPath === 'eslint.config.mjs')).toBeUndefined();
    });

    it('reads description/repository from the project\'s own package.json to render README.md correctly', async () => {
      await scaffoldProject({
        packageJson: { name: 'my-app', description: 'A cool app', repository: 'github/my-app' },
        readme: '# my-app\n\nold description\n\ngit clone old/repo\n',
      });

      const plan = await planUpgrade(ctx);

      const change = plan.fileChanges.find((f) => f.relPath === 'README.md');
      expect(change).toBeDefined();
      expect(change!.content).toBe('# my-app\n\nA cool app\n\ngit clone github/my-app\n');
    });

    it('does not report README.md as changed when it already matches the project\'s description/repository', async () => {
      await scaffoldProject();

      const plan = await planUpgrade(ctx);

      expect(plan.fileChanges.find((f) => f.relPath === 'README.md')).toBeUndefined();
    });

    it('detects apiRoute/apiVersion from HelloRoute.ts and threads it into default-route rendering', async () => {
      await scaffoldProject({
        helloRoute: '@ApiRoute("/hello", "2")\nexport default class HelloRoute {}\n',
        statusRoute: '@Route("/status")\nexport class StatusRoute {}\n',
      });

      const plan = await planUpgrade(ctx);

      const change = plan.fileChanges.find((f) => f.relPath === 'src/routes/StatusRoute.ts');
      expect(change).toBeDefined();
      expect(change!.content).toContain('@ApiRoute("/status", "2")');
    });

    it('falls back to no api prefix when HelloRoute.ts exists but has no recognizable @Route decorator', async () => {
      await scaffoldProject({
        helloRoute: '// no decorator here at all\nexport default class HelloRoute {}\n',
        statusRoute: '@Route("/status")\nexport class StatusRoute {}\n',
      });

      const plan = await planUpgrade(ctx);

      expect(plan.fileChanges.find((f) => f.relPath === 'src/routes/StatusRoute.ts')).toBeUndefined();
    });

    it('falls back to no api prefix when HelloRoute.ts is missing', async () => {
      await scaffoldProject({ statusRoute: '@Route("/status")\nexport class StatusRoute {}\n' });
      await rm(join(cwd, 'src', 'routes', 'HelloRoute.ts'));

      const plan = await planUpgrade(ctx);

      const change = plan.fileChanges.find((f) => f.relPath === 'src/routes/StatusRoute.ts');
      expect(change).toBeUndefined();
    });

    it('does not report a default-route file the project never had', async () => {
      await scaffoldProject();

      const plan = await planUpgrade(ctx);

      expect(plan.fileChanges.find((f) => f.relPath === 'src/routes/StatusRoute.ts')).toBeUndefined();
    });
  });

  describe('planUpgrade — dependency changes', () => {
    it('reports a stale version pin', async () => {
      await scaffoldProject({
        packageJson: { name: 'my-app', dependencies: { '@rapidrest/core': '^4.0.0' }, devDependencies: {} },
      });

      const plan = await planUpgrade(ctx);

      const change = plan.dependencyChanges.find((d) => d.name === '@rapidrest/core');
      expect(change).toEqual({ section: 'dependencies', name: '@rapidrest/core', from: '^4.0.0', to: '^5.1.0' });
    });

    it('derives hasSqlDatastore from a sqlite-only datastore too (not just postgres)', async () => {
      await scaffoldProject({
        packageJson: { name: 'my-app', dependencies: {}, devDependencies: {} },
        configTs: 'export default { datastores: { acl: { type: "better-sqlite3" } } };',
      });

      const plan = await planUpgrade(ctx);

      expect(plan.dependencyChanges.find((d) => d.name === 'typeorm')).toBeDefined();
    });

    it('reports a missing dependency as an addition (from undefined)', async () => {
      await scaffoldProject({
        packageJson: { name: 'my-app', dependencies: {}, devDependencies: {} },
        configTs: 'export default { datastores: { acl: { type: "postgres" } } };',
      });

      const plan = await planUpgrade(ctx);

      const change = plan.dependencyChanges.find((d) => d.name === 'typeorm');
      expect(change).toEqual({ section: 'dependencies', name: 'typeorm', from: undefined, to: '^1.1.0' });
    });

    it('does not report a dependency that already matches', async () => {
      await scaffoldProject({
        packageJson: {
          name: 'my-app',
          dependencies: { '@rapidrest/core': '^5.1.0', typeorm: '^1.1.0' },
          devDependencies: { typescript: '^6.0.3' },
        },
      });

      const plan = await planUpgrade(ctx);

      expect(plan.dependencyChanges).toHaveLength(0);
    });

    it('does not include react patch dependencies when the project has no vite.config.ts', async () => {
      await scaffoldProject();

      const plan = await planUpgrade(ctx);

      expect(plan.dependencyChanges.find((d) => d.name === 'react-dep')).toBeUndefined();
    });

    it('includes react patch dependencies when the project has vite.config.ts', async () => {
      await scaffoldProject({ viteConfig: true });

      const plan = await planUpgrade(ctx);

      const change = plan.dependencyChanges.find((d) => d.name === 'react-dep');
      expect(change).toEqual({ section: 'dependencies', name: 'react-dep', from: undefined, to: '^1.0.0' });
    });

    it('does not throw when react is detected but the template has no react patch file', async () => {
      await rm(join(templatesDir, 'react', 'patches', 'package.json'));
      await scaffoldProject({ viteConfig: true });

      await expect(planUpgrade(ctx)).resolves.toBeDefined();
    });

    it('does not include helm patch dependencies when the project has no helm/Chart.yaml', async () => {
      await scaffoldProject();

      const plan = await planUpgrade(ctx);

      expect(plan.dependencyChanges.find((d) => d.name === 'helm-dep')).toBeUndefined();
    });

    it('does not throw when helm is detected but the template has no helm patch file', async () => {
      await rm(join(templatesDir, 'helm', 'patches', 'package.json'));
      await scaffoldProject({ helmChart: true });

      await expect(planUpgrade(ctx)).resolves.toBeDefined();
    });

    it('includes helm patch dependencies when the project has helm/Chart.yaml', async () => {
      await scaffoldProject({ helmChart: true });

      const plan = await planUpgrade(ctx);

      const change = plan.dependencyChanges.find((d) => d.name === 'helm-dep');
      expect(change).toEqual({ section: 'dependencies', name: 'helm-dep', from: undefined, to: '^1.0.0' });
    });

    it('never proposes removing a project-only extra dependency', async () => {
      await scaffoldProject({
        packageJson: {
          name: 'my-app',
          dependencies: { '@rapidrest/core': '^5.1.0', typeorm: '^1.1.0', lodash: '^4.0.0' },
          devDependencies: { typescript: '^6.0.3' },
        },
      });

      const plan = await planUpgrade(ctx);

      expect(plan.dependencyChanges.find((d) => d.name === 'lodash')).toBeUndefined();
      expect(plan.packageJsonWrite).toBeUndefined();
    });

    it('sets packageJsonWrite with the merged data and detected indent when there are changes', async () => {
      await scaffoldProject({
        packageJson: { name: 'my-app', dependencies: { '@rapidrest/core': '^4.0.0' }, devDependencies: {} },
      });

      const plan = await planUpgrade(ctx);

      expect(plan.packageJsonWrite).toBeDefined();
      expect(plan.packageJsonWrite!.indent).toBe('\t');
      const deps = plan.packageJsonWrite!.data.dependencies as Record<string, string>;
      expect(deps['@rapidrest/core']).toBe('^5.1.0');
    });

    it('leaves packageJsonWrite undefined when there are no dependency changes', async () => {
      await scaffoldProject({
        packageJson: {
          name: 'my-app',
          dependencies: { '@rapidrest/core': '^5.1.0', typeorm: '^1.1.0' },
          devDependencies: { typescript: '^6.0.3' },
        },
      });

      const plan = await planUpgrade(ctx);

      expect(plan.packageJsonWrite).toBeUndefined();
    });

    it('does not throw and reports no dependency changes when the project has no package.json', async () => {
      await scaffoldProject();
      await rm(join(cwd, 'package.json'));

      const plan = await planUpgrade(ctx);

      expect(plan.dependencyChanges).toHaveLength(0);
    });
  });

  describe('applyUpgrade', () => {
    it('writes each file change to its existing path', async () => {
      await scaffoldProject();
      const plan = await planUpgrade(ctx);

      await applyUpgrade(ctx, plan);

      expect(await readFile(join(cwd, 'eslint.config.mjs'), 'utf-8')).toBe('export default { rule: "new" };\n');
    });

    it('writes the merged package.json preserving the project\'s tab indentation', async () => {
      await scaffoldProject({
        packageJson: { name: 'my-app', dependencies: { '@rapidrest/core': '^4.0.0', lodash: '^4.0.0' }, devDependencies: {} },
      });
      const plan = await planUpgrade(ctx);

      await applyUpgrade(ctx, plan);

      const raw = await readFile(join(cwd, 'package.json'), 'utf-8');
      expect(raw).toContain('\t"');
      const pkg = JSON.parse(raw);
      expect(pkg.dependencies['@rapidrest/core']).toBe('^5.1.0');
      expect(pkg.dependencies.lodash).toBe('^4.0.0');
      expect(pkg.name).toBe('my-app');
    });

    it('does not write package.json at all when there are no dependency changes', async () => {
      await scaffoldProject({
        packageJson: {
          name: 'my-app',
          dependencies: { '@rapidrest/core': '^5.1.0', typeorm: '^1.1.0' },
          devDependencies: { typescript: '^6.0.3' },
        },
      });
      const before = await readFile(join(cwd, 'package.json'), 'utf-8');
      const plan = await planUpgrade(ctx);

      await applyUpgrade(ctx, plan);

      expect(await readFile(join(cwd, 'package.json'), 'utf-8')).toBe(before);
    });

    it('never creates a file that did not already exist (Dockerfile absent)', async () => {
      await scaffoldProject({ dockerfile: false });
      const plan = await planUpgrade(ctx);

      await applyUpgrade(ctx, plan);

      await expect(readFile(join(cwd, 'Dockerfile'), 'utf-8')).rejects.toThrow();
    });

    it('running the plan a second time reports no further changes (idempotent)', async () => {
      await scaffoldProject();
      const plan = await planUpgrade(ctx);
      await applyUpgrade(ctx, plan);

      const secondPlan = await planUpgrade(ctx);

      expect(secondPlan.fileChanges).toHaveLength(0);
      expect(secondPlan.dependencyChanges).toHaveLength(0);
    });
  });

  describe('resilience', () => {
    it('does not throw when a syncable template dir is entirely missing from templatesDir', async () => {
      await rm(join(templatesDir, 'helm'), { recursive: true, force: true });
      await scaffoldProject();

      await expect(planUpgrade(ctx)).resolves.toBeDefined();
    });

    it('reports no dependency changes when the server template dir (and so its package.json) is missing', async () => {
      await rm(join(templatesDir, 'server'), { recursive: true, force: true });
      await scaffoldProject();

      const plan = await planUpgrade(ctx);

      expect(plan.dependencyChanges).toHaveLength(0);
      expect(plan.packageJsonWrite).toBeUndefined();
    });
  });
});
