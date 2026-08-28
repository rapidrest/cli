///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/lib/depUpgrade.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/depUpgrade.js')>();
  return {
    ...actual,
    applyUpgradePlan: vi.fn(),
    buildUpgradePlan: vi.fn(),
  };
});

vi.mock('../../../src/lib/project.js', () => ({
  detectPackageManager: vi.fn(),
  readProjectPackageJson: vi.fn(),
  runInstall: vi.fn(),
  writeProjectPackageJson: vi.fn(),
}));

import {
  ALL_DEPENDENCY_SECTIONS,
  DEFAULT_UPGRADE_SECTIONS,
  applyUpgradePlan,
  buildUpgradePlan,
} from '../../../src/lib/depUpgrade.js';
import {
  detectPackageManager,
  readProjectPackageJson,
  runInstall,
  writeProjectPackageJson,
} from '../../../src/lib/project.js';
import DepUpgrade from '../../../src/commands/dep/upgrade.js';

const ROOT = process.cwd();

const PKG_INFO = {
  data: { dependencies: { 'lodash-es': '^4.17.0' } },
  indent: '  ',
};

describe('dep upgrade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readProjectPackageJson).mockResolvedValue(PKG_INFO);
    vi.mocked(buildUpgradePlan).mockResolvedValue({ upgrades: [], skipped: [] });
    vi.mocked(applyUpgradePlan).mockReturnValue(undefined);
    vi.mocked(writeProjectPackageJson).mockResolvedValue(undefined);
    vi.mocked(detectPackageManager).mockResolvedValue('npm');
    vi.mocked(runInstall).mockResolvedValue(undefined);
  });

  it('errors when there is no package.json', async () => {
    vi.mocked(readProjectPackageJson).mockResolvedValue(undefined);
    await expect(DepUpgrade.run([], ROOT)).rejects.toThrow(/No package\.json found/);
  });

  it('scans the default sections (no peerDependencies) when no packages are named', async () => {
    await DepUpgrade.run([], ROOT);
    expect(buildUpgradePlan).toHaveBeenCalledWith(PKG_INFO.data, [], { sections: DEFAULT_UPGRADE_SECTIONS });
  });

  it('includes peerDependencies when --peer is set with no packages named', async () => {
    await DepUpgrade.run(['--peer'], ROOT);
    expect(buildUpgradePlan).toHaveBeenCalledWith(PKG_INFO.data, [], { sections: ALL_DEPENDENCY_SECTIONS });
  });

  it('passes --exclude through to buildUpgradePlan', async () => {
    await DepUpgrade.run(['--exclude', 'typescript', '--exclude', 'eslint'], ROOT);
    expect(buildUpgradePlan).toHaveBeenCalledWith(
      PKG_INFO.data,
      [],
      { sections: DEFAULT_UPGRADE_SECTIONS, exclude: ['typescript', 'eslint'] },
    );
  });

  it('parses requested package specs and always searches every section for them', async () => {
    await DepUpgrade.run(['lodash-es', 'axios@1.19.0', '@rapidrest/core:5.2.0'], ROOT);
    expect(buildUpgradePlan).toHaveBeenCalledWith(
      PKG_INFO.data,
      [
        { name: 'lodash-es' },
        { name: 'axios', pinnedVersion: '1.19.0' },
        { name: '@rapidrest/core', pinnedVersion: '5.2.0' },
      ],
      { sections: ALL_DEPENDENCY_SECTIONS },
    );
  });

  it('warns for every skipped package', async () => {
    vi.mocked(buildUpgradePlan).mockResolvedValue({
      upgrades: [],
      skipped: [{ name: 'foo', reason: 'not a dependency of this project' }],
    });
    const warnSpy = vi.spyOn(DepUpgrade.prototype, 'warn').mockImplementation(() => undefined as never);

    await DepUpgrade.run(['foo'], ROOT);

    expect(warnSpy).toHaveBeenCalledWith('foo: not a dependency of this project');
    warnSpy.mockRestore();
  });

  it('does nothing further when there is nothing to upgrade', async () => {
    await DepUpgrade.run([], ROOT);
    expect(applyUpgradePlan).not.toHaveBeenCalled();
    expect(writeProjectPackageJson).not.toHaveBeenCalled();
    expect(runInstall).not.toHaveBeenCalled();
  });

  describe('with upgrades available', () => {
    const plan = {
      upgrades: [
        { name: 'lodash-es', section: 'dependencies' as const, currentSpec: '^4.17.0', newSpec: '^4.17.21', pinned: false },
      ],
      skipped: [],
    };

    beforeEach(() => {
      vi.mocked(buildUpgradePlan).mockResolvedValue(plan);
    });

    it('applies the plan, writes package.json, and installs by default', async () => {
      await DepUpgrade.run([], ROOT);

      expect(applyUpgradePlan).toHaveBeenCalledWith(PKG_INFO.data, plan.upgrades);
      expect(writeProjectPackageJson).toHaveBeenCalledWith(process.cwd(), PKG_INFO.data, PKG_INFO.indent);
      expect(detectPackageManager).toHaveBeenCalledWith(process.cwd());
      expect(runInstall).toHaveBeenCalledWith(process.cwd(), 'npm');
    });

    it('does not mutate anything on --dry-run', async () => {
      await DepUpgrade.run(['--dry-run'], ROOT);

      expect(applyUpgradePlan).not.toHaveBeenCalled();
      expect(writeProjectPackageJson).not.toHaveBeenCalled();
      expect(runInstall).not.toHaveBeenCalled();
    });

    it('skips the install when --no-install is set', async () => {
      await DepUpgrade.run(['--no-install'], ROOT);

      expect(writeProjectPackageJson).toHaveBeenCalled();
      expect(runInstall).not.toHaveBeenCalled();
    });

    it('propagates an error from runInstall', async () => {
      vi.mocked(runInstall).mockRejectedValue(new Error('install failed'));
      await expect(DepUpgrade.run([], ROOT)).rejects.toThrow('install failed');
    });

    it('falls back to String(e) when runInstall rejects with a non-Error value', async () => {
      vi.mocked(runInstall).mockRejectedValue('non-error-boom');
      await expect(DepUpgrade.run([], ROOT)).rejects.toThrow('non-error-boom');
    });
  });
});
