import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Config } from '@oclif/core';

vi.mock('../../src/lib/project.js', () => ({
  detectPackageManager: vi.fn(),
}));

import { detectPackageManager } from '../../src/lib/project.js';
import Build from '../../src/commands/build.js';

const ROOT = process.cwd();

describe('build', () => {
  let runCommandSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    runCommandSpy = vi.spyOn(Config.prototype, 'runCommand').mockResolvedValue(undefined);
  });

  afterEach(() => {
    runCommandSpy.mockRestore();
  });

  it('runs "npm run build" when detectPackageManager resolves "npm"', async () => {
    vi.mocked(detectPackageManager).mockResolvedValue('npm');

    await Build.run([], ROOT);

    expect(runCommandSpy).toHaveBeenCalledWith('npm', ['run', 'build']);
  });

  it('runs "yarn build" when detectPackageManager resolves "yarn"', async () => {
    vi.mocked(detectPackageManager).mockResolvedValue('yarn');

    await Build.run([], ROOT);

    expect(runCommandSpy).toHaveBeenCalledWith('yarn', ['build']);
  });

  it('calls detectPackageManager with the current working directory', async () => {
    vi.mocked(detectPackageManager).mockResolvedValue('npm');

    await Build.run([], ROOT);

    expect(detectPackageManager).toHaveBeenCalledWith(process.cwd());
  });

  it('propagates an error thrown by config.runCommand', async () => {
    vi.mocked(detectPackageManager).mockResolvedValue('npm');
    runCommandSpy.mockRejectedValue(new Error('build failed'));

    await expect(Build.run([], ROOT)).rejects.toThrow('build failed');
  });
});
