///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';

vi.mock('../../src/lib/upgrade.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/upgrade.js')>();
  return { ...actual, planUpgrade: vi.fn(), applyUpgrade: vi.fn() };
});

import { planUpgrade, applyUpgrade, UpgradePlan } from '../../src/lib/upgrade.js';
import Upgrade from '../../src/commands/upgrade.js';

const ROOT = process.cwd();

function emptyPlan(): UpgradePlan {
  return { fileChanges: [], dependencyChanges: [] };
}

describe('upgrade', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(Upgrade.prototype, 'log').mockImplementation(() => undefined);
    vi.mocked(applyUpgrade).mockResolvedValue(undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('calls planUpgrade with the current working directory and the CLI templates dir', async () => {
    vi.mocked(planUpgrade).mockResolvedValue(emptyPlan());

    await Upgrade.run([], ROOT);

    expect(planUpgrade).toHaveBeenCalledWith({ cwd: process.cwd(), templatesDir: join(ROOT, 'templates') });
  });

  it('reports "Already up to date." when there is nothing to change', async () => {
    vi.mocked(planUpgrade).mockResolvedValue(emptyPlan());

    await Upgrade.run([], ROOT);

    expect(logSpy).toHaveBeenCalledWith('Already up to date.');
  });

  it('does not call applyUpgrade without --write', async () => {
    vi.mocked(planUpgrade).mockResolvedValue({
      fileChanges: [{ relPath: 'eslint.config.mjs', templateDir: 'server', content: 'x' }],
      dependencyChanges: [],
    });

    await Upgrade.run([], ROOT);

    expect(applyUpgrade).not.toHaveBeenCalled();
  });

  it('lists file changes and says "Would update" without --write', async () => {
    vi.mocked(planUpgrade).mockResolvedValue({
      fileChanges: [{ relPath: 'eslint.config.mjs', templateDir: 'server', content: 'x' }],
      dependencyChanges: [],
    });

    await Upgrade.run([], ROOT);

    const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('Would update 1 file(s):');
    expect(output).toContain('eslint.config.mjs');
    expect(output).toContain('Run with --write to apply.');
  });

  it('lists dependency changes with from -> to', async () => {
    vi.mocked(planUpgrade).mockResolvedValue({
      fileChanges: [],
      dependencyChanges: [{ section: 'dependencies', name: '@rapidrest/core', from: '^4.0.0', to: '^5.1.0' }],
    });

    await Upgrade.run([], ROOT);

    const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('Would update 1 dependency version(s):');
    expect(output).toContain('@rapidrest/core: ^4.0.0 -> ^5.1.0');
  });

  it('shows "(missing)" for a newly-added dependency with no prior version', async () => {
    vi.mocked(planUpgrade).mockResolvedValue({
      fileChanges: [],
      dependencyChanges: [{ section: 'dependencies', name: 'typeorm', from: undefined, to: '^1.1.0' }],
    });

    await Upgrade.run([], ROOT);

    const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('typeorm: (missing) -> ^1.1.0');
  });

  describe('--write', () => {
    it('calls applyUpgrade with the plan from planUpgrade', async () => {
      const plan: UpgradePlan = {
        fileChanges: [{ relPath: 'eslint.config.mjs', templateDir: 'server', content: 'x' }],
        dependencyChanges: [],
      };
      vi.mocked(planUpgrade).mockResolvedValue(plan);

      await Upgrade.run(['--write'], ROOT);

      expect(applyUpgrade).toHaveBeenCalledWith({ cwd: process.cwd(), templatesDir: join(ROOT, 'templates') }, plan);
    });

    it('says "Updated" instead of "Would update", and does not prompt to run --write', async () => {
      vi.mocked(planUpgrade).mockResolvedValue({
        fileChanges: [{ relPath: 'eslint.config.mjs', templateDir: 'server', content: 'x' }],
        dependencyChanges: [],
      });

      await Upgrade.run(['--write'], ROOT);

      const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(output).toContain('Updated 1 file(s):');
      expect(output).not.toContain('Run with --write to apply.');
    });

    it('still reports "Already up to date." with --write when there is nothing to change', async () => {
      vi.mocked(planUpgrade).mockResolvedValue(emptyPlan());

      await Upgrade.run(['--write'], ROOT);

      expect(applyUpgrade).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith('Already up to date.');
    });
  });

  describe('--json', () => {
    it('prints a JSON report and does not print the plain-text report', async () => {
      vi.mocked(planUpgrade).mockResolvedValue({
        fileChanges: [{ relPath: 'eslint.config.mjs', templateDir: 'server', content: 'full rendered content' }],
        dependencyChanges: [{ section: 'dependencies', name: 'typeorm', from: undefined, to: '^1.1.0' }],
      });

      await Upgrade.run(['--json'], ROOT);

      expect(logSpy).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
      expect(parsed.applied).toBe(false);
      expect(parsed.fileChanges).toEqual([{ relPath: 'eslint.config.mjs', templateDir: 'server' }]);
      expect(parsed.dependencyChanges).toHaveLength(1);
    });

    it('does not leak full file content into the JSON report', async () => {
      vi.mocked(planUpgrade).mockResolvedValue({
        fileChanges: [{ relPath: 'eslint.config.mjs', templateDir: 'server', content: 'full rendered content' }],
        dependencyChanges: [],
      });

      await Upgrade.run(['--json'], ROOT);

      const output = logSpy.mock.calls[0][0] as string;
      expect(output).not.toContain('full rendered content');
    });

    it('reports applied: true when --write is passed and there are changes', async () => {
      vi.mocked(planUpgrade).mockResolvedValue({
        fileChanges: [{ relPath: 'eslint.config.mjs', templateDir: 'server', content: 'x' }],
        dependencyChanges: [],
      });

      await Upgrade.run(['--json', '--write'], ROOT);

      const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
      expect(parsed.applied).toBe(true);
    });

    it('reports applied: false when --write is passed but there is nothing to change', async () => {
      vi.mocked(planUpgrade).mockResolvedValue(emptyPlan());

      await Upgrade.run(['--json', '--write'], ROOT);

      const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
      expect(parsed.applied).toBe(false);
    });
  });
});
