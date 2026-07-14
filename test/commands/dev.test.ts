import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { join, delimiter } from 'path';

vi.mock('child_process', () => ({ spawn: vi.fn() }));

vi.mock('../../src/lib/db.js', () => ({
  detectDatabases: vi.fn(),
  startDatabases: vi.fn(),
}));

vi.mock('../../src/lib/project.js', () => ({
  detectReact: vi.fn(),
}));

vi.mock('../../src/lib/port.js', () => ({
  findAvailablePort: vi.fn(),
}));

import { spawn } from 'child_process';
import { detectDatabases, startDatabases } from '../../src/lib/db.js';
import { detectReact } from '../../src/lib/project.js';
import { findAvailablePort } from '../../src/lib/port.js';
import Dev from '../../src/commands/dev.js';

const ROOT = process.cwd();

class FakeProcess extends EventEmitter {
  killed = false;
  kill() { this.killed = true; }
}

function makeFakeProcess(): FakeProcess {
  const p = new FakeProcess();
  setImmediate(() => p.emit('exit', 0));
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

describe('dev', () => {
  beforeEach(() => {
    vi.mocked(spawn).mockImplementation(() => makeFakeProcess() as any);
    vi.mocked(detectDatabases).mockResolvedValue({ mongodb: false, redis: false, postgresql: false });
    vi.mocked(startDatabases).mockResolvedValue({ databases: [], env: {} });
    vi.mocked(detectReact).mockResolvedValue(false);
    vi.mocked(findAvailablePort).mockImplementation(async (port) => port);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('server process', () => {
    it('spawns tsx from the project node_modules/.bin with --watch src/server.ts', async () => {
      await Dev.run([], ROOT);

      expect(spawn).toHaveBeenCalledTimes(1);
      const [cmd, args] = vi.mocked(spawn).mock.calls[0];
      expect(cmd).toContain(join('node_modules', '.bin', 'tsx'));
      expect(args).toEqual(['--watch', 'src/server.ts']);
    });

    it('prepends --inspect=0.0.0.0:9229 to tsx args when --inspect is passed', async () => {
      await Dev.run(['--inspect'], ROOT);

      const [, args] = vi.mocked(spawn).mock.calls[0];
      expect(args).toEqual(['--inspect=0.0.0.0:9229', '--watch', 'src/server.ts']);
    });

    it('passes db env vars into the tsx process environment', async () => {
      vi.mocked(startDatabases).mockResolvedValue({
        databases: [],
        env: { datastores__acl__url: 'mongodb://localhost:27017' },
      });

      await Dev.run([], ROOT);

      const [, , opts] = vi.mocked(spawn).mock.calls[0];
      expect((opts as any).env).toMatchObject({ datastores__acl__url: 'mongodb://localhost:27017' });
    });

    it('includes project node_modules/.bin in PATH for the server process', async () => {
      await Dev.run([], ROOT);

      const [, , opts] = vi.mocked(spawn).mock.calls[0];
      const envPath: string = (opts as any).env?.PATH ?? '';
      expect(envPath).toContain(join('node_modules', '.bin'));
    });
  });

  describe('database lifecycle', () => {
    it('calls detectDatabases before starting the server', async () => {
      await Dev.run([], ROOT);
      expect(detectDatabases).toHaveBeenCalledOnce();
    });

    it('passes the detected config to startDatabases', async () => {
      vi.mocked(detectDatabases).mockResolvedValue({ mongodb: true, redis: false, postgresql: false });

      await Dev.run([], ROOT);

      expect(startDatabases).toHaveBeenCalledWith(
        expect.any(String),
        { mongodb: true, redis: false, postgresql: false },
        expect.any(Function),
        expect.any(Function),
      );
    });

    it('calls server.stop() on each started database after the server exits', async () => {
      const mongo = fakeDb('mongodb');
      const redis = fakeDb('redis');
      vi.mocked(startDatabases).mockResolvedValue({ databases: [mongo as any, redis as any], env: {} });

      await Dev.run([], ROOT);

      expect(mongo.server.stop).toHaveBeenCalledOnce();
      expect(redis.server.stop).toHaveBeenCalledOnce();
    });

    it('does not throw when no databases are configured', async () => {
      await expect(Dev.run([], ROOT)).resolves.toBeUndefined();
    });
  });

  describe('port detection', () => {
    it('defaults to port 3000 and passes it to findAvailablePort', async () => {
      await Dev.run([], ROOT);
      expect(findAvailablePort).toHaveBeenCalledWith(3000);
    });

    it('passes the port through to the server env when free', async () => {
      await Dev.run([], ROOT);
      const [, , opts] = vi.mocked(spawn).mock.calls[0];
      expect((opts as any).env.port).toBe('3000');
    });

    it('uses --port as the preferred base port', async () => {
      await Dev.run(['--port', '4000'], ROOT);
      expect(findAvailablePort).toHaveBeenCalledWith(4000);
    });

    it('falls back to the port returned by findAvailablePort when the preferred one is occupied', async () => {
      vi.mocked(findAvailablePort).mockResolvedValue(3001);

      await Dev.run([], ROOT);

      const [, , opts] = vi.mocked(spawn).mock.calls[0];
      expect((opts as any).env.port).toBe('3001');
    });

    it('warns when falling back to a different port', async () => {
      vi.mocked(findAvailablePort).mockResolvedValue(3001);
      const warnSpy = vi.spyOn(Dev.prototype, 'warn').mockImplementation(() => undefined as never);

      await Dev.run([], ROOT);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('3000'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('3001'));
      warnSpy.mockRestore();
    });

    it('does not warn when the preferred port is free', async () => {
      const warnSpy = vi.spyOn(Dev.prototype, 'warn').mockImplementation(() => undefined as never);

      await Dev.run([], ROOT);

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('throws when --port is explicitly set and that port is already in use', async () => {
      vi.mocked(findAvailablePort).mockResolvedValue(3001);

      await expect(Dev.run(['--port', '3000'], ROOT)).rejects.toThrow(
        'The specified port (3000) is already in use.',
      );
    });

    it('does not spawn the server when the explicit --port is already in use', async () => {
      vi.mocked(findAvailablePort).mockResolvedValue(3001);

      await expect(Dev.run(['--port', '3000'], ROOT)).rejects.toThrow();

      expect(spawn).not.toHaveBeenCalled();
    });

    it('does not warn when --port is explicitly set and already in use (it throws instead)', async () => {
      vi.mocked(findAvailablePort).mockResolvedValue(3001);
      const warnSpy = vi.spyOn(Dev.prototype, 'warn').mockImplementation(() => undefined as never);

      await expect(Dev.run(['--port', '3000'], ROOT)).rejects.toThrow();

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('does not throw when --port is explicitly set and already free', async () => {
      await expect(Dev.run(['--port', '4000'], ROOT)).resolves.toBeUndefined();
    });
  });

  describe('React / Vite integration', () => {
    it('does not spawn vite when detectReact returns false', async () => {
      await Dev.run([], ROOT);
      expect(spawn).toHaveBeenCalledTimes(1);
    });

    it('spawns vite build --watch concurrently when detectReact returns true', async () => {
      vi.mocked(detectReact).mockResolvedValue(true);

      await Dev.run([], ROOT);

      expect(spawn).toHaveBeenCalledTimes(2);
      const [viteCmd, viteArgs] = vi.mocked(spawn).mock.calls[1];
      expect(viteCmd).toContain('vite');
      expect(viteArgs).toEqual(['build', '--watch']);
    });

    it('vite process receives the same db env vars as the server', async () => {
      vi.mocked(detectReact).mockResolvedValue(true);
      vi.mocked(startDatabases).mockResolvedValue({
        databases: [],
        env: { datastores__acl__url: 'mongodb://localhost:27017' },
      });

      await Dev.run([], ROOT);

      const [, , viteOpts] = vi.mocked(spawn).mock.calls[1];
      expect((viteOpts as any).env).toMatchObject({ datastores__acl__url: 'mongodb://localhost:27017' });
    });
  });

  describe('--docker flag', () => {
    it('skips detectDatabases when --docker is set', async () => {
      await Dev.run(['--docker'], ROOT);
      expect(detectDatabases).not.toHaveBeenCalled();
    });

    it('skips startDatabases when --docker is set', async () => {
      await Dev.run(['--docker'], ROOT);
      expect(startDatabases).not.toHaveBeenCalled();
    });

    it('still spawns the tsx server when --docker is set', async () => {
      await Dev.run(['--docker'], ROOT);

      expect(spawn).toHaveBeenCalledTimes(1);
      const [cmd] = vi.mocked(spawn).mock.calls[0];
      expect(cmd).toContain(join('node_modules', '.bin', 'tsx'));
    });

    it('passes no db env vars to the tsx process when --docker is set', async () => {
      await Dev.run(['--docker'], ROOT);

      const [, , opts] = vi.mocked(spawn).mock.calls[0];
      const env = (opts as any).env as Record<string, string>;
      const dbKeys = Object.keys(env).filter((k) => k.startsWith('datastores__'));
      expect(dbKeys).toHaveLength(0);
    });

    it('does not stop any database servers on exit when --docker is set', async () => {
      const mongo = fakeDb('mongodb');
      vi.mocked(startDatabases).mockResolvedValue({ databases: [mongo as any], env: {} });

      await Dev.run(['--docker'], ROOT);

      expect(mongo.server.stop).not.toHaveBeenCalled();
    });

    it('still spawns vite in watch mode when --docker is set and React is configured', async () => {
      vi.mocked(detectReact).mockResolvedValue(true);

      await Dev.run(['--docker'], ROOT);

      expect(spawn).toHaveBeenCalledTimes(2);
      const [viteCmd, viteArgs] = vi.mocked(spawn).mock.calls[1];
      expect(viteCmd).toContain('vite');
      expect(viteArgs).toEqual(['build', '--watch']);
    });
  });

  describe('environment variable passthrough', () => {
    it('passes shell env vars through to the tsx process', async () => {
      const testKey = '__RAPIDREST_TEST_VAR__';
      process.env[testKey] = 'shell-value';
      try {
        await Dev.run([], ROOT);
        const [, , opts] = vi.mocked(spawn).mock.calls[0];
        expect((opts as any).env).toMatchObject({ [testKey]: 'shell-value' });
      } finally {
        delete process.env[testKey];
      }
    });

    it('passes shell env vars through to the tsx process in --docker mode', async () => {
      const testKey = '__RAPIDREST_TEST_VAR__';
      process.env[testKey] = 'docker-shell-value';
      try {
        await Dev.run(['--docker'], ROOT);
        const [, , opts] = vi.mocked(spawn).mock.calls[0];
        expect((opts as any).env).toMatchObject({ [testKey]: 'docker-shell-value' });
      } finally {
        delete process.env[testKey];
      }
    });

    it('db env vars take precedence over shell env vars of the same name', async () => {
      const testKey = '__RAPIDREST_TEST_VAR__';
      process.env[testKey] = 'shell-value';
      vi.mocked(startDatabases).mockResolvedValue({
        databases: [],
        env: { [testKey]: 'db-value' },
      });
      try {
        await Dev.run([], ROOT);
        const [, , opts] = vi.mocked(spawn).mock.calls[0];
        expect((opts as any).env[testKey]).toBe('db-value');
      } finally {
        delete process.env[testKey];
      }
    });

    it('vite process receives the same shell env vars as the tsx server', async () => {
      vi.mocked(detectReact).mockResolvedValue(true);
      const testKey = '__RAPIDREST_TEST_VAR__';
      process.env[testKey] = 'shell-value';
      try {
        await Dev.run([], ROOT);
        const [, , viteOpts] = vi.mocked(spawn).mock.calls[1];
        expect((viteOpts as any).env).toMatchObject({ [testKey]: 'shell-value' });
      } finally {
        delete process.env[testKey];
      }
    });
  });

  describe('error handling', () => {
    it('throws when startDatabases rejects with an Error', async () => {
      vi.mocked(startDatabases).mockRejectedValue(new Error('Failed to start Redis: boom'));

      await expect(Dev.run([], ROOT)).rejects.toThrow('Failed to start Redis: boom');
    });

    it('falls back to String(e) when startDatabases rejects with a non-Error value', async () => {
      vi.mocked(startDatabases).mockRejectedValue('db-non-error');

      await expect(Dev.run([], ROOT)).rejects.toThrow('db-non-error');
    });

    it('does not spawn the server when startDatabases rejects', async () => {
      vi.mocked(startDatabases).mockRejectedValue(new Error('boom'));

      await expect(Dev.run([], ROOT)).rejects.toThrow();

      expect(spawn).not.toHaveBeenCalled();
    });
  });

  describe('platform-specific behavior', () => {
    it('does not append .cmd to the tsx/vite binary names on non-Windows platforms', async () => {
      vi.mocked(detectReact).mockResolvedValue(true);

      await withPlatform('linux', () => Dev.run([], ROOT));

      const [tsxCmd] = vi.mocked(spawn).mock.calls[0];
      const [viteCmd] = vi.mocked(spawn).mock.calls[1];
      expect(tsxCmd).not.toContain('.cmd');
      expect(viteCmd).not.toContain('.cmd');
    });

    it('falls back to an empty string when process.env.PATH is unset', async () => {
      const originalPath = process.env.PATH;
      delete process.env.PATH;
      try {
        await Dev.run([], ROOT);
        const [, , opts] = vi.mocked(spawn).mock.calls[0];
        const projectBin = join(ROOT, 'node_modules', '.bin');
        expect((opts as any).env.PATH).toBe(`${projectBin}${delimiter}`); // nothing appended after the delimiter
      } finally {
        process.env.PATH = originalPath;
      }
    });
  });

  describe('database log/warn forwarding', () => {
    it('forwards log and warn messages from startDatabases through to the command', async () => {
      const logSpy = vi.spyOn(Dev.prototype, 'log').mockImplementation(() => undefined);
      const warnSpy = vi.spyOn(Dev.prototype, 'warn').mockImplementation(() => undefined as never);
      vi.mocked(startDatabases).mockImplementation(async (_cwd, _dbs, log, warn) => {
        log('db log message');
        warn('db warn message');
        return { databases: [], env: {} };
      });

      try {
        await Dev.run([], ROOT);

        expect(logSpy).toHaveBeenCalledWith('db log message');
        expect(warnSpy).toHaveBeenCalledWith('db warn message');
      } finally {
        logSpy.mockRestore();
        warnSpy.mockRestore();
      }
    });
  });
});
