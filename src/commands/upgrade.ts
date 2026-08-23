///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { Command, Flags } from '@oclif/core';
import { join } from 'path';
import { applyUpgrade, DependencyChange, FileChange, planUpgrade } from '../lib/upgrade.js';

export default class Upgrade extends Command {
  static override description = 'Refresh an existing RapidREST project\'s generator-owned boilerplate files and dependency versions against the currently installed templates.';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --write',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static override flags = {
    write: Flags.boolean({ description: 'Apply the changes. Without this flag, only reports what would change.', default: false }),
    json: Flags.boolean({ description: 'Output the plan as JSON instead of a formatted report.', default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Upgrade);
    const cwd = process.cwd();
    const ctx = { cwd, templatesDir: join(this.config.root, 'templates') };

    const plan = await planUpgrade(ctx);
    const hasChanges = plan.fileChanges.length > 0 || plan.dependencyChanges.length > 0;

    if (flags.write && hasChanges) {
      await applyUpgrade(ctx, plan);
    }

    if (flags.json) {
      this.log(JSON.stringify({
        applied: flags.write && hasChanges,
        fileChanges: plan.fileChanges.map(({ relPath, templateDir }) => ({ relPath, templateDir })),
        dependencyChanges: plan.dependencyChanges,
      }, null, 2));
    } else {
      this.printReport(plan.fileChanges, plan.dependencyChanges, flags.write);
    }
  }

  private printReport(fileChanges: FileChange[], dependencyChanges: DependencyChange[], applied: boolean): void {
    if (fileChanges.length === 0 && dependencyChanges.length === 0) {
      this.log('Already up to date.');
      return;
    }

    const verb = applied ? 'Updated' : 'Would update';

    if (fileChanges.length > 0) {
      this.log(`${verb} ${fileChanges.length} file(s):`);
      for (const f of fileChanges) {
        this.log(`  - ${f.relPath}`);
      }
      this.log('');
    }

    if (dependencyChanges.length > 0) {
      this.log(`${verb} ${dependencyChanges.length} dependency version(s):`);
      for (const d of dependencyChanges) {
        this.log(`  - [${d.section}] ${d.name}: ${d.from ?? '(missing)'} -> ${d.to}`);
      }
      this.log('');
    }

    if (!applied) {
      this.log('Run with --write to apply.');
    }
  }
}
