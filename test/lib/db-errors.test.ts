import { describe, it, expect, vi } from 'vitest';

vi.mock('mongodb-memory-server', () => ({
  MongoMemoryServer: { create: vi.fn() },
}));

vi.mock('postgres-memory-server', () => ({
  PostgresMemoryServer: { create: vi.fn() },
}));

vi.mock('redis-memory-server', () => ({
  RedisMemoryServer: vi.fn(),
}));

import { MongoMemoryServer } from 'mongodb-memory-server';
import { PostgresMemoryServer } from 'postgres-memory-server';
import { RedisMemoryServer } from 'redis-memory-server';
import { startDatabases } from '../../src/lib/db.js';

const cwd = '/fake/project';
const noop = vi.fn();

describe('startDatabases error handling', () => {
  it('wraps a MongoDB startup failure (Error) with a descriptive message', async () => {
    vi.mocked(MongoMemoryServer.create).mockRejectedValue(new Error('mongo-boom'));

    await expect(
      startDatabases(cwd, { mongodb: true, redis: false, postgresql: false }, noop, noop),
    ).rejects.toThrow('Failed to start MongoDB: mongo-boom');
  });

  it('wraps a MongoDB startup failure (non-Error) with a descriptive message', async () => {
    vi.mocked(MongoMemoryServer.create).mockRejectedValue('mongo-non-error');

    await expect(
      startDatabases(cwd, { mongodb: true, redis: false, postgresql: false }, noop, noop),
    ).rejects.toThrow('Failed to start MongoDB: mongo-non-error');
  });

  it('wraps a Redis startup failure (Error) with a descriptive message', async () => {
    vi.mocked(RedisMemoryServer).mockImplementation(function (this: any) {
      this.getHost = vi.fn().mockRejectedValue(new Error('redis-boom'));
      this.getPort = vi.fn();
    });

    await expect(
      startDatabases(cwd, { mongodb: false, redis: true, postgresql: false }, noop, noop),
    ).rejects.toThrow('Failed to start Redis: redis-boom');
  });

  it('wraps a Redis startup failure (non-Error) with a descriptive message', async () => {
    vi.mocked(RedisMemoryServer).mockImplementation(function (this: any) {
      this.getHost = vi.fn().mockRejectedValue('redis-non-error');
      this.getPort = vi.fn();
    });

    await expect(
      startDatabases(cwd, { mongodb: false, redis: true, postgresql: false }, noop, noop),
    ).rejects.toThrow('Failed to start Redis: redis-non-error');
  });

  it('wraps a Postgres startup failure (Error) with a descriptive message', async () => {
    vi.mocked(PostgresMemoryServer.create).mockRejectedValue(new Error('pg-boom'));

    await expect(
      startDatabases(cwd, { mongodb: false, redis: false, postgresql: true }, noop, noop),
    ).rejects.toThrow('Failed to start Postgres: pg-boom');
  });

  it('wraps a Postgres startup failure (non-Error) with a descriptive message', async () => {
    vi.mocked(PostgresMemoryServer.create).mockRejectedValue('pg-non-error');

    await expect(
      startDatabases(cwd, { mongodb: false, redis: false, postgresql: true }, noop, noop),
    ).rejects.toThrow('Failed to start Postgres: pg-non-error');
  });

  it('leaves the ACL datastore as mongodb when both mongodb and postgresql are configured', async () => {
    vi.mocked(MongoMemoryServer.create).mockResolvedValue({
      getUri: () => 'mongodb://localhost/test',
      stop: vi.fn().mockResolvedValue(undefined),
    } as any);
    vi.mocked(PostgresMemoryServer.create).mockResolvedValue({
      getUri: () => 'postgresql://localhost/test',
      stop: vi.fn().mockResolvedValue(undefined),
    } as any);

    const result = await startDatabases(cwd, { mongodb: true, redis: false, postgresql: true }, noop, noop);

    // mongo already claimed the acl datastore — postgres must not overwrite it
    expect(result.env['datastores__acl__type']).toBe('mongodb');
    expect(result.env['datastores__postgres__type']).toBe('postgres');

    for (const db of result.databases) {
      await db.server.stop();
    }
  });
});
