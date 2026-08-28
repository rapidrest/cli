///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/lib/project.js', () => ({
  detectPackageManager: vi.fn(),
  removePackages: vi.fn(),
}));

import { detectPackageManager, removePackages } from '../../../src/lib/project.js';
import DepRemove from '../../../src/commands/dep/remove.js';

const ROOT = process.cwd();

describe('dep remove', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(detectPackageManager).mockResolvedValue('npm');
    vi.mocked(removePackages).mockResolvedValue(undefined);
  });

  it('removes a single package', async () => {
    await DepRemove.run(['lodash-es'], ROOT);
    expect(removePackages).toHaveBeenCalledWith(process.cwd(), 'npm', ['lodash-es']);
  });

  it('removes multiple packages in one call', async () => {
    await DepRemove.run(['axios', 'lodash-es'], ROOT);
    expect(removePackages).toHaveBeenCalledWith(process.cwd(), 'npm', ['axios', 'lodash-es']);
  });

  it('uses the detected package manager', async () => {
    vi.mocked(detectPackageManager).mockResolvedValue('yarn');
    await DepRemove.run(['axios'], ROOT);
    expect(removePackages).toHaveBeenCalledWith(process.cwd(), 'yarn', ['axios']);
  });

  it('errors and does not call removePackages when no package name is given', async () => {
    await expect(DepRemove.run([], ROOT)).rejects.toThrow(/At least one package name is required/);
    expect(removePackages).not.toHaveBeenCalled();
  });

  it('propagates an error from removePackages', async () => {
    vi.mocked(removePackages).mockRejectedValue(new Error('remove failed'));
    await expect(DepRemove.run(['axios'], ROOT)).rejects.toThrow('remove failed');
  });

  it('falls back to String(e) when removePackages rejects with a non-Error value', async () => {
    vi.mocked(removePackages).mockRejectedValue('non-error-boom');
    await expect(DepRemove.run(['axios'], ROOT)).rejects.toThrow('non-error-boom');
  });
});
