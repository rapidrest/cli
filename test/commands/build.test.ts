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

describe('build', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rm).mockResolvedValue(undefined);
    vi.mocked(runProjectBin).mockResolvedValue(undefined);
    vi.mocked(detectReact).mockResolvedValue(false);
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
    expect(access).not.toHaveBeenCalled();
  });

  describe('when React is configured', () => {
    beforeEach(() => {
      vi.mocked(detectReact).mockResolvedValue(true);
    });

    it('runs vite build after the main tsc pass', async () => {
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
      await Build.run([], ROOT);

      const tscCall = vi.mocked(runProjectBin).mock.calls.findIndex((c) => c[1] === 'tsc' && c[2].length === 0);
      const viteCall = vi.mocked(runProjectBin).mock.calls.findIndex((c) => c[1] === 'vite');
      expect(tscCall).toBeGreaterThanOrEqual(0);
      expect(viteCall).toBeGreaterThan(tscCall);
      expect(runProjectBin).toHaveBeenCalledWith(process.cwd(), 'vite', ['build']);
    });

    it('also compiles tsconfig.client.json when it exists', async () => {
      vi.mocked(access).mockResolvedValue(undefined);
      await Build.run([], ROOT);
      expect(runProjectBin).toHaveBeenCalledWith(process.cwd(), 'tsc', ['-p', 'tsconfig.client.json']);
    });

    it('skips the client tsc pass when tsconfig.client.json does not exist', async () => {
      vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
      await Build.run([], ROOT);
      expect(runProjectBin).not.toHaveBeenCalledWith(process.cwd(), 'tsc', ['-p', 'tsconfig.client.json']);
    });
  });

  it('propagates an error thrown by the tsc build step', async () => {
    vi.mocked(runProjectBin).mockRejectedValue(new Error('tsc failed'));
    await expect(Build.run([], ROOT)).rejects.toThrow('tsc failed');
  });

  it('propagates an error thrown by the vite build step', async () => {
    vi.mocked(detectReact).mockResolvedValue(true);
    vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
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
