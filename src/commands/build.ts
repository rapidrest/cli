import { Command } from '@oclif/core';
import { detectPackageManager } from '../lib/project.js';

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
