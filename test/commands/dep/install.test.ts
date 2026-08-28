///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/lib/project.js', () => ({
  detectPackageManager: vi.fn(),
  runInstall: vi.fn(),
}));

import { detectPackageManager, runInstall } from '../../../src/lib/project.js';
import DepInstall from '../../../src/commands/dep/install.js';

const ROOT = process.cwd();

describe('dep install', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(detectPackageManager).mockResolvedValue('npm');
    vi.mocked(runInstall).mockResolvedValue(undefined);
  });

  it('installs with the detected package manager in the current working directory', async () => {
    await DepInstall.run([], ROOT);
    expect(detectPackageManager).toHaveBeenCalledWith(process.cwd());
    expect(runInstall).toHaveBeenCalledWith(process.cwd(), 'npm');
  });

  it('uses yarn when detectPackageManager resolves "yarn"', async () => {
    vi.mocked(detectPackageManager).mockResolvedValue('yarn');
    await DepInstall.run([], ROOT);
    expect(runInstall).toHaveBeenCalledWith(process.cwd(), 'yarn');
  });

  it('propagates an error from runInstall', async () => {
    vi.mocked(runInstall).mockRejectedValue(new Error('install failed'));
    await expect(DepInstall.run([], ROOT)).rejects.toThrow('install failed');
  });

  it('falls back to String(e) when runInstall rejects with a non-Error value', async () => {
    vi.mocked(runInstall).mockRejectedValue('non-error-boom');
    await expect(DepInstall.run([], ROOT)).rejects.toThrow('non-error-boom');
  });
});
