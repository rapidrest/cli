///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { Command, Flags } from '@oclif/core';
import { templatesFlag, useTemplates } from '../lib/templateCommand.js';
import { applyUpgrade, planUpgrade, type UpgradePlan } from '../lib/upgrade.js';
import { createVersionResolver } from '../lib/versionResolve.js';

export default class Upgrade extends Command {
  static override description = 'Refresh an existing RapidREST project\'s generator-owned boilerplate files and dependency versions against the newest templates compatible with it.';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --write',
    '<%= config.bin %> <%= command.id %> --json',
    '<%= config.bin %> <%= command.id %> --latest --write',
  ];

  static override flags = {
    write: Flags.boolean({ description: 'Apply the changes. Without this flag, only reports what would change.', default: false }),
    json: Flags.boolean({ description: 'Output the plan as JSON instead of a formatted report.', default: false }),
    latest: Flags.boolean({
      description: 'Use the newest templates this CLI supports, even a newer templates major than the project is on ' +
        '(for a project moving to new @rapidrest majors). Without it, only templates compatible with the project are used.',
      default: false,
    }),
    templates: templatesFlag,
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Upgrade);
    const cwd = process.cwd();
    const templates = await useTemplates(this, cwd, flags.latest ? 'latest' : 'project', flags.templates);
    const versions = createVersionResolver((m) => this.warn(m));
    const ctx = {
      cwd,
      templatesDir: templates.dir,
      templatesVersion: templates.version,
      cliVersion: this.config.version,
      resolveVersion: versions.resolve,
    };

    let plan: UpgradePlan;
    try {
      plan = await planUpgrade(ctx);
    } finally {
      await versions.close();
    }
    const hasChanges = plan.fileChanges.length > 0 || plan.dependencyChanges.length > 0 || !!plan.templatesVersionChange;

    if (flags.write && hasChanges) {
      await applyUpgrade(ctx, plan);
    }

    if (flags.json) {
      this.log(JSON.stringify({
        applied: flags.write && hasChanges,
        templates: { version: templates.version, from: plan.templatesVersionChange?.from },
        fileChanges: plan.fileChanges.map(({ relPath, templateDir }) => ({ relPath, templateDir })),
        dependencyChanges: plan.dependencyChanges,
      }, null, 2));
    } else {
      this.printReport(plan, flags.write);
    }
  }

  private printReport({ fileChanges, dependencyChanges, templatesVersionChange }: UpgradePlan, applied: boolean): void {
    if (fileChanges.length === 0 && dependencyChanges.length === 0 && !templatesVersionChange) {
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

    if (templatesVersionChange) {
      this.log(`${verb} the recorded templates version: ${templatesVersionChange.from ?? '(none)'} -> ${templatesVersionChange.to}`);
      this.log('');
    }

    if (!applied) {
      this.log('Run with --write to apply.');
    }
  }
}
