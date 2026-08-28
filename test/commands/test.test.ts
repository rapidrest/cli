///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/project.js', () => ({
  runProjectBin: vi.fn(),
}));

import { runProjectBin } from '../../src/lib/project.js';
import Test from '../../src/commands/test.js';

const ROOT = process.cwd();

describe('test', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runProjectBin).mockResolvedValue(undefined);
  });

  it('runs `vitest run` by default (no coverage, no watch)', async () => {
    await Test.run([], ROOT);
    expect(runProjectBin).toHaveBeenCalledWith(process.cwd(), 'vitest', ['run']);
  });

  it('adds --coverage when --coverage is set', async () => {
    await Test.run(['--coverage'], ROOT);
    expect(runProjectBin).toHaveBeenCalledWith(process.cwd(), 'vitest', ['run', '--coverage']);
  });

  it('drops "run" (watch mode) when --watch is set', async () => {
    await Test.run(['--watch'], ROOT);
    expect(runProjectBin).toHaveBeenCalledWith(process.cwd(), 'vitest', []);
  });

  it('combines --watch and --coverage', async () => {
    await Test.run(['--watch', '--coverage'], ROOT);
    expect(runProjectBin).toHaveBeenCalledWith(process.cwd(), 'vitest', ['--coverage']);
  });

  it('passes extra positional args (e.g. a test file path) through to vitest', async () => {
    await Test.run(['src/routes/HelloRoute.test.ts'], ROOT);
    expect(runProjectBin).toHaveBeenCalledWith(process.cwd(), 'vitest', ['run', 'src/routes/HelloRoute.test.ts']);
  });

  it('appends extra positional args after flags in watch+coverage mode', async () => {
    await Test.run(['--watch', '--coverage', 'src/foo.test.ts'], ROOT);
    expect(runProjectBin).toHaveBeenCalledWith(process.cwd(), 'vitest', ['--coverage', 'src/foo.test.ts']);
  });

  it('propagates an error from runProjectBin', async () => {
    vi.mocked(runProjectBin).mockRejectedValue(new Error('vitest failed'));
    await expect(Test.run([], ROOT)).rejects.toThrow('vitest failed');
  });

  it('falls back to String(e) when runProjectBin rejects with a non-Error value', async () => {
    vi.mocked(runProjectBin).mockRejectedValue('non-error-boom');
    await expect(Test.run([], ROOT)).rejects.toThrow('non-error-boom');
  });
});
