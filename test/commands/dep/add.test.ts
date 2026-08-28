///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/lib/project.js', () => ({
  addPackages: vi.fn(),
  detectPackageManager: vi.fn(),
}));

import { addPackages, detectPackageManager } from '../../../src/lib/project.js';
import DepAdd from '../../../src/commands/dep/add.js';

const ROOT = process.cwd();

describe('dep add', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(detectPackageManager).mockResolvedValue('npm');
    vi.mocked(addPackages).mockResolvedValue(undefined);
  });

  it('adds a single package as a regular dependency by default', async () => {
    await DepAdd.run(['lodash-es'], ROOT);
    expect(addPackages).toHaveBeenCalledWith(process.cwd(), 'npm', ['lodash-es'], { dev: false });
  });

  it('adds multiple packages in one call', async () => {
    await DepAdd.run(['axios', 'lodash-es@4.17.0'], ROOT);
    expect(addPackages).toHaveBeenCalledWith(process.cwd(), 'npm', ['axios', 'lodash-es@4.17.0'], { dev: false });
  });

  it('passes dev: true when --dev is set', async () => {
    await DepAdd.run(['vitest', '--dev'], ROOT);
    expect(addPackages).toHaveBeenCalledWith(process.cwd(), 'npm', ['vitest'], { dev: true });
  });

  it('passes dev: true when -D is set', async () => {
    await DepAdd.run(['vitest', '-D'], ROOT);
    expect(addPackages).toHaveBeenCalledWith(process.cwd(), 'npm', ['vitest'], { dev: true });
  });

  it('uses the detected package manager', async () => {
    vi.mocked(detectPackageManager).mockResolvedValue('yarn');
    await DepAdd.run(['axios'], ROOT);
    expect(addPackages).toHaveBeenCalledWith(process.cwd(), 'yarn', ['axios'], { dev: false });
  });

  it('errors and does not call addPackages when no package name is given', async () => {
    await expect(DepAdd.run([], ROOT)).rejects.toThrow(/At least one package name is required/);
    expect(addPackages).not.toHaveBeenCalled();
  });

  it('propagates an error from addPackages', async () => {
    vi.mocked(addPackages).mockRejectedValue(new Error('add failed'));
    await expect(DepAdd.run(['axios'], ROOT)).rejects.toThrow('add failed');
  });

  it('falls back to String(e) when addPackages rejects with a non-Error value', async () => {
    vi.mocked(addPackages).mockRejectedValue('non-error-boom');
    await expect(DepAdd.run(['axios'], ROOT)).rejects.toThrow('non-error-boom');
  });
});
