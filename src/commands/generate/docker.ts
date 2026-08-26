///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { Command, Flags } from '@oclif/core';
import { join } from 'path';
import { processTemplate } from '../../lib/template.js';
import { detectPackageManager, detectReact, readProjectDatastores, readProjectName } from '../../lib/project.js';

export default class GenerateDocker extends Command {
  static override args = {};

  static override description = 'Adds Docker support to the current project.';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
  ];

  static override flags = {
    force: Flags.boolean({ char: 'f', description: 'Overwrite existing files.' }),
    'output-dir': Flags.string({ description: 'Project directory to add Docker support to. Defaults to the current working directory.' }),
    // Undefined (the default) falls back to filesystem detection (detectReact) - correct for a
    // standalone `generate docker` run against an already-existing project. `generate server` passes
    // this explicitly instead, because it runs docker generation *before* react generation (so
    // detectReact(cwd) would still see no vite.config.ts yet, even when --react was requested for the
    // same combined scaffold).
    'has-react': Flags.boolean({ allowNo: true, description: 'Whether the project includes a React app (affects which directories the Dockerfile copies). Defaults to auto-detecting an existing project.' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(GenerateDocker);
    const cwd = flags['output-dir'] ?? process.cwd();
    const outputDir = cwd;

    this.log(`Generating Docker files...\n`);

    const [datastores, projectName, pkgManager, detectedReact] = await Promise.all([
      readProjectDatastores(cwd),
      readProjectName(cwd),
      detectPackageManager(cwd),
      detectReact(cwd),
    ]);
    const hasReact = flags['has-react'] ?? detectedReact;

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
      hasReact,
      pkgMgr: {
        yarn: pkgManager === 'yarn',
        npm: pkgManager === 'npm',
      },
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
