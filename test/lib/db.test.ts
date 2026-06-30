import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import os from 'os';
import { EventEmitter } from 'events';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('child_process', () => {
  return { spawn: vi.fn() };
});

vi.mock('net', () => {
  return { default: { createConnection: vi.fn() } };
});

// Import AFTER mocks are declared so vitest hoisting picks them up
import { spawn } from 'child_process';
import net from 'net';
import { detectDatabases, startDatabases } from '../../src/lib/db.js';

const mockSpawn = vi.mocked(spawn);
const mockCreateConnection = vi.mocked(net.createConnection);

// ── Helpers ────────────────────────────────────────────────────────────────

function makeFakeSocket(opts: { connect?: boolean; timeout?: boolean } = {}): EventEmitter {
  const sock = new EventEmitter() as EventEmitter & { destroy: () => void; setTimeout: (ms: number) => void };
  sock.destroy = vi.fn();
  sock.setTimeout = vi.fn();
  if (opts.connect) {
    setImmediate(() => sock.emit('connect'));
  } else if (opts.timeout) {
    setImmediate(() => { sock.emit('timeout'); sock.destroy(); });
  } else {
    setImmediate(() => sock.emit('error', new Error('ECONNREFUSED')));
  }
  return sock;
}

function makeFakeMongoChild(port: string): EventEmitter {
  const stdin = new EventEmitter() as EventEmitter & { write: (d: string) => void; end: () => void };
  stdin.write = vi.fn();
  stdin.end = vi.fn();

  const stdout = new EventEmitter();
  const child = new EventEmitter() as EventEmitter & {
    stdin: typeof stdin;
    stdout: typeof stdout;
    kill: () => void;
  };
  child.stdin = stdin;
  child.stdout = stdout;
  child.kill = vi.fn();

  // Emit the port line after the script is "run"
  setImmediate(() => stdout.emit('data', Buffer.from(JSON.stringify({ port }) + '\n')));
  return child;
}

// ── detectDatabases ────────────────────────────────────────────────────────

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

// ── startDatabases ─────────────────────────────────────────────────────────

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
    const child = makeFakeMongoChild('54321');
    mockSpawn.mockReturnValue(child as ReturnType<typeof spawn>);

    const result = await startDatabases(cwd, { mongodb: true, redis: false, postgresql: false }, log, warn);

    expect(result.env['DATASTORES__ACL__HOST']).toBe('localhost');
    expect(result.env['DATASTORES__ACL__PORT']).toBe('54321');
    expect(result.env['DATASTORES__MONGO__HOST']).toBe('localhost');
    expect(result.env['DATASTORES__MONGO__PORT']).toBe('54321');
    expect(result.processes).toHaveLength(1);
    expect(logs.some((m) => m.includes('MongoDB ready on port 54321'))).toBe(true);
  });

  it('sets no env vars and spawns no processes when no databases configured', async () => {
    const result = await startDatabases(cwd, { mongodb: false, redis: false, postgresql: false }, log, warn);
    expect(result.env).toEqual({});
    expect(result.processes).toHaveLength(0);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('logs success when Redis is already listening on 6379', async () => {
    mockCreateConnection.mockReturnValue(makeFakeSocket({ connect: true }) as ReturnType<typeof net.createConnection>);

    await startDatabases(cwd, { mongodb: false, redis: true, postgresql: false }, log, warn);

    expect(logs.some((m) => m.includes('Redis detected'))).toBe(true);
    expect(warnings).toHaveLength(0);
  });

  it('warns when Redis is not listening on 6379', async () => {
    mockCreateConnection.mockReturnValue(makeFakeSocket() as ReturnType<typeof net.createConnection>);

    await startDatabases(cwd, { mongodb: false, redis: true, postgresql: false }, log, warn);

    expect(warnings.some((m) => m.includes('Redis not found'))).toBe(true);
  });

  it('logs success when PostgreSQL is already listening on 5432', async () => {
    mockCreateConnection.mockReturnValue(makeFakeSocket({ connect: true }) as ReturnType<typeof net.createConnection>);

    await startDatabases(cwd, { mongodb: false, redis: false, postgresql: true }, log, warn);

    expect(logs.some((m) => m.includes('PostgreSQL detected'))).toBe(true);
    expect(warnings).toHaveLength(0);
  });

  it('warns when PostgreSQL is not listening on 5432', async () => {
    mockCreateConnection.mockReturnValue(makeFakeSocket() as ReturnType<typeof net.createConnection>);

    await startDatabases(cwd, { mongodb: false, redis: false, postgresql: true }, log, warn);

    expect(warnings.some((m) => m.includes('PostgreSQL not found'))).toBe(true);
  });

  it('throws when mongodb-memory-server child exits with non-zero code', async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: { write: () => void; end: () => void };
      stdout: EventEmitter;
      kill: () => void;
    };
    child.stdin = { write: vi.fn(), end: vi.fn() };
    child.stdout = new EventEmitter();
    child.kill = vi.fn();
    setImmediate(() => child.emit('exit', 1));
    mockSpawn.mockReturnValue(child as ReturnType<typeof spawn>);

    await expect(
      startDatabases(cwd, { mongodb: true, redis: false, postgresql: false }, log, warn),
    ).rejects.toThrow('Failed to start MongoDB');
  });
});
