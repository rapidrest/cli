///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';

vi.mock('../../src/lib/doctor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/doctor.js')>();
  return { ...actual, runDoctor: vi.fn(), applyFixes: vi.fn() };
});

import { runDoctor, applyFixes, Finding } from '../../src/lib/doctor.js';
import Doctor from '../../src/commands/doctor.js';

const ROOT = process.cwd();

function errorFinding(overrides: Partial<Finding> = {}): Finding {
  return { id: 'some-error', severity: 'error', message: 'Something is broken.', ...overrides };
}

function warningFinding(overrides: Partial<Finding> = {}): Finding {
  return { id: 'some-warning', severity: 'warning', message: 'Something is off.', ...overrides };
}

describe('doctor', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(Doctor.prototype, 'log').mockImplementation(() => undefined);
    vi.mocked(applyFixes).mockResolvedValue({ fixed: [], skipped: [] });
  });

  afterEach(() => {
    logSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('calls runDoctor with the current working directory and the CLI templates dir', async () => {
    vi.mocked(runDoctor).mockResolvedValue([]);

    await Doctor.run([], ROOT);

    expect(runDoctor).toHaveBeenCalledWith({ cwd: process.cwd(), templatesDir: join(ROOT, 'templates') });
  });

  it('reports "No issues found." when there are no findings', async () => {
    vi.mocked(runDoctor).mockResolvedValue([]);

    await Doctor.run([], ROOT);

    expect(logSpy).toHaveBeenCalledWith('No issues found.');
  });

  it('does not exit with an error code when there are no findings', async () => {
    vi.mocked(runDoctor).mockResolvedValue([]);
    await expect(Doctor.run([], ROOT)).resolves.toBeUndefined();
  });

  it('lists errors and warnings separately', async () => {
    vi.mocked(runDoctor).mockResolvedValue([errorFinding({ message: 'boom' }), warningFinding({ message: 'meh' })]);

    await expect(Doctor.run([], ROOT)).rejects.toThrow();

    const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('1 error(s):');
    expect(output).toContain('boom');
    expect(output).toContain('1 warning(s):');
    expect(output).toContain('meh');
  });

  it('includes the file path in listed findings when present', async () => {
    vi.mocked(runDoctor).mockResolvedValue([
      errorFinding({ message: 'boom', file: 'src/config.ts' }),
      warningFinding({ message: 'meh', file: 'src/models/Widget.ts' }),
    ]);

    await expect(Doctor.run([], ROOT)).rejects.toThrow();

    const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('src/config.ts: boom');
    expect(output).toContain('src/models/Widget.ts: meh');
  });

  it('includes the file path for fixed findings when present', async () => {
    vi.mocked(runDoctor).mockResolvedValueOnce([errorFinding({ message: 'fix me', file: 'src/config.ts' })]).mockResolvedValueOnce([]);
    vi.mocked(applyFixes).mockResolvedValue({ fixed: [errorFinding({ message: 'fix me', file: 'src/config.ts' })], skipped: [] });

    await Doctor.run(['--fix'], ROOT);

    const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('src/config.ts: fix me');
  });

  it('exits with code 1 when an error-severity finding remains', async () => {
    vi.mocked(runDoctor).mockResolvedValue([errorFinding()]);

    await expect(Doctor.run([], ROOT)).rejects.toMatchObject({ oclif: { exit: 1 } });
  });

  it('does not exit with an error code when only warnings remain', async () => {
    vi.mocked(runDoctor).mockResolvedValue([warningFinding()]);
    await expect(Doctor.run([], ROOT)).resolves.toBeUndefined();
  });

  it('mentions that fixable issues can be resolved with --fix when not already fixing', async () => {
    vi.mocked(runDoctor).mockResolvedValue([errorFinding({ fix: async () => undefined })]);

    await expect(Doctor.run([], ROOT)).rejects.toThrow();

    const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('Run with --fix to apply them.');
  });

  describe('--fix', () => {
    it('calls applyFixes with the findings from the first run', async () => {
      const findings = [errorFinding()];
      vi.mocked(runDoctor).mockResolvedValue(findings);

      await expect(Doctor.run(['--fix'], ROOT)).rejects.toThrow();

      expect(applyFixes).toHaveBeenCalledWith(findings);
    });

    it('re-runs the checks after fixes are applied', async () => {
      vi.mocked(runDoctor).mockResolvedValueOnce([errorFinding()]).mockResolvedValueOnce([]);
      vi.mocked(applyFixes).mockResolvedValue({ fixed: [errorFinding()], skipped: [] });

      await Doctor.run(['--fix'], ROOT);

      expect(runDoctor).toHaveBeenCalledTimes(2);
    });

    it('does not re-run the checks when nothing was fixed', async () => {
      vi.mocked(runDoctor).mockResolvedValue([warningFinding()]);
      vi.mocked(applyFixes).mockResolvedValue({ fixed: [], skipped: [warningFinding()] });

      await Doctor.run(['--fix'], ROOT);

      expect(runDoctor).toHaveBeenCalledTimes(1);
    });

    it('reports what was fixed', async () => {
      vi.mocked(runDoctor).mockResolvedValueOnce([errorFinding({ message: 'fix me' })]).mockResolvedValueOnce([]);
      vi.mocked(applyFixes).mockResolvedValue({ fixed: [errorFinding({ message: 'fix me' })], skipped: [] });

      await Doctor.run(['--fix'], ROOT);

      const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(output).toContain('Fixed 1 issue(s):');
      expect(output).toContain('fix me');
    });

    it('exits with code 1 if an error-severity finding remains after fixing', async () => {
      vi.mocked(runDoctor)
        .mockResolvedValueOnce([errorFinding(), errorFinding({ id: 'unfixable-error' })])
        .mockResolvedValueOnce([errorFinding({ id: 'unfixable-error' })]);
      vi.mocked(applyFixes).mockResolvedValue({ fixed: [errorFinding()], skipped: [errorFinding({ id: 'unfixable-error' })] });

      await expect(Doctor.run(['--fix'], ROOT)).rejects.toMatchObject({ oclif: { exit: 1 } });
    });
  });

  describe('--json', () => {
    it('prints a JSON report and does not print the plain-text report', async () => {
      vi.mocked(runDoctor).mockResolvedValue([errorFinding()]);

      await expect(Doctor.run(['--json'], ROOT)).rejects.toThrow();

      expect(logSpy).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
      expect(parsed.ok).toBe(false);
      expect(parsed.findings).toHaveLength(1);
    });

    it('reports ok: true when there are no error-severity findings', async () => {
      vi.mocked(runDoctor).mockResolvedValue([warningFinding()]);

      await Doctor.run(['--json'], ROOT);

      const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
      expect(parsed.ok).toBe(true);
    });

    it('includes the ids of fixed findings', async () => {
      vi.mocked(runDoctor).mockResolvedValueOnce([errorFinding()]).mockResolvedValueOnce([]);
      vi.mocked(applyFixes).mockResolvedValue({ fixed: [errorFinding({ id: 'fixed-one' })], skipped: [] });

      await Doctor.run(['--fix', '--json'], ROOT);

      const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
      expect(parsed.fixed).toEqual(['fixed-one']);
    });
  });
});
