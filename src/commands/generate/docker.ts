import { Command, Flags } from '@oclif/core';
import { join } from 'path';
import { processTemplate } from '../../lib/template.js';
import { readProjectDatastores, readProjectName } from '../../lib/project.js';

export default class GenerateDocker extends Command {
  static override args = {};

  static override description = 'Adds Docker support to the current project.';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  static override flags = {
    force: Flags.boolean({ char: 'f', description: 'Overwrite existing files.' }),
    'output-dir': Flags.string({ description: 'Project directory to add Docker support to. Defaults to the current working directory.' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(GenerateDocker);
    const cwd = flags['output-dir'] ?? process.cwd();
    const outputDir = cwd;

    this.log(`Generating docker files...\n`);

    const datastores = await readProjectDatastores(cwd);
    const projectName = await readProjectName(cwd);

    const hasMongoDB = datastores.some((ds) => ds.type === 'mongodb');
    const hasPostgres = datastores.some((ds) => ds.type === 'postgresql');
    const hasRedis = datastores.some((ds) => ds.type === 'redis');

    const context: Record<string, unknown> = {
      year: new Date().getFullYear(),
      project_name: projectName,
      datastores,
      hasMongoDB,
      hasPostgres,
      hasRedis,
    };

    const templateDir = join(this.config.root, 'templates', 'docker');

    try {
      await processTemplate(templateDir, outputDir, context, { force: flags.force, projectDir: cwd });
      this.log(`\nDocker files generated at: ${outputDir}`);
    } catch (err) {
      this.error(err instanceof Error ? err.message : String(err));
    }
  }
}
