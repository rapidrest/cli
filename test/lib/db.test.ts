import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import os from 'os';
import { detectDatabases, startDatabases } from '../../src/lib/db.js';

describe('detectDatabases', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(os.tmpdir(), 'rrdb-'));
    await mkdir(join(tmpDir, 'src'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function writeConfig(content: string): Promise<void> {
    await writeFile(join(tmpDir, 'src', 'config.ts'), content);
  }

  it('detects mongodb from type: "mongodb" in datastores', async () => {
    await writeConfig(`conf.defaults({ datastores: { acl: { type: "mongodb", host: "localhost" } } });`);
    const result = await detectDatabases(tmpDir);
    expect(result.mongodb).toBe(true);
    expect(result.redis).toBe(false);
    expect(result.postgresql).toBe(false);
  });

  it('detects redis from type: "redis" in datastores', async () => {
    await writeConfig(`conf.defaults({ datastores: { cache: { type: "redis", url: "redis://localhost" } } });`);
    const result = await detectDatabases(tmpDir);
    expect(result.redis).toBe(true);
    expect(result.mongodb).toBe(false);
  });

  it('detects postgresql from type: "postgresql" in datastores', async () => {
    await writeConfig(`conf.defaults({ datastores: { pg: { type: "postgresql", host: "localhost" } } });`);
    const result = await detectDatabases(tmpDir);
    expect(result.postgresql).toBe(true);
    expect(result.mongodb).toBe(false);
  });

  it('detects multiple database types from a single config', async () => {
    await writeConfig(`conf.defaults({ datastores: {
      acl: { type: "mongodb", host: "localhost" },
      cache: { type: "redis", url: "redis://localhost" },
      pg: { type: "postgresql", host: "localhost" },
    } });`);
    const result = await detectDatabases(tmpDir);
    expect(result).toEqual({ mongodb: true, redis: true, postgresql: true });
  });

  it('handles single-quoted type values', async () => {
    await writeConfig(`conf.defaults({ datastores: { acl: { type: 'mongodb', host: 'localhost' } } });`);
    const result = await detectDatabases(tmpDir);
    expect(result.mongodb).toBe(true);
  });

  it('returns all false when config has no datastore type strings', async () => {
    await writeConfig(`conf.defaults({ service_name: "my-app", logger: { level: "info" } });`);
    const result = await detectDatabases(tmpDir);
    expect(result).toEqual({ mongodb: false, redis: false, postgresql: false });
  });

  it('returns all false when src/config.ts does not exist', async () => {
    const result = await detectDatabases(tmpDir);
    expect(result).toEqual({ mongodb: false, redis: false, postgresql: false });
  });
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
