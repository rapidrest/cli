import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { join } from 'path';

vi.mock('child_process', () => ({ spawn: vi.fn() }));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, existsSync: vi.fn() };
});

vi.mock('../../src/lib/db.js', () => ({
  detectDatabases: vi.fn(),
  startDatabases: vi.fn(),
}));

vi.mock('../../src/lib/project.js', () => ({
  detectPackageManager: vi.fn(),
  detectReact: vi.fn(),
}));

vi.mock('../../src/lib/port.js', () => ({
  findAvailablePort: vi.fn(),
}));

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { detectDatabases, startDatabases } from '../../src/lib/db.js';
import { detectPackageManager, detectReact } from '../../src/lib/project.js';
import { findAvailablePort } from '../../src/lib/port.js';
import Start from '../../src/commands/start.js';

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

function fakeDb(type: string) {
  return {
    type,
    uri: `${type}://localhost`,
    server: { stop: vi.fn().mockResolvedValue(undefined) },
  };
}

// Distinguish build/vite spawns (shell:true) from the final server spawn (no shell).
function serverSpawnCall() {
  return vi.mocked(spawn).mock.calls.find(([, , opts]) => !(opts as any)?.shell);
}

function shellSpawnCalls() {
  return vi.mocked(spawn).mock.calls.filter(([, , opts]) => (opts as any)?.shell === true);
}

