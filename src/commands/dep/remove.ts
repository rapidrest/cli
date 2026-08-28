///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { Command } from '@oclif/core';
import { detectPackageManager, removePackages } from '../../lib/project.js';

export default class DepRemove extends Command {
  static override description = 'Removes one or more dependencies from the project (equivalent to `yarn remove` / `npm uninstall`).';

  static override examples = [
    '<%= config.bin %> <%= command.id %> lodash-es',
    '<%= config.bin %> <%= command.id %> axios lodash-es',
  ];

  // Allows any number of package name args (e.g. "lodash-es axios").
  static override strict = false;

  async run(): Promise<void> {
    const { argv } = await this.parse(DepRemove);
    const packages = argv as string[];

    if (packages.length === 0) {
      this.error('At least one package name is required (e.g. `rapidrest dep remove lodash-es`).');
    }

    const cwd = process.cwd();
    const pkgMgr = await detectPackageManager(cwd);

    this.log(`Removing ${packages.join(', ')} (${pkgMgr})...`);
    try {
      await removePackages(cwd, pkgMgr, packages);
    } catch (e) {
      this.error(e instanceof Error ? e.message : String(e));
    }
  }
}
