import { Command } from '@oclif/core';
import { join } from 'path';
import { access, readFile } from 'fs/promises';

async function detectPackageManager(cwd: string): Promise<'npm' | 'yarn'> {
  try {
    const raw = await readFile(join(cwd, 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw) as { packageManager?: string };
    if (pkg.packageManager?.startsWith('yarn')) return 'yarn';
  } catch { /* ignore */ }
  try {
    await access(join(cwd, 'yarn.lock'));
    return 'yarn';
  } catch { /* ignore */ }
  return 'npm';
}

export default class Build extends Command {
  static override description = 'Builds the RapidREST server project in the current directory.';

  static override examples = ['<%= config.bin %> <%= command.id %>'];

  async run(): Promise<void> {
    const cwd = process.cwd();
    const pkgMgr = await detectPackageManager(cwd);
    this.log('Building RapidREST server...');
    const args = pkgMgr === 'yarn' ? ['build'] : ['run', 'build'];
    await this.config.runCommand(pkgMgr, args);
  }
}