describe('start', () => {
  beforeEach(() => {
    vi.mocked(spawn).mockImplementation(() => makeFakeProcess() as any);
    vi.mocked(detectPackageManager).mockResolvedValue('npm');
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(detectDatabases).mockResolvedValue({ mongodb: false, redis: false, postgresql: false });
    vi.mocked(startDatabases).mockResolvedValue({ databases: [], env: {} });
    vi.mocked(detectReact).mockResolvedValue(false);
    vi.mocked(findAvailablePort).mockImplementation(async (port) => port as number);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('--no-build flag', () => {
    it('skips the build step entirely and goes straight to starting the server', async () => {
      await Start.run(['--no-build'], ROOT);

      expect(shellSpawnCalls()).toHaveLength(0);
      expect(serverSpawnCall()).toBeDefined();
    });

    it('does not call detectReact when --no-build is set', async () => {
      await Start.run(['--no-build'], ROOT);
      expect(detectReact).not.toHaveBeenCalled();
    });
  });

  describe('build step (without --no-build)', () => {
    it('runs npm run build when no yarn.lock or packageManager field exists', async () => {
      await Start.run([], ROOT);

      const builds = shellSpawnCalls();
      expect(builds.length).toBeGreaterThanOrEqual(1);
      const [cmd, args] = builds[0];
      expect(cmd).toBe('npm');
      expect(args).toEqual(['run', 'build']);
    });

    it('runs yarn build when yarn.lock is present', async () => {
      vi.mocked(detectPackageManager).mockResolvedValue('yarn');

      await Start.run([], ROOT);

      const [cmd, args] = shellSpawnCalls()[0];
      expect(cmd).toBe('yarn');
      expect(args).toEqual(['build']);
    });

    it('runs yarn build when packageManager field starts with "yarn"', async () => {
      vi.mocked(detectPackageManager).mockResolvedValue('yarn');

      await Start.run([], ROOT);

      const [cmd] = shellSpawnCalls()[0];
      expect(cmd).toBe('yarn');
    });
  });

  describe('server process', () => {
    it('spawns node with a server.js path', async () => {
      await Start.run(['--no-build'], ROOT);

      const call = serverSpawnCall();
      expect(call).toBeDefined();
      const [cmd, args] = call!;
      expect(cmd).toBe(process.execPath);
      expect(args[0]).toContain('server.js');
    });

    it('checks for server files relative to the project cwd, not the node binary path', async () => {
      await Start.run(['--no-build'], ROOT);

      const checkedPaths = vi.mocked(existsSync).mock.calls.map(([p]) => String(p));
      for (const p of checkedPaths) {
        expect(p.startsWith(ROOT)).toBe(true);
        expect(p).not.toContain(process.execPath);
      }
    });

    it('falls back to dist/server.js when no specific layout is detected', async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      await Start.run(['--no-build'], ROOT);

      const [, args] = serverSpawnCall()!;
      expect(args[0]).toBe(join('dist', 'server.js'));
    });

    it('uses dist/server/server.js when existsSync returns true for that path (first check)', async () => {
      vi.mocked(existsSync).mockReturnValueOnce(true);

      await Start.run(['--no-build'], ROOT);

      const [, args] = serverSpawnCall()!;
      expect(args[0]).toBe(join('dist', 'server', 'server.js'));
    });

    it('uses dist/src/server.js when the first check fails but the second succeeds', async () => {
      vi.mocked(existsSync).mockReturnValueOnce(false).mockReturnValueOnce(true);

      await Start.run(['--no-build'], ROOT);

      const [, args] = serverSpawnCall()!;
      expect(args[0]).toBe(join('dist', 'src', 'server.js'));
    });

    it('passes db env vars into the server process environment', async () => {
      vi.mocked(startDatabases).mockResolvedValue({
        databases: [],
        env: { datastores__acl__url: 'mongodb://localhost:27017' },
      });

      await Start.run(['--no-build'], ROOT);

      const [, , opts] = serverSpawnCall()!;
      expect((opts as any).env).toMatchObject({ datastores__acl__url: 'mongodb://localhost:27017' });
    });
  });

  describe('database lifecycle', () => {
    it('calls detectDatabases before starting the server', async () => {
      await Start.run(['--no-build'], ROOT);
      expect(detectDatabases).toHaveBeenCalledOnce();
    });

    it('passes the detected config to startDatabases', async () => {
      vi.mocked(detectDatabases).mockResolvedValue({ mongodb: true, redis: false, postgresql: false });

      await Start.run(['--no-build'], ROOT);

      expect(startDatabases).toHaveBeenCalledWith(
        expect.any(String),
        { mongodb: true, redis: false, postgresql: false },
        expect.any(Function),
        expect.any(Function),
      );
    });

    it('calls server.stop() on each started database after server exits', async () => {
      const mongo = fakeDb('mongodb');
      const redis = fakeDb('redis');
      vi.mocked(startDatabases).mockResolvedValue({ databases: [mongo as any, redis as any], env: {} });

      await Start.run(['--no-build'], ROOT);

      expect(mongo.server.stop).toHaveBeenCalledOnce();
      expect(redis.server.stop).toHaveBeenCalledOnce();
    });
  });

  describe('--docker flag', () => {
    it('skips detectDatabases when --docker is set', async () => {
      await Start.run(['--no-build', '--docker'], ROOT);
      expect(detectDatabases).not.toHaveBeenCalled();
    });

    it('skips startDatabases when --docker is set', async () => {
      await Start.run(['--no-build', '--docker'], ROOT);
      expect(startDatabases).not.toHaveBeenCalled();
    });

    it('still spawns the server process when --docker is set', async () => {
      await Start.run(['--no-build', '--docker'], ROOT);
      expect(serverSpawnCall()).toBeDefined();
    });

    it('passes no db env vars to the server process when --docker is set', async () => {
      await Start.run(['--no-build', '--docker'], ROOT);

      const [, , opts] = serverSpawnCall()!;
      const env = (opts as any).env as Record<string, string>;
      const dbKeys = Object.keys(env).filter((k) => k.startsWith('datastores__'));
      expect(dbKeys).toHaveLength(0);
    });

    it('still runs the build step when --docker is set without --no-build', async () => {
      await Start.run(['--docker'], ROOT);

      const builds = shellSpawnCalls();
      expect(builds.length).toBeGreaterThanOrEqual(1);
      expect(builds[0][0]).toBe('npm');
    });

    it('does not stop any database servers on exit when --docker is set', async () => {
      const mongo = fakeDb('mongodb');
      vi.mocked(startDatabases).mockResolvedValue({ databases: [mongo as any], env: {} });

      await Start.run(['--no-build', '--docker'], ROOT);

      expect(mongo.server.stop).not.toHaveBeenCalled();
    });
  });

  describe('environment variable passthrough', () => {
    it('passes shell env vars through to the server process', async () => {
      const testKey = '__RAPIDREST_TEST_VAR__';
      process.env[testKey] = 'shell-value';
      try {
        await Start.run(['--no-build'], ROOT);
        const [, , opts] = serverSpawnCall()!;
        expect((opts as any).env).toMatchObject({ [testKey]: 'shell-value' });
      } finally {
        delete process.env[testKey];
      }
    });

    it('passes shell env vars through to the server process in --docker mode', async () => {
      const testKey = '__RAPIDREST_TEST_VAR__';
      process.env[testKey] = 'docker-shell-value';
      try {
        await Start.run(['--no-build', '--docker'], ROOT);
        const [, , opts] = serverSpawnCall()!;
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
        await Start.run(['--no-build'], ROOT);
        const [, , opts] = serverSpawnCall()!;
        expect((opts as any).env[testKey]).toBe('db-value');
      } finally {
        delete process.env[testKey];
      }
    });

    it('build commands inherit the shell environment implicitly (no explicit env stripping)', async () => {
      const testKey = '__RAPIDREST_TEST_VAR__';
      process.env[testKey] = 'build-value';
      try {
        await Start.run([], ROOT);
        // runCommand spawns with no explicit env option — child inherits process.env automatically
        const [, , buildOpts] = shellSpawnCalls()[0];
        expect((buildOpts as any).env).toBeUndefined();
      } finally {
        delete process.env[testKey];
      }
    });
  });

  describe('port detection', () => {
    it('defaults to port 3000 and passes it to findAvailablePort', async () => {
      await Start.run(['--no-build'], ROOT);
      expect(findAvailablePort).toHaveBeenCalledWith(3000);
    });

    it('passes the port through to the server env when free', async () => {
      await Start.run(['--no-build'], ROOT);
      const [, , opts] = serverSpawnCall()!;
      expect((opts as any).env.port).toBe('3000');
    });

    it('uses --port as the preferred base port', async () => {
      await Start.run(['--no-build', '--port', '4000'], ROOT);
      expect(findAvailablePort).toHaveBeenCalledWith(4000);
    });

    it('falls back to the port returned by findAvailablePort when the preferred one is occupied', async () => {
      vi.mocked(findAvailablePort).mockResolvedValue(3001);

      await Start.run(['--no-build'], ROOT);

      const [, , opts] = serverSpawnCall()!;
      expect((opts as any).env.port).toBe('3001');
    });

    it('warns when falling back to a different port', async () => {
      vi.mocked(findAvailablePort).mockResolvedValue(3001);
      const warnSpy = vi.spyOn(Start.prototype, 'warn').mockImplementation(() => undefined as never);

      await Start.run(['--no-build'], ROOT);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('3000'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('3001'));
      warnSpy.mockRestore();
    });

    it('does not warn when the preferred port is free', async () => {
      const warnSpy = vi.spyOn(Start.prototype, 'warn').mockImplementation(() => undefined as never);

      await Start.run(['--no-build'], ROOT);

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('throws when --port is explicitly set and that port is already in use', async () => {
      vi.mocked(findAvailablePort).mockResolvedValue(3001);

      await expect(Start.run(['--no-build', '--port', '3000'], ROOT)).rejects.toThrow(
        'The specified port (3000) is already in use.',
      );
    });

    it('does not spawn the server when the explicit --port is already in use', async () => {
      vi.mocked(findAvailablePort).mockResolvedValue(3001);

      await expect(Start.run(['--no-build', '--port', '3000'], ROOT)).rejects.toThrow();

      expect(serverSpawnCall()).toBeUndefined();
    });

    it('does not warn when --port is explicitly set and already in use (it throws instead)', async () => {
      vi.mocked(findAvailablePort).mockResolvedValue(3001);
      const warnSpy = vi.spyOn(Start.prototype, 'warn').mockImplementation(() => undefined as never);

      await expect(Start.run(['--no-build', '--port', '3000'], ROOT)).rejects.toThrow();

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('does not throw when --port is explicitly set and already free', async () => {
      await expect(Start.run(['--no-build', '--port', '4000'], ROOT)).resolves.toBeUndefined();
    });
  });

  describe('React / Vite integration', () => {
    it('does not run vite build when detectReact returns false', async () => {
      await Start.run([], ROOT);

      const builds = shellSpawnCalls();
      expect(builds.every(([cmd]) => !String(cmd).includes('vite'))).toBe(true);
    });

    it('runs vite build between the main build and server startup when detectReact is true', async () => {
      vi.mocked(detectReact).mockResolvedValue(true);

      await Start.run([], ROOT);

      const builds = shellSpawnCalls();
      // builds: [npm run build, vite build]
      expect(builds).toHaveLength(2);
      const [viteCmd, viteArgs] = builds[1];
      expect(viteCmd).toContain('vite');
      expect(viteArgs).toEqual(['build']);
    });

    it('skips vite build when --no-build is set even if detectReact would return true', async () => {
      vi.mocked(detectReact).mockResolvedValue(true);

      await Start.run(['--no-build'], ROOT);

      expect(shellSpawnCalls()).toHaveLength(0);
      expect(detectReact).not.toHaveBeenCalled();
    });
  });
});
