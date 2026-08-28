///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { Command, Flags } from '@oclif/core';
import { join } from 'path';
import { processTemplate } from '../../lib/template.js';
import { installIfPackageJsonChanged, readPackageJsonRaw, readProjectDatastores, readProjectName } from '../../lib/project.js';

export default class GenerateHelm extends Command {
  static override args = {};

  static override description = 'Adds Kubernetes (Helm) support to the current project.';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  static override flags = {
    force: Flags.boolean({ char: 'f', description: 'Overwrite existing files.' }),
    'no-install': Flags.boolean({ description: 'Skip running the package manager install after generating.' }),
    'output-dir': Flags.string({ description: 'Project directory to add Kubernetes (Helm) support to. Defaults to the current working directory.' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(GenerateHelm);
    const cwd = flags['output-dir'] ?? process.cwd();
    const outputDir = cwd;
    const packageJsonBefore = await readPackageJsonRaw(cwd);

    this.log(`Generating Kubernetes (Helm) files...\n`);

    const datastores = await readProjectDatastores(cwd);
    const projectName = await readProjectName(cwd);

    const hasMongoDB = datastores.some((ds) => ds.type === 'mongodb');
    // config.ts stores TypeORM's own driver literal ("postgres"), not the "postgresql" feature name.
    const hasPostgres = datastores.some((ds) => ds.type === 'postgres');
    const hasRedis = datastores.some((ds) => ds.type === 'redis');

    const context: Record<string, unknown> = {
      year: new Date().getFullYear(),
      project_name: projectName,
      datastores,
      hasMongoDB,
      hasPostgres,
      hasRedis,
    };

    const templateDir = join(this.config.root, 'templates', 'helm');

    try {
      await processTemplate(templateDir, outputDir, context, { force: flags.force, projectDir: cwd });
      this.log(`\nKubernetes (Helm) files generated at: ${outputDir}`);

      if (!flags['no-install']) {
        await installIfPackageJsonChanged(cwd, packageJsonBefore, (m) => this.log(m), (m) => this.warn(m));
      }
    } catch (err) {
      this.error(err instanceof Error ? err.message : String(err));
    }
  }
}
