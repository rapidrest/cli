///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/release.js', () => ({
  RELEASE_TYPES: ['major', 'minor', 'patch', 'premajor', 'preminor', 'prepatch', 'prerelease'],
  assertCleanWorkingTree: vi.fn(),
  bumpPackageVersion: vi.fn(),
  computeNewVersion: vi.fn(),
  detectHelm: vi.fn(),
  hasUnreleasedSection: vi.fn(),
  pushRelease: vi.fn(),
  readPackageInfo: vi.fn(),
  stageAndCommit: vi.fn(),
  updateChangelog: vi.fn(),
  updateHelmVersion: vi.fn(),
  updateReleaseNotes: vi.fn(),
  validateHelmFiles: vi.fn(),
}));

import {
  assertCleanWorkingTree,
  bumpPackageVersion,
  computeNewVersion,
  detectHelm,
  hasUnreleasedSection,
  pushRelease,
  readPackageInfo,
  stageAndCommit,
  updateChangelog,
  updateHelmVersion,
  updateReleaseNotes,
  validateHelmFiles,
} from '../../src/lib/release.js';
import Release from '../../src/commands/release.js';

const ROOT = process.cwd();

describe('release', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readPackageInfo).mockResolvedValue({ version: '1.2.3' });
    vi.mocked(computeNewVersion).mockReturnValue('1.2.4');
    vi.mocked(hasUnreleasedSection).mockResolvedValue(true);
    vi.mocked(detectHelm).mockResolvedValue(false);
    vi.mocked(assertCleanWorkingTree).mockResolvedValue(undefined);
    vi.mocked(bumpPackageVersion).mockResolvedValue(undefined);
    vi.mocked(updateReleaseNotes).mockResolvedValue(undefined);
    vi.mocked(updateChangelog).mockResolvedValue(undefined);
    vi.mocked(updateHelmVersion).mockResolvedValue([]);
    vi.mocked(validateHelmFiles).mockResolvedValue(undefined);
    vi.mocked(stageAndCommit).mockResolvedValue(undefined);
    vi.mocked(pushRelease).mockResolvedValue(undefined);
  });

  it('runs the full release flow in order and pushes by default', async () => {
    await Release.run(['patch'], ROOT);

    expect(computeNewVersion).toHaveBeenCalledWith('1.2.3', 'patch', undefined);
    expect(assertCleanWorkingTree).toHaveBeenCalledWith(process.cwd());
    expect(bumpPackageVersion).toHaveBeenCalledWith(process.cwd(), '1.2.4');
    expect(updateReleaseNotes).toHaveBeenCalledWith(process.cwd(), '1.2.4');
    expect(updateChangelog).toHaveBeenCalledWith(process.cwd(), '1.2.4', expect.any(Function));
    expect(updateHelmVersion).not.toHaveBeenCalled();
    expect(stageAndCommit).toHaveBeenCalledWith(process.cwd(), '1.2.4', []);
    expect(pushRelease).toHaveBeenCalledWith(process.cwd());
  });

  it('passes --preid through to computeNewVersion', async () => {
    await Release.run(['prerelease', '--preid', 'rc'], ROOT);
    expect(computeNewVersion).toHaveBeenCalledWith('1.2.3', 'prerelease', 'rc');
  });

  it('skips push and does not call pushRelease when --no-push is set', async () => {
    await Release.run(['patch', '--no-push'], ROOT);
    expect(stageAndCommit).toHaveBeenCalled();
    expect(pushRelease).not.toHaveBeenCalled();
  });

  it('does not mutate anything on --dry-run', async () => {
    await Release.run(['patch', '--dry-run'], ROOT);

    expect(assertCleanWorkingTree).not.toHaveBeenCalled();
    expect(bumpPackageVersion).not.toHaveBeenCalled();
    expect(updateReleaseNotes).not.toHaveBeenCalled();
    expect(updateChangelog).not.toHaveBeenCalled();
    expect(stageAndCommit).not.toHaveBeenCalled();
    expect(pushRelease).not.toHaveBeenCalled();
  });

  it('still validates on --dry-run and errors if there is no Unreleased section', async () => {
    vi.mocked(hasUnreleasedSection).mockResolvedValue(false);
    await expect(Release.run(['patch', '--dry-run'], ROOT)).rejects.toThrow(/Unreleased/);
  });

  describe('Helm detection', () => {
    it('updates Helm files and stages them when a Helm chart is present', async () => {
      vi.mocked(detectHelm).mockResolvedValue(true);
      vi.mocked(updateHelmVersion).mockResolvedValue(['helm/values.yaml', 'helm/Chart.yaml']);

      await Release.run(['patch'], ROOT);

      expect(validateHelmFiles).toHaveBeenCalledWith(process.cwd());
      expect(updateHelmVersion).toHaveBeenCalledWith(process.cwd(), '1.2.4');
      expect(stageAndCommit).toHaveBeenCalledWith(process.cwd(), '1.2.4', ['helm/values.yaml', 'helm/Chart.yaml']);
    });

    it('does not call validateHelmFiles or updateHelmVersion when no Helm chart is present', async () => {
      await Release.run(['patch'], ROOT);
      expect(validateHelmFiles).not.toHaveBeenCalled();
      expect(updateHelmVersion).not.toHaveBeenCalled();
    });

    it('errors before any mutation when the Helm chart is malformed', async () => {
      vi.mocked(detectHelm).mockResolvedValue(true);
      vi.mocked(validateHelmFiles).mockRejectedValue(new Error('helm/values.yaml does not have the expected field'));

      await expect(Release.run(['patch'], ROOT)).rejects.toThrow(/does not have the expected field/);
      expect(bumpPackageVersion).not.toHaveBeenCalled();
    });
  });

  describe('pre-flight failures', () => {
    it('errors and never mutates when there is no Unreleased section', async () => {
      vi.mocked(hasUnreleasedSection).mockResolvedValue(false);

      await expect(Release.run(['patch'], ROOT)).rejects.toThrow(/Unreleased/);
      expect(assertCleanWorkingTree).not.toHaveBeenCalled();
      expect(bumpPackageVersion).not.toHaveBeenCalled();
    });

    it('errors and never mutates when the working tree is dirty', async () => {
      vi.mocked(assertCleanWorkingTree).mockRejectedValue(new Error('Working tree is not clean.'));

      await expect(Release.run(['patch'], ROOT)).rejects.toThrow(/not clean/);
      expect(bumpPackageVersion).not.toHaveBeenCalled();
    });

    it('errors when computeNewVersion rejects the given bump, without checking Unreleased/Helm', async () => {
      vi.mocked(computeNewVersion).mockImplementation(() => {
        throw new Error('"sideways" is not a valid release strategy or semver version.');
      });

      await expect(Release.run(['sideways'], ROOT)).rejects.toThrow(/not a valid release strategy/);
      expect(hasUnreleasedSection).not.toHaveBeenCalled();
      expect(detectHelm).not.toHaveBeenCalled();
    });
  });

  it('reports partial-modification guidance when a mutation step fails', async () => {
    vi.mocked(updateChangelog).mockRejectedValue(new Error('git log failed'));

    await expect(Release.run(['patch'], ROOT)).rejects.toThrow(/partially modified/);
  });
});
