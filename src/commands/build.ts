import { Command } from '@oclif/core';

export default class Build extends Command {
  static override description = 'Builds the RapidREST server project in the current directory.';

  static override examples = ['<%= config.bin %> <%= command.id %>'];

  async run(): Promise<void> {
    this.log('Building RapidREST server...');
    await this.config.runCommand('yarn', ['build']);
  }
}
