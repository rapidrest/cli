///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { join, delimiter } from 'path';

vi.mock('child_process', () => ({ spawn: vi.fn() }));

vi.mock('../../../src/lib/db.js', () => ({
  detectDatabases: vi.fn(),
  startDatabases: vi.fn(),
}));

vi.mock('../../../src/lib/project.js', () => ({
  detectReact: vi.fn(),
}));

vi.mock('../../../src/lib/port.js', () => ({
  findAvailablePort: vi.fn(),
}));

import { spawn } from 'child_process';
import { detectDatabases, startDatabases } from '../../../src/lib/db.js';
import { detectReact } from '../../../src/lib/project.js';
import { findAvailablePort } from '../../../src/lib/port.js';
import ReactExport from '../../../src/commands/react/export.js';

const ROOT = process.cwd();

class FakeProcess extends EventEmitter {
  killed = false;
  kill() { this.killed = true; }
}

function makeFakeProcess(exitCode = 0): FakeProcess {
  const p = new FakeProcess();
  setImmediate(() => p.emit('exit', exitCode));
  return p;
}

function makeErroringFakeProcess(err: unknown): FakeProcess {
  const p = new FakeProcess();
  setImmediate(() => p.emit('error', err));
  return p;
}

function fakeDb(type: string) {
  return {
    type,
    uri: `${type}://localhost`,
    server: { stop: vi.fn().mockResolvedValue(undefined) },
  };
}

async function withPlatform<T>(platform: string, fn: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: platform });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, 'platform', original);
  }
}

