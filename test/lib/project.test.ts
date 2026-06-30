import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import os from 'os';
import { detectReact, readProjectAuthor } from '../../src/lib/project.js';

describe('detectReact', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(os.tmpdir(), 'rrreact-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns true when vite.config.ts exists', async () => {
    await writeFile(join(tmpDir, 'vite.config.ts'), '');
    expect(await detectReact(tmpDir)).toBe(true);
  });

  it('returns false when vite.config.ts does not exist', async () => {
    expect(await detectReact(tmpDir)).toBe(false);
  });

  it('returns false for a non-existent directory', async () => {
    expect(await detectReact(join(tmpDir, 'nonexistent'))).toBe(false);
  });
});

describe('readProjectAuthor', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(os.tmpdir(), 'rrproj-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns a string author field', async () => {
    await writeFile(join(tmpDir, 'package.json'), JSON.stringify({ author: 'Jane Doe' }));
    expect(await readProjectAuthor(tmpDir)).toBe('Jane Doe');
  });

  it('returns the name from an object author field', async () => {
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({ author: { name: 'Jane Doe', email: 'jane@example.com' } }),
    );
    expect(await readProjectAuthor(tmpDir)).toBe('Jane Doe');
  });

  it('returns undefined when author is an empty string', async () => {
    await writeFile(join(tmpDir, 'package.json'), JSON.stringify({ author: '' }));
    expect(await readProjectAuthor(tmpDir)).toBeUndefined();
  });

  it('returns undefined when author field is absent', async () => {
    await writeFile(join(tmpDir, 'package.json'), JSON.stringify({ name: 'my-app' }));
    expect(await readProjectAuthor(tmpDir)).toBeUndefined();
  });

  it('returns undefined when package.json does not exist', async () => {
    expect(await readProjectAuthor(join(tmpDir, 'nonexistent'))).toBeUndefined();
  });

  it('returns undefined when package.json is invalid JSON', async () => {
    await writeFile(join(tmpDir, 'package.json'), 'not json');
    expect(await readProjectAuthor(tmpDir)).toBeUndefined();
  });
});
