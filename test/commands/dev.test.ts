import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { join } from 'path';

vi.mock('child_process', () => ({ spawn: vi.fn() }));

vi.mock('../../src/lib/db.js', () => ({
  detectDatabases: vi.fn(),
  startDatabases: vi.fn(),
}));

vi.mock('../../src/lib/project.js', () => ({
  detectReact: vi.fn(),
}));

import { spawn } from 'child_process';
import { detectDatabases, startDatabases } from '../../src/lib/db.js';
import { detectReact } from '../../src/lib/project.js';
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

describe('dev', () => {
  beforeEach(() => {
    vi.mocked(spawn).mockImplementation(() => makeFakeProcess() as any);
    vi.mocked(detectDatabases).mockResolvedValue({ mongodb: false, redis: false, postgresql: false });
    vi.mocked(startDatabases).mockResolvedValue({ databases: [], env: {} });
    vi.mocked(detectReact).mockResolvedValue(false);
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
});
