///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile, readdir } from 'fs/promises';
import { spawnSync } from 'child_process';
import { join, relative } from 'path';
import os from 'os';
import { toOutputPath, toTemplatePath } from '../../src/lib/template-names.js';
import { processTemplate, renderTemplateFiles } from '../../src/lib/template.js';

const REPO_ROOT = join(import.meta.dirname, '..', '..');
const cleanup: string[] = [];
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(os.tmpdir(), 'rr-names-'));
  cleanup.push(d);
  return d;
}
afterAll(async () => {
  await Promise.all(cleanup.map((d) => rm(d, { recursive: true, force: true })));
});

describe('template-names mapping', () => {
  it('maps _-prefixed npm-special names to dotted names, in any directory', () => {
    expect(toOutputPath('_gitignore')).toBe('.gitignore');
    expect(toOutputPath('_npmignore')).toBe('.npmignore');
    expect(toOutputPath('_npmrc')).toBe('.npmrc');
    expect(toOutputPath(['sub', 'dir', '_gitignore'].join('\\'))).toBe('sub/dir/.gitignore');
  });

  it('leaves other names alone', () => {
    expect(toOutputPath('src/_gitignore.ts')).toBe('src/_gitignore.ts');
    expect(toOutputPath('_other')).toBe('_other');
    expect(toOutputPath('.dockerignore')).toBe('.dockerignore');
  });

  it('is invertible via toTemplatePath', () => {
    for (const p of ['_gitignore', 'a/_npmignore', 'a/b/_npmrc']) {
      expect(toTemplatePath(toOutputPath(p))).toBe(p);
    }
    expect(toTemplatePath('.gitignore')).toBe('_gitignore');
    expect(toTemplatePath('src/index.ts')).toBe('src/index.ts');
  });
});

describe('processTemplate / renderTemplateFiles rename', () => {
  it('writes _gitignore/_npmignore/_npmrc as dotted files, including nested', async () => {
    const t = await tmp();
    const o = await tmp();
    await mkdir(join(t, 'nested'));
    await writeFile(join(t, '_gitignore'), 'node_modules\n{{name}}\n');
    await writeFile(join(t, '_npmignore'), 'src\n');
    await writeFile(join(t, 'nested', '_npmrc'), 'registry=x\n');
    await processTemplate(t, o, { name: 'proj' });
    expect(await readFile(join(o, '.gitignore'), 'utf-8')).toBe('node_modules\nproj\n');
    expect(await readFile(join(o, '.npmignore'), 'utf-8')).toBe('src\n');
    expect(await readFile(join(o, 'nested', '.npmrc'), 'utf-8')).toBe('registry=x\n');
    expect((await readdir(o)).sort()).toEqual(['.gitignore', '.npmignore', 'nested']);
  });

  it('applies conditionalFiles written with the dotted name to the _ file', async () => {
    const t = await tmp();
    const o = await tmp();
    await writeFile(join(t, '_gitignore'), 'x');
    await writeFile(
      join(t, 'template.config.json'),
      JSON.stringify({ conditionalFiles: [{ file: '.gitignore', condition: 'scm.git' }] }),
    );
    await processTemplate(t, o, { scm: { git: false } });
    expect(await readdir(o)).toEqual([]);
    const rendered = await renderTemplateFiles(t, { scm: { git: true } });
    expect(rendered.map((r) => r.relPath)).toEqual(['.gitignore']);
  });

  it('renderTemplateFiles (used by upgrade) reports dotted relPaths', async () => {
    const t = await tmp();
    await writeFile(join(t, '_gitignore'), 'dist\n');
    await writeFile(join(t, '_npmignore'), 'src\n');
    const rendered = await renderTemplateFiles(t, {});
    expect(rendered.map((r) => r.relPath).sort()).toEqual(['.gitignore', '.npmignore']);
  });

  it('shipped templates/server renders .gitignore and .npmignore', async () => {
    const rendered = await renderTemplateFiles(join(REPO_ROOT, 'templates', 'server'), {
      scm: { git: true, github: true, gitlab: true },
      pkgMgr: { npm: true, yarn: true },
    });
    const paths = rendered.map((r) => r.relPath);
    expect(paths).toContain('.gitignore');
    expect(paths).toContain('.npmignore');
    expect(paths.some((p) => p.split('/').pop()!.startsWith('_'))).toBe(false);
  });
});

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.name === 'node_modules') continue;
    if (e.isDirectory()) out.push(...(await listFiles(full)));
    else out.push(full);
  }
  return out;
}

describe('npm package contents', () => {
  it('publishes every file under templates/ (npm ignore rules must not strip any)', async () => {
    // --ignore-scripts: skip prepack (build + oclif manifest/readme), we only need the file list.
    const res = spawnSync('npm pack --dry-run --json --ignore-scripts', {
      cwd: REPO_ROOT,
      shell: true,
      encoding: 'utf-8',
      maxBuffer: 64 * 1024 * 1024,
    });
    expect(res.status, res.stderr).toBe(0);
    const packed = new Set<string>(
      (JSON.parse(res.stdout)[0].files as { path: string }[]).map((f) => f.path),
    );
    const onDisk = (await listFiles(join(REPO_ROOT, 'templates'))).map((f) =>
      relative(REPO_ROOT, f).replaceAll('\\', '/'),
    );
    expect(onDisk.length).toBeGreaterThan(0);
    const missing = onDisk.filter((f) => !packed.has(f));
    expect(missing).toEqual([]);
  }, 120_000);
});
