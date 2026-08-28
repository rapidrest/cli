///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { Command, Flags } from '@oclif/core';
import { addPackages, detectPackageManager } from '../../lib/project.js';

export default class DepAdd extends Command {
  static override description = 'Adds one or more dependencies to the project (equivalent to `yarn add` / `npm install <pkg>`).';

  static override examples = [
    '<%= config.bin %> <%= command.id %> lodash-es',
    '<%= config.bin %> <%= command.id %> axios@1.19.0',
    '<%= config.bin %> <%= command.id %> vitest --dev',
  ];

  // Allows any number of package name args (e.g. "lodash-es axios@1.19.0").
  static override strict = false;

  static override flags = {
    dev: Flags.boolean({ char: 'D', default: false, description: 'Add as a devDependency instead of a dependency.' }),
  };

  async run(): Promise<void> {
    const { flags, argv } = await this.parse(DepAdd);
    const packages = argv as string[];

    if (packages.length === 0) {
      this.error('At least one package name is required (e.g. `rapidrest dep add lodash-es`).');
    }

    const cwd = process.cwd();
    const pkgMgr = await detectPackageManager(cwd);

    this.log(`Adding ${packages.join(', ')} (${pkgMgr}${flags.dev ? ', dev' : ''})...`);
    try {
      await addPackages(cwd, pkgMgr, packages, { dev: flags.dev });
    } catch (e) {
      this.error(e instanceof Error ? e.message : String(e));
    }
  }
}
