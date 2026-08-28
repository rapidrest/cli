///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { Command, Flags } from '@oclif/core';
import {
  ALL_DEPENDENCY_SECTIONS,
  DEFAULT_UPGRADE_SECTIONS,
  applyUpgradePlan,
  buildUpgradePlan,
  parsePackageSpec,
  type UpgradePlanEntry,
} from '../../lib/depUpgrade.js';
import { detectPackageManager, readProjectPackageJson, runInstall, writeProjectPackageJson } from '../../lib/project.js';

function formatUpgradeLines(entries: UpgradePlanEntry[]): string[] {
  const nameWidth = Math.max(...entries.map((e) => e.name.length));
  const specWidth = Math.max(...entries.map((e) => e.currentSpec.length));
  return entries.map((e) =>
    `  ${e.name.padEnd(nameWidth)}  ${e.currentSpec.padEnd(specWidth)}  ->  ${e.newSpec}${e.pinned ? '  (pinned)' : ''}`,
  );
}

export default class DepUpgrade extends Command {
  static override description = 'Upgrades the project\'s dependencies to their latest published versions - a real mass upgrade, unlike `npm update`/`yarn upgrade`, which only move within your existing semver range.';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --dry-run',
    '<%= config.bin %> <%= command.id %> lodash-es axios',
    '<%= config.bin %> <%= command.id %> lodash-es@4.17.21 axios:1.19.0',
    '<%= config.bin %> <%= command.id %> --exclude typescript --exclude eslint',
  ];

  // Allows any number of package name/spec args (e.g. "lodash-es axios@1.19.0").
  static override strict = false;

  static override flags = {
    'dry-run': Flags.boolean({ description: 'List what would be upgraded without changing anything.' }),
    exclude: Flags.string({ multiple: true, description: 'Package name to exclude from the upgrade. Repeatable.' }),
    'no-install': Flags.boolean({ description: 'Skip running the package manager install after upgrading.' }),
    peer: Flags.boolean({ description: 'Also consider peerDependencies when no specific packages are named.' }),
  };

  async run(): Promise<void> {
    const { flags, argv } = await this.parse(DepUpgrade);
    const cwd = process.cwd();

    const pkgInfo = await readProjectPackageJson(cwd);
    if (!pkgInfo) {
      this.error(`No package.json found in ${cwd}.`);
    }

    const requested = (argv as string[]).map(parsePackageSpec);
    const sections = requested.length > 0 || flags.peer ? ALL_DEPENDENCY_SECTIONS : DEFAULT_UPGRADE_SECTIONS;

    this.log(
      requested.length > 0
        ? `Checking ${requested.length} package(s) for updates...`
        : 'Checking all dependencies for updates...',
    );

    const plan = await buildUpgradePlan(pkgInfo.data, requested, { sections, exclude: flags.exclude });

    for (const skip of plan.skipped) {
      this.warn(`${skip.name}: ${skip.reason}`);
    }

    if (plan.upgrades.length === 0) {
      this.log('Everything is already up to date.');
      return;
    }

    this.log('');
    for (const line of formatUpgradeLines(plan.upgrades)) {
      this.log(line);
    }

    if (flags['dry-run']) {
      this.log(`\n${plan.upgrades.length} package(s) would be upgraded. Re-run without --dry-run to apply.`);
      return;
    }

    applyUpgradePlan(pkgInfo.data, plan.upgrades);
    await writeProjectPackageJson(cwd, pkgInfo.data, pkgInfo.indent);
    this.log(`\nUpgraded ${plan.upgrades.length} package(s) in package.json.`);

    if (!flags['no-install']) {
      const pkgMgr = await detectPackageManager(cwd);
      this.log(`\nInstalling updated dependencies (${pkgMgr})...`);
      try {
        await runInstall(cwd, pkgMgr);
      } catch (e) {
        this.error(e instanceof Error ? e.message : String(e));
      }
    } else {
      this.log('\nSkipping install (--no-install). Run `rapidrest dep install` when ready.');
    }
  }
}
