import { describe, it, expect, beforeEach, afterAll, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'fs/promises';
import { join } from 'path';
import os from 'os';
import { processTemplate } from '../../src/lib/template.js';

describe('processTemplate', () => {
  let templateDir: string;
  let outputDir: string;
  const cleanupDirs: string[] = [];

  async function tmpDir(): Promise<string> {
    const dir = await mkdtemp(join(os.tmpdir(), 'rr-tmpl-'));
    cleanupDirs.push(dir);
    return dir;
  }

  beforeEach(async () => {
    templateDir = await tmpDir();
    outputDir = await tmpDir();
  });

  afterAll(async () => {
    await Promise.all(cleanupDirs.map((d) => rm(d, { recursive: true, force: true })));
  });

  it('substitutes {{variable}} in file content', async () => {
    await writeFile(join(templateDir, 'hello.ts'), 'export const greeting = "Hello, {{name}}!";');
    await processTemplate(templateDir, outputDir, { name: 'World' });
    const out = await readFile(join(outputDir, 'hello.ts'), 'utf-8');
    expect(out).toBe('export const greeting = "Hello, World!";');
  });

  it('substitutes {{name}} placeholders in output file paths', async () => {
    await writeFile(join(templateDir, '{{name}}.ts'), 'class {{name}} {}');
    await processTemplate(templateDir, outputDir, { name: 'Product' });
    const out = await readFile(join(outputDir, 'Product.ts'), 'utf-8');
    expect(out).toBe('class Product {}');
    // original template filename should not appear in output
    await expect(readFile(join(outputDir, '{{name}}.ts'), 'utf-8')).rejects.toThrow();
  });

  it('evaluates {{#if}} Handlebars conditionals in content', async () => {
    const src = [
      '{{#if features.mongodb}}const mongo = true;{{/if}}',
      '{{#if features.redis}}const redis = true;{{/if}}',
    ].join('\n');
    await writeFile(join(templateDir, 'config.ts'), src);
    await processTemplate(templateDir, outputDir, { features: { mongodb: true, redis: false } });
    const out = await readFile(join(outputDir, 'config.ts'), 'utf-8');
    expect(out).toContain('const mongo = true;');
    expect(out).not.toContain('const redis = true;');
  });

  it('copies binary files (.cjs, .gz) byte-for-byte without Handlebars processing', async () => {
    // A buffer whose byte 0x7B is '{' — if Handlebars ran it would parse "{{name}}"
    const binary = Buffer.from([0x7b, 0x7b, 0x6e, 0x61, 0x6d, 0x65, 0x7d, 0x7d]); // "{{name}}"
    await writeFile(join(templateDir, 'bundle.cjs'), binary);
    await processTemplate(templateDir, outputDir, { name: 'REPLACED' });
    const result = await readFile(join(outputDir, 'bundle.cjs'));
    expect(Buffer.compare(result, binary)).toBe(0);
  });

  it('excludes a file when its manifest condition is false', async () => {
    await writeFile(join(templateDir, 'Dockerfile'), 'FROM node:lts');
    await writeFile(join(templateDir, 'server.ts'), 'export {};');
    await writeFile(
      join(templateDir, 'template.config.json'),
      JSON.stringify({ conditionalFiles: [{ file: 'Dockerfile', condition: 'features.docker' }] }),
    );
    await processTemplate(templateDir, outputDir, { features: { docker: false } });
    await expect(readFile(join(outputDir, 'Dockerfile'), 'utf-8')).rejects.toThrow();
    // Non-conditional file should still be present
    await expect(readFile(join(outputDir, 'server.ts'), 'utf-8')).resolves.toBe('export {};');
  });

  it('includes a file when its manifest condition is true', async () => {
    await writeFile(join(templateDir, 'Dockerfile'), 'FROM node:lts');
    await writeFile(
      join(templateDir, 'template.config.json'),
      JSON.stringify({ conditionalFiles: [{ file: 'Dockerfile', condition: 'features.docker' }] }),
    );
    await processTemplate(templateDir, outputDir, { features: { docker: true } });
    const out = await readFile(join(outputDir, 'Dockerfile'), 'utf-8');
    expect(out).toBe('FROM node:lts');
  });

  it('excludes a directory subtree when its manifest condition is false', async () => {
    await mkdir(join(templateDir, '.github', 'workflows'), { recursive: true });
    await writeFile(join(templateDir, '.github', 'workflows', 'ci.yml'), 'name: CI');
    await writeFile(
      join(templateDir, 'template.config.json'),
      JSON.stringify({ conditionalFiles: [{ file: '.github', condition: 'scm.github' }] }),
    );
    await processTemplate(templateDir, outputDir, { scm: { github: false } });
    await expect(readFile(join(outputDir, '.github', 'workflows', 'ci.yml'), 'utf-8')).rejects.toThrow();
  });

  it('preserves ${{ }} GitHub Actions syntax unchanged', async () => {
    const ciYaml = "key: ${{ runner.os }}-yarn-${{ hashFiles('yarn.lock') }}\n";
    await writeFile(join(templateDir, 'ci.yml'), ciYaml);
    await processTemplate(templateDir, outputDir, {});
    const out = await readFile(join(outputDir, 'ci.yml'), 'utf-8');
    expect(out).toBe(ciYaml);
  });

  it('throws when an output file already exists and force is not set', async () => {
    await writeFile(join(templateDir, 'file.ts'), 'new');
    await writeFile(join(outputDir, 'file.ts'), 'old');
    await expect(processTemplate(templateDir, outputDir, {})).rejects.toThrow('File already exists');
  });

  it('overwrites an existing output file when force is true', async () => {
    await writeFile(join(templateDir, 'file.ts'), 'new content');
    await writeFile(join(outputDir, 'file.ts'), 'old content');
    await processTemplate(templateDir, outputDir, {}, { force: true });
    const out = await readFile(join(outputDir, 'file.ts'), 'utf-8');
    expect(out).toBe('new content');
  });

  it('creates nested output directories for files in subdirectories', async () => {
    await mkdir(join(templateDir, 'src', 'models'), { recursive: true });
    await writeFile(join(templateDir, 'src', 'models', '{{name}}.ts'), 'class {{name}} {}');
    await processTemplate(templateDir, outputDir, { name: 'User' });
    const out = await readFile(join(outputDir, 'src', 'models', 'User.ts'), 'utf-8');
    expect(out).toBe('class User {}');
  });

  describe('patches', () => {
    let projectDir: string;

    beforeEach(async () => {
      projectDir = await tmpDir();
    });

    afterEach(async () => {
      // cleanup handled by afterAll via cleanupDirs
    });

    it('does not copy patch template files into the output directory', async () => {
      await mkdir(join(templateDir, 'patches'), { recursive: true });
      await writeFile(join(templateDir, '{{name}}.ts'), 'class {{name}} {}');
      await writeFile(join(templateDir, 'patches', 'config.ts.hbs'), 'should not be copied');
      await writeFile(
        join(templateDir, 'template.config.json'),
        JSON.stringify({
          patches: [{
            template: 'patches/config.ts.hbs',
            target: 'src/config.ts',
            strategy: 'ts-block-insert',
            insertInto: 'datastores',
            condition: 'never',  // condition is falsy — skips the patch itself
          }],
        }),
      );

      await processTemplate(templateDir, outputDir, { name: 'Widget', never: false }, { projectDir });

      // The patch template should NOT appear in the output directory
      await expect(readFile(join(outputDir, 'patches', 'config.ts.hbs'), 'utf-8')).rejects.toThrow();
      // Normal template file should still be written
      const out = await readFile(join(outputDir, 'Widget.ts'), 'utf-8');
      expect(out).toBe('class Widget {}');
    });

    it('applies a json-merge patch to the project directory after file generation', async () => {
      await mkdir(join(projectDir, 'src'), { recursive: true });
      const existingPkg = { name: 'my-app', dependencies: { lodash: '^4.0.0' }, devDependencies: {} };
      await writeFile(join(projectDir, 'package.json'), JSON.stringify(existingPkg));

      await mkdir(join(templateDir, 'patches'), { recursive: true });
      await writeFile(join(templateDir, '{{name}}.ts'), 'class {{name}} {}');
      await writeFile(
        join(templateDir, 'patches', 'package-mongo.json'),
        JSON.stringify({ dependencies: { mongodb: '^7.3.0' }, devDependencies: { 'mongodb-memory-server': '^11.2.0' } }),
      );
      await writeFile(
        join(templateDir, 'template.config.json'),
        JSON.stringify({
          patches: [{
            template: 'patches/package-mongo.json',
            target: 'package.json',
            strategy: 'json-merge',
            condition: 'isMongoDb',
          }],
        }),
      );

      await processTemplate(
        templateDir, outputDir,
        { name: 'Widget', isMongoDb: true },
        { projectDir },
      );

      const pkg = JSON.parse(await readFile(join(projectDir, 'package.json'), 'utf-8')) as Record<string, unknown>;
      expect((pkg.dependencies as Record<string, unknown>)['mongodb']).toBe('^7.3.0');
      expect((pkg.dependencies as Record<string, unknown>)['lodash']).toBe('^4.0.0');
    });

    it('skips a patch when its condition is falsy in the context', async () => {
      const existingPkg = { name: 'my-app', dependencies: {} };
      await writeFile(join(projectDir, 'package.json'), JSON.stringify(existingPkg));

      await mkdir(join(templateDir, 'patches'), { recursive: true });
      await writeFile(join(templateDir, '{{name}}.ts'), 'class {{name}} {}');
      await writeFile(
        join(templateDir, 'patches', 'package-mongo.json'),
        JSON.stringify({ dependencies: { mongodb: '^7.3.0' } }),
      );
      await writeFile(
        join(templateDir, 'template.config.json'),
        JSON.stringify({
          patches: [{
            template: 'patches/package-mongo.json',
            target: 'package.json',
            strategy: 'json-merge',
            condition: 'isMongoDb',
          }],
        }),
      );

      // isMongoDb is false — patch should be skipped
      await processTemplate(
        templateDir, outputDir,
        { name: 'Widget', isMongoDb: false },
        { projectDir },
      );

      const pkg = JSON.parse(await readFile(join(projectDir, 'package.json'), 'utf-8')) as Record<string, unknown>;
      expect((pkg.dependencies as Record<string, unknown>)['mongodb']).toBeUndefined();
    });

    it('applies a ts-block-insert patch to src/config.ts in the project directory', async () => {
      await mkdir(join(projectDir, 'src'), { recursive: true });
      const configSrc = `export default conf.defaults({\n  datastores: {\n    mongo: { type: "mongodb" },\n  },\n});\n`;
      await writeFile(join(projectDir, 'src', 'config.ts'), configSrc);

      await mkdir(join(templateDir, 'patches'), { recursive: true });
      await writeFile(join(templateDir, '{{name}}.ts'), 'class {{name}} {}');
      await writeFile(
        join(templateDir, 'patches', 'config.hbs'),
        '    {{datastore}}: { type: "postgresql" },\n',
      );
      await writeFile(
        join(templateDir, 'template.config.json'),
        JSON.stringify({
          patches: [{
            template: 'patches/config.hbs',
            target: 'src/config.ts',
            strategy: 'ts-block-insert',
            insertInto: 'datastores',
            idempotencyKey: '{{datastore}}',
            condition: 'datastore',
          }],
        }),
      );

      await processTemplate(
        templateDir, outputDir,
        { name: 'Widget', datastore: 'postgres' },
        { projectDir },
      );

      const result = await readFile(join(projectDir, 'src', 'config.ts'), 'utf-8');
      expect(result).toContain('postgres: { type: "postgresql" }');
      expect(result).toContain('mongo: { type: "mongodb" }');
    });
  });

  describe('Helm-safe mode (helmPaths)', () => {
    async function writeConfig(helmPaths: string[]): Promise<void> {
      await writeFile(
        join(templateDir, 'template.config.json'),
        JSON.stringify({ helmPaths }),
      );
    }

    it('substitutes [[ varname ]] in Helm files', async () => {
      await mkdir(join(templateDir, 'helm'), { recursive: true });
      await writeFile(join(templateDir, 'helm', 'Chart.yaml'), 'name: [[name]]\ndesc: [[description]]');
      await writeConfig(['helm']);
      await processTemplate(templateDir, outputDir, { name: 'myapp', description: 'My App' });
      const out = await readFile(join(outputDir, 'helm', 'Chart.yaml'), 'utf-8');
      expect(out).toBe('name: myapp\ndesc: My App');
    });

    it('resolves [[#if condition]]...[[/if]] blocks in Helm files', async () => {
      await mkdir(join(templateDir, 'helm'), { recursive: true });
      const src = '[[#if features.mongodb]]\nmongodb: true\n[[/if]]\n[[#if features.redis]]\nredis: true\n[[/if]]';
      await writeFile(join(templateDir, 'helm', 'values.yaml'), src);
      await writeConfig(['helm']);
      await processTemplate(templateDir, outputDir, { features: { mongodb: true, redis: false } });
      const out = await readFile(join(outputDir, 'helm', 'values.yaml'), 'utf-8');
      expect(out).toContain('mongodb: true');
      expect(out).not.toContain('redis: true');
    });

    it('preserves Helm {{ }} Go-template expressions in helmPaths files', async () => {
      await mkdir(join(templateDir, 'helm', 'templates'), { recursive: true });
      const src = 'namespace: {{ .Release.Namespace }}\nenv: {{ $.Values.environment }}';
      await writeFile(join(templateDir, 'helm', 'templates', 'deploy.yaml'), src);
      await writeConfig(['helm']);
      await processTemplate(templateDir, outputDir, { name: 'myapp' });
      const out = await readFile(join(outputDir, 'helm', 'templates', 'deploy.yaml'), 'utf-8');
      expect(out).toBe(src);
    });

    it('handles nested [[#if]] blocks in Helm files', async () => {
      await mkdir(join(templateDir, 'helm'), { recursive: true });
      const src = '[[#if features.k8s]]\nk8s: true\n[[#if features.mongodb]]\nmongo: true\n[[/if]]\n[[/if]]';
      await writeFile(join(templateDir, 'helm', 'values.yaml'), src);
      await writeConfig(['helm']);
      await processTemplate(templateDir, outputDir, { features: { k8s: true, mongodb: false } });
      const out = await readFile(join(outputDir, 'helm', 'values.yaml'), 'utf-8');
      expect(out).toContain('k8s: true');
      expect(out).not.toContain('mongo: true');
    });

    it('substitutes [[ dotted.path ]] from nested context in Helm files', async () => {
      await mkdir(join(templateDir, 'helm'), { recursive: true });
      await writeFile(join(templateDir, 'helm', 'values.yaml'), 'repo: [[service.image.repository]]');
      await writeConfig(['helm']);
      await processTemplate(templateDir, outputDir, { service: { image: { repository: 'myorg/myapp' } } });
      const out = await readFile(join(outputDir, 'helm', 'values.yaml'), 'utf-8');
      expect(out).toBe('repo: myorg/myapp');
    });

    it('files outside helmPaths still use Handlebars {{ }} normally', async () => {
      await mkdir(join(templateDir, 'helm'), { recursive: true });
      await writeFile(join(templateDir, 'helm', 'Chart.yaml'), 'name: [[name]]');
      await writeFile(join(templateDir, 'README.md'), 'Project: {{name}}');
      await writeConfig(['helm']);
      await processTemplate(templateDir, outputDir, { name: 'myapp' });
      const helmOut = await readFile(join(outputDir, 'helm', 'Chart.yaml'), 'utf-8');
      const readmeOut = await readFile(join(outputDir, 'README.md'), 'utf-8');
      expect(helmOut).toBe('name: myapp');
      expect(readmeOut).toBe('Project: myapp');
    });
  });
});
