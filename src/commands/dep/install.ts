///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { Command } from '@oclif/core';
import { detectPackageManager, runInstall } from '../../lib/project.js';

export default class DepInstall extends Command {
  static override description = 'Installs the project\'s dependencies (equivalent to `yarn install` / `npm install`).';

  static override examples = ['<%= config.bin %> <%= command.id %>'];

  async run(): Promise<void> {
    const cwd = process.cwd();
    const pkgMgr = await detectPackageManager(cwd);

    this.log(`Installing dependencies (${pkgMgr})...`);
    try {
      await runInstall(cwd, pkgMgr);
    } catch (e) {
      this.error(e instanceof Error ? e.message : String(e));
    }
  }
}
