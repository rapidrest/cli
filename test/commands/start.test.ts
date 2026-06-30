import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { join } from 'path';

vi.mock('child_process', () => ({ spawn: vi.fn() }));

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return { ...actual, access: vi.fn(), readFile: vi.fn() };
});

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, existsSync: vi.fn() };
});

vi.mock('../../src/lib/db.js', () => ({
  detectDatabases: vi.fn(),
  startDatabases: vi.fn(),
}));

vi.mock('../../src/lib/project.js', () => ({
  detectReact: vi.fn(),
}));

import { spawn } from 'child_process';
import { access, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { detectDatabases, startDatabases } from '../../src/lib/db.js';
import { detectReact } from '../../src/lib/project.js';
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
    // Default: npm (no yarn.lock, no packageManager field in package.json)
    vi.mocked(readFile).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    vi.mocked(access).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(detectDatabases).mockResolvedValue({ mongodb: false, redis: false, postgresql: false });
    vi.mocked(startDatabases).mockResolvedValue({ databases: [], env: {} });
    vi.mocked(detectReact).mockResolvedValue(false);
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
      vi.mocked(access).mockResolvedValue(undefined); // yarn.lock accessible

      await Start.run([], ROOT);

      const [cmd, args] = shellSpawnCalls()[0];
      expect(cmd).toBe('yarn');
      expect(args).toEqual(['build']);
    });

    it('runs yarn build when packageManager field starts with "yarn"', async () => {
      vi.mocked(readFile).mockResolvedValue(JSON.stringify({ packageManager: 'yarn@4.5.0' }) as any);

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
