///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return { ...actual, access: vi.fn(), rm: vi.fn() };
});

vi.mock('../../src/lib/project.js', () => ({
  detectReact: vi.fn(),
  runProjectBin: vi.fn(),
}));

import { access, rm } from 'fs/promises';
import { join } from 'path';
import { detectReact, runProjectBin } from '../../src/lib/project.js';
import Build from '../../src/commands/build.js';

const ROOT = process.cwd();

// By default, only src/ and test/ "exist" — apps/ and tsconfig.client.json do not.
function mockDirs(existing: string[]): void {
  vi.mocked(access).mockImplementation(async (path) => {
    const matches = existing.some((dir) => String(path).endsWith(dir));
    if (!matches) throw new Error('ENOENT');
  });
}

describe('build', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rm).mockResolvedValue(undefined);
    vi.mocked(runProjectBin).mockResolvedValue(undefined);
    vi.mocked(detectReact).mockResolvedValue(false);
    mockDirs(['src', 'test']);
  });

  it('cleans dist/ before compiling', async () => {
    await Build.run([], ROOT);
    expect(rm).toHaveBeenCalledWith(join(process.cwd(), 'dist'), { recursive: true, force: true });
  });

  it('compiles TypeScript via the project\'s own tsc', async () => {
    await Build.run([], ROOT);
    expect(runProjectBin).toHaveBeenCalledWith(process.cwd(), 'tsc', []);
  });

  it('does not build a React frontend when detectReact returns false', async () => {
    vi.mocked(detectReact).mockResolvedValue(false);
    await Build.run([], ROOT);
    expect(runProjectBin).not.toHaveBeenCalledWith(process.cwd(), 'vite', ['build']);
  });

  describe('when React is configured', () => {
    beforeEach(() => {
      vi.mocked(detectReact).mockResolvedValue(true);
    });

    it('runs vite build after the main tsc pass', async () => {
      mockDirs(['src', 'test']); // no tsconfig.client.json
      await Build.run([], ROOT);

      const tscCall = vi.mocked(runProjectBin).mock.calls.findIndex((c) => c[1] === 'tsc' && c[2].length === 0);
      const viteCall = vi.mocked(runProjectBin).mock.calls.findIndex((c) => c[1] === 'vite');
      expect(tscCall).toBeGreaterThanOrEqual(0);
      expect(viteCall).toBeGreaterThan(tscCall);
      expect(runProjectBin).toHaveBeenCalledWith(process.cwd(), 'vite', ['build']);
    });

    it('also compiles tsconfig.client.json when it exists', async () => {
      mockDirs(['src', 'test', 'tsconfig.client.json']);
      await Build.run([], ROOT);
      expect(runProjectBin).toHaveBeenCalledWith(process.cwd(), 'tsc', ['-p', 'tsconfig.client.json']);
    });

    it('skips the client tsc pass when tsconfig.client.json does not exist', async () => {
      mockDirs(['src', 'test']);
      await Build.run([], ROOT);
      expect(runProjectBin).not.toHaveBeenCalledWith(process.cwd(), 'tsc', ['-p', 'tsconfig.client.json']);
    });
  });

  describe('linting', () => {
    it('lints before cleaning/compiling, targeting whichever of src/test/apps exist', async () => {
      mockDirs(['src', 'test']);
      await Build.run([], ROOT);

      const lintCall = vi.mocked(runProjectBin).mock.calls.findIndex((c) => c[1] === 'eslint');
      const rmCallOrder = vi.mocked(rm).mock.invocationCallOrder[0];
      expect(runProjectBin).toHaveBeenCalledWith(process.cwd(), 'eslint', ['src', 'test']);
      expect(vi.mocked(runProjectBin).mock.invocationCallOrder[lintCall]).toBeLessThan(rmCallOrder);
    });

    it('includes apps when it exists (React-configured projects)', async () => {
      mockDirs(['src', 'test', 'apps']);
      await Build.run([], ROOT);
      expect(runProjectBin).toHaveBeenCalledWith(process.cwd(), 'eslint', ['src', 'test', 'apps']);
    });

    it('omits a lint target directory that does not exist', async () => {
      mockDirs(['src']); // no test/
      await Build.run([], ROOT);
      expect(runProjectBin).toHaveBeenCalledWith(process.cwd(), 'eslint', ['src']);
    });

    it('skips linting entirely when --no-lint is set', async () => {
      await Build.run(['--no-lint'], ROOT);
      expect(runProjectBin).not.toHaveBeenCalledWith(process.cwd(), 'eslint', expect.anything());
    });

    it('propagates an error thrown by the lint step, without cleaning or compiling', async () => {
      vi.mocked(runProjectBin).mockImplementation(async (_cwd, name) => {
        if (name === 'eslint') throw new Error('lint failed');
      });

      await expect(Build.run([], ROOT)).rejects.toThrow('lint failed');
      expect(rm).not.toHaveBeenCalled();
    });
  });

  it('propagates an error thrown by the tsc build step', async () => {
    vi.mocked(runProjectBin).mockImplementation(async (_cwd, name) => {
      if (name === 'tsc') throw new Error('tsc failed');
    });
    await expect(Build.run([], ROOT)).rejects.toThrow('tsc failed');
  });

  it('propagates an error thrown by the vite build step', async () => {
    vi.mocked(detectReact).mockResolvedValue(true);
    mockDirs(['src', 'test']);
    vi.mocked(runProjectBin).mockImplementation(async (_cwd, name) => {
      if (name === 'vite') throw new Error('vite failed');
    });
    await expect(Build.run([], ROOT)).rejects.toThrow('vite failed');
  });

  it('falls back to String(e) when a build step errors with a non-Error value', async () => {
    vi.mocked(runProjectBin).mockRejectedValue('non-error-boom');
    await expect(Build.run([], ROOT)).rejects.toThrow('non-error-boom');
  });
});