describe('react export', () => {
  beforeEach(() => {
    vi.mocked(spawn).mockImplementation(() => makeFakeProcess() as any);
    vi.mocked(detectDatabases).mockResolvedValue({ mongodb: false, redis: false, postgresql: false });
    vi.mocked(startDatabases).mockResolvedValue({ databases: [], env: {} });
    vi.mocked(detectReact).mockResolvedValue(true);
    vi.mocked(findAvailablePort).mockImplementation(async (port) => port);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('React detection', () => {
    it('errors when no React app is detected, without starting databases or spawning anything', async () => {
      vi.mocked(detectReact).mockResolvedValue(false);

      await expect(ReactExport.run([], ROOT)).rejects.toThrow(/No React app detected/);

      expect(detectDatabases).not.toHaveBeenCalled();
      expect(spawn).not.toHaveBeenCalled();
    });

    it('proceeds when a React app is detected', async () => {
      await expect(ReactExport.run([], ROOT)).resolves.toBeUndefined();
      expect(spawn).toHaveBeenCalledOnce();
    });
  });

  describe('rapidreact delegation', () => {
    it('spawns rapidreact from the project node_modules/.bin with the "export" argument', async () => {
      await ReactExport.run([], ROOT);

      expect(spawn).toHaveBeenCalledOnce();
      const [cmd, args] = vi.mocked(spawn).mock.calls[0];
      expect(cmd).toContain(join('node_modules', '.bin', 'rapidreact'));
      expect(args).toEqual(['export']);
    });

    it('runs with the project cwd and inherited stdio', async () => {
      await ReactExport.run([], ROOT);

      const [, , opts] = vi.mocked(spawn).mock.calls[0];
      expect((opts as any).cwd).toBe(ROOT);
      expect((opts as any).stdio).toBe('inherit');
    });

    it('includes project node_modules/.bin in PATH', async () => {
      await ReactExport.run([], ROOT);

      const [, , opts] = vi.mocked(spawn).mock.calls[0];
      const envPath: string = (opts as any).env?.PATH ?? '';
      expect(envPath).toContain(join('node_modules', '.bin'));
    });

    it('passes db env vars into the rapidreact process environment', async () => {
      vi.mocked(startDatabases).mockResolvedValue({
        databases: [],
        env: { datastores__acl__url: 'mongodb://localhost:27017' },
      });

      await ReactExport.run([], ROOT);

      const [, , opts] = vi.mocked(spawn).mock.calls[0];
      expect((opts as any).env).toMatchObject({ datastores__acl__url: 'mongodb://localhost:27017' });
    });
  });

  describe('database lifecycle', () => {
    it('calls detectDatabases before spawning', async () => {
      await ReactExport.run([], ROOT);
      expect(detectDatabases).toHaveBeenCalledOnce();
    });

    it('passes the detected config to startDatabases', async () => {
      vi.mocked(detectDatabases).mockResolvedValue({ mongodb: true, redis: false, postgresql: false });

      await ReactExport.run([], ROOT);

      expect(startDatabases).toHaveBeenCalledWith(
        expect.any(String),
        { mongodb: true, redis: false, postgresql: false },
        expect.any(Function),
        expect.any(Function),
      );
    });

    it('calls server.stop() on each started database after a successful export', async () => {
      const mongo = fakeDb('mongodb');
      const redis = fakeDb('redis');
      vi.mocked(startDatabases).mockResolvedValue({ databases: [mongo as any, redis as any], env: {} });

      await ReactExport.run([], ROOT);

      expect(mongo.server.stop).toHaveBeenCalledOnce();
      expect(redis.server.stop).toHaveBeenCalledOnce();
    });

    it('calls server.stop() on each started database when the export process fails', async () => {
      vi.mocked(spawn).mockImplementation(() => makeFakeProcess(1) as any);
      const mongo = fakeDb('mongodb');
      vi.mocked(startDatabases).mockResolvedValue({ databases: [mongo as any], env: {} });

      await expect(ReactExport.run([], ROOT)).rejects.toThrow();

      expect(mongo.server.stop).toHaveBeenCalledOnce();
    });

    it('calls server.stop() on each started database when the explicit --port is already in use', async () => {
      vi.mocked(findAvailablePort).mockResolvedValue(3001);
      const mongo = fakeDb('mongodb');
      vi.mocked(startDatabases).mockResolvedValue({ databases: [mongo as any], env: {} });

      await expect(ReactExport.run(['--port', '3000'], ROOT)).rejects.toThrow();

      expect(mongo.server.stop).toHaveBeenCalledOnce();
    });
  });

  describe('port detection', () => {
    it('defaults to port 3000 and passes it to findAvailablePort', async () => {
      await ReactExport.run([], ROOT);
      expect(findAvailablePort).toHaveBeenCalledWith(3000);
    });

    it('passes the port through to the rapidreact process env when free', async () => {
      await ReactExport.run([], ROOT);
      const [, , opts] = vi.mocked(spawn).mock.calls[0];
      expect((opts as any).env.port).toBe('3000');
    });

    it('uses --port as the preferred base port', async () => {
      await ReactExport.run(['--port', '4000'], ROOT);
      expect(findAvailablePort).toHaveBeenCalledWith(4000);
    });

    it('falls back to the port returned by findAvailablePort when the preferred one is occupied', async () => {
      vi.mocked(findAvailablePort).mockResolvedValue(3001);

      await ReactExport.run([], ROOT);

      const [, , opts] = vi.mocked(spawn).mock.calls[0];
      expect((opts as any).env.port).toBe('3001');
    });

    it('warns when falling back to a different port', async () => {
      vi.mocked(findAvailablePort).mockResolvedValue(3001);
      const warnSpy = vi.spyOn(ReactExport.prototype, 'warn').mockImplementation(() => undefined as never);

      await ReactExport.run([], ROOT);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('3000'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('3001'));
      warnSpy.mockRestore();
    });

    it('does not warn when the preferred port is free', async () => {
      const warnSpy = vi.spyOn(ReactExport.prototype, 'warn').mockImplementation(() => undefined as never);

      await ReactExport.run([], ROOT);

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('throws when --port is explicitly set and that port is already in use', async () => {
      vi.mocked(findAvailablePort).mockResolvedValue(3001);

      await expect(ReactExport.run(['--port', '3000'], ROOT)).rejects.toThrow(
        'The specified port (3000) is already in use.',
      );
    });

    it('does not spawn rapidreact when the explicit --port is already in use', async () => {
      vi.mocked(findAvailablePort).mockResolvedValue(3001);

      await expect(ReactExport.run(['--port', '3000'], ROOT)).rejects.toThrow();

      expect(spawn).not.toHaveBeenCalled();
    });
  });

  describe('--docker flag', () => {
    it('skips detectDatabases when --docker is set', async () => {
      await ReactExport.run(['--docker'], ROOT);
      expect(detectDatabases).not.toHaveBeenCalled();
    });

    it('skips startDatabases when --docker is set', async () => {
      await ReactExport.run(['--docker'], ROOT);
      expect(startDatabases).not.toHaveBeenCalled();
    });

    it('still spawns rapidreact when --docker is set', async () => {
      await ReactExport.run(['--docker'], ROOT);
      expect(spawn).toHaveBeenCalledOnce();
    });

    it('passes no db env vars to the rapidreact process when --docker is set', async () => {
      await ReactExport.run(['--docker'], ROOT);

      const [, , opts] = vi.mocked(spawn).mock.calls[0];
      const env = (opts as any).env as Record<string, string>;
      const dbKeys = Object.keys(env).filter((k) => k.startsWith('datastores__'));
      expect(dbKeys).toHaveLength(0);
    });
  });

  describe('error handling', () => {
    it('throws when startDatabases rejects with an Error', async () => {
      vi.mocked(startDatabases).mockRejectedValue(new Error('Failed to start Redis: boom'));

      await expect(ReactExport.run([], ROOT)).rejects.toThrow('Failed to start Redis: boom');
    });

    it('falls back to String(e) when startDatabases rejects with a non-Error value', async () => {
      vi.mocked(startDatabases).mockRejectedValue('db-non-error');

      await expect(ReactExport.run([], ROOT)).rejects.toThrow('db-non-error');
    });

    it('does not spawn rapidreact when startDatabases rejects', async () => {
      vi.mocked(startDatabases).mockRejectedValue(new Error('boom'));

      await expect(ReactExport.run([], ROOT)).rejects.toThrow();

      expect(spawn).not.toHaveBeenCalled();
    });

    it('throws when the rapidreact process exits with a non-zero code', async () => {
      vi.mocked(spawn).mockImplementation(() => makeFakeProcess(1) as any);

      await expect(ReactExport.run([], ROOT)).rejects.toThrow(/exited with code 1/);
    });

    it('falls back to String(e) when the rapidreact process errors with a non-Error value', async () => {
      vi.mocked(spawn).mockImplementation(() => makeErroringFakeProcess('non-error-boom') as any);

      await expect(ReactExport.run([], ROOT)).rejects.toThrow('non-error-boom');
    });
  });

  describe('platform-specific behavior', () => {
    it('does not append .cmd to the rapidreact binary name on non-Windows platforms', async () => {
      await withPlatform('linux', () => ReactExport.run([], ROOT));

      const [cmd] = vi.mocked(spawn).mock.calls[0];
      expect(cmd).not.toContain('.cmd');
    });

    it('does not use a shell on non-Windows platforms', async () => {
      await withPlatform('linux', () => ReactExport.run([], ROOT));

      const [, , opts] = vi.mocked(spawn).mock.calls[0];
      expect((opts as any).shell).toBe(false);
    });

    it('falls back to an empty string when process.env.PATH is unset', async () => {
      const originalPath = process.env.PATH;
      delete process.env.PATH;
      try {
        await ReactExport.run([], ROOT);
        const [, , opts] = vi.mocked(spawn).mock.calls[0];
        const projectBin = join(ROOT, 'node_modules', '.bin');
        expect((opts as any).env.PATH).toBe(`${projectBin}${delimiter}`);
      } finally {
        process.env.PATH = originalPath;
      }
    });
  });

  describe('database log/warn forwarding', () => {
    it('forwards log and warn messages from startDatabases through to the command', async () => {
      const logSpy = vi.spyOn(ReactExport.prototype, 'log').mockImplementation(() => undefined);
      const warnSpy = vi.spyOn(ReactExport.prototype, 'warn').mockImplementation(() => undefined as never);
      vi.mocked(startDatabases).mockImplementation(async (_cwd, _dbs, log, warn) => {
        log('db log message');
        warn('db warn message');
        return { databases: [], env: {} };
      });

      try {
        await ReactExport.run([], ROOT);

        expect(logSpy).toHaveBeenCalledWith('db log message');
        expect(warnSpy).toHaveBeenCalledWith('db warn message');
      } finally {
        logSpy.mockRestore();
        warnSpy.mockRestore();
      }
    });
  });
});
