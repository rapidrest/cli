///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, chmod } from 'fs/promises';
import { createRequire } from 'module';
import { join, dirname } from 'path';
import os from 'os';
import { detectDatabases, startDatabases } from '../../src/lib/db.js';

// detectDatabases now actually imports src/config.ts (via tsx) instead of text-scanning it, so it
// can follow re-exports like `export { default } from './config.base.js'`. That requires a real
// `node_modules/.bin/tsx` under the fixture project — resolved here from this repo's own installed
// tsx rather than duplicating node_modules/tsx into every temp dir.
const tsxCliPath = createRequire(import.meta.url).resolve('tsx/cli');

async function installTsxShim(tmpDir: string): Promise<void> {
  const binDir = join(tmpDir, 'node_modules', '.bin');
  await mkdir(binDir, { recursive: true });
  if (process.platform === 'win32') {
    await writeFile(join(binDir, 'tsx.cmd'), `@echo off\r\nnode "${tsxCliPath}" %*\r\n`);
  } else {
    const shimPath = join(binDir, 'tsx');
    await writeFile(shimPath, `#!/bin/sh\nexec node "${tsxCliPath}" "$@"\n`);
    await chmod(shimPath, 0o755);
  }
}

describe('detectDatabases', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(os.tmpdir(), 'rrdb-'));
    await mkdir(join(tmpDir, 'src'), { recursive: true });
    await installTsxShim(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function writeConfig(datastores: string, relPath = join('src', 'config.ts')): Promise<void> {
    const dir = join(tmpDir, dirname(relPath));
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(tmpDir, relPath),
      `const store = { datastores: ${datastores} };\n`
      + `export default { get: (key) => store[key] };\n`,
    );
  }

  it('detects mongodb from type: "mongodb" in datastores', async () => {
    await writeConfig(`{ acl: { type: "mongodb", host: "localhost" } }`);
    const result = await detectDatabases(tmpDir);
    expect(result.mongodb).toBe(true);
    expect(result.redis).toBe(false);
    expect(result.postgresql).toBe(false);
  }, 15_000);

  it('detects redis from type: "redis" in datastores', async () => {
    await writeConfig(`{ cache: { type: "redis", url: "redis://localhost" } }`);
    const result = await detectDatabases(tmpDir);
    expect(result.redis).toBe(true);
    expect(result.mongodb).toBe(false);
  }, 15_000);

  it('detects postgresql from type: "postgres" in datastores (TypeORM\'s driver literal, not the feature name)', async () => {
    await writeConfig(`{ pg: { type: "postgres", host: "localhost" } }`);
    const result = await detectDatabases(tmpDir);
    expect(result.postgresql).toBe(true);
    expect(result.mongodb).toBe(false);
  }, 15_000);

  it('detects multiple database types from a single config', async () => {
    await writeConfig(`{
      acl: { type: "mongodb", host: "localhost" },
      cache: { type: "redis", url: "redis://localhost" },
      pg: { type: "postgres", host: "localhost" },
    }`);
    const result = await detectDatabases(tmpDir);
    expect(result).toEqual({ mongodb: true, redis: true, postgresql: true });
  }, 15_000);

  it('returns all false when config has no datastore types', async () => {
    await writeConfig(`{}`);
    const result = await detectDatabases(tmpDir);
    expect(result).toEqual({ mongodb: false, redis: false, postgresql: false });
  }, 15_000);

  it('returns all false when src/config.ts does not exist', async () => {
    const result = await detectDatabases(tmpDir);
    expect(result).toEqual({ mongodb: false, redis: false, postgresql: false });
  });

  it('follows a config.ts that only re-exports another module (split config)', async () => {
    await writeConfig(`{ pg: { type: "postgres", host: "localhost" } }`, join('src', 'config.base.ts'));
    await writeFile(join(tmpDir, 'src', 'config.ts'), `export { default } from './config.base.js';\n`);
    const result = await detectDatabases(tmpDir);
    expect(result).toEqual({ mongodb: false, redis: false, postgresql: true });
  }, 15_000);
});

describe('startDatabases', () => {
  const cwd = '/fake/project';
  let logs: string[];
  let warnings: string[];

  beforeEach(() => {
    logs = [];
    warnings = [];
    vi.clearAllMocks();
  });

  const log = (m: string) => { logs.push(m); };
  const warn = (m: string) => { warnings.push(m); };

  it('starts mongodb-memory-server and sets DATASTORES env vars', async () => {
    const result = await startDatabases(cwd, { mongodb: true, redis: false, postgresql: false }, log, warn);
    expect(result.databases).toHaveLength(1);
    expect(result.env['datastores__acl__url']).toBe(result.databases[0].uri);
    expect(result.env['datastores__mongo__url']).toBe(result.databases[0].uri);
    expect(logs.some((m) => m.includes('MongoDB is ready'))).toBe(true);
    for (const db of result.databases) {
      await db.server.stop();
    }
  }, 30_000);

  it('sets no env vars and spawns no processes when no databases configured', async () => {
    const result = await startDatabases(cwd, { mongodb: false, redis: false, postgresql: false }, log, warn);
    expect(result.env).toEqual({});
    expect(result.databases).toHaveLength(0);
  });

  it('starts redis-memory-server and sets DATASTORES env vars', async () => {
    const result = await startDatabases(cwd, { mongodb: false, redis: true, postgresql: false }, log, warn);
    expect(result.databases).toHaveLength(1);
    expect(result.env['datastores__cache__url']).toBe(result.databases[0].uri);
    expect(result.env['datastores__events__url']).toBe(result.databases[0].uri);
    expect(result.env['datastores__logs__url']).toBe(result.databases[0].uri);
    expect(logs.some((m) => m.includes('Redis is ready'))).toBe(true);
    for (const db of result.databases) {
      await db.server.stop();
    }
  }, 30_000);

  it('starts postgres-memory-server and sets DATASTORES env vars', async () => {
    const result = await startDatabases(cwd, { mongodb: false, redis: false, postgresql: true }, log, warn);
    expect(result.databases).toHaveLength(1);
    expect(result.env['datastores__postgres__url']).toBe(result.databases[0].uri);
    expect(logs.some((m) => m.includes('Postgres is ready'))).toBe(true);
    for (const db of result.databases) {
      await db.server.stop();
    }
  }, 30_000);
});
