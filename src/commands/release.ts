///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { Args, Command, Flags } from '@oclif/core';
import {
  RELEASE_TYPES,
  assertCleanWorkingTree,
  bumpPackageVersion,
  computeNewVersion,
  detectHelm,
  hasUnreleasedSection,
  pushRelease,
  readPackageInfo,
  stageAndCommit,
  updateChangelog,
  updateHelmVersion,
  updateReleaseNotes,
  validateHelmFiles,
} from '../lib/release.js';

export default class Release extends Command {
  static override description = 'Cuts a new release of the current project: bumps the version, promotes RELEASE_NOTES.md\'s "Unreleased" section, summarizes commits into CHANGELOG.md, updates Helm chart files if present, then commits, tags, and pushes.';

  static override examples = [
    '<%= config.bin %> <%= command.id %> patch',
    '<%= config.bin %> <%= command.id %> 2.1.0 --dry-run',
    '<%= config.bin %> <%= command.id %> prerelease --preid rc --no-push',
  ];

  static override args = {
    bump: Args.string({
      description: `Release strategy (${RELEASE_TYPES.join('|')}) or an explicit x.y.z version.`,
      required: true,
    }),
  };

  static override flags = {
    preid: Flags.string({ description: 'Prerelease identifier (e.g. "rc") for pre* strategies.' }),
    'dry-run': Flags.boolean({ description: 'Print the computed version and exit without changing anything.' }),
    'no-push': Flags.boolean({ description: 'Commit and tag locally but skip `git push`.' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Release);
    const cwd = process.cwd();

    const pkg = await readPackageInfo(cwd);
    let newVersion: string;
    try {
      newVersion = computeNewVersion(pkg.version, args.bump, flags.preid);
    } catch (err) {
      this.error(err instanceof Error ? err.message : String(err));
    }

    // Pre-flight: validate everything the mutation phase below needs, before touching a single
    // file — so a misconfigured project (no "Unreleased" section, a malformed Helm chart) fails
    // here rather than after `npm version` has already bumped package.json.
    if (!(await hasUnreleasedSection(cwd))) {
      this.error('No "## Unreleased" section found in RELEASE_NOTES.md. Add one before releasing.');
    }
    const hasHelm = await detectHelm(cwd);
    if (hasHelm) {
      try {
        await validateHelmFiles(cwd);
      } catch (err) {
        this.error(err instanceof Error ? err.message : String(err));
      }
    }

    if (flags['dry-run']) {
      this.log(`Dry run: ${pkg.version} -> ${newVersion} (no changes made)`);
      if (hasHelm) {
        this.log('Helm chart files detected at helm/ — would also update their version.');
      }
      return;
    }

    try {
      await assertCleanWorkingTree(cwd);
    } catch (err) {
      this.error(err instanceof Error ? err.message : String(err));
    }

    try {
      this.log(`Bumping version: ${pkg.version} -> ${newVersion}`);
      await bumpPackageVersion(cwd, newVersion);

      await updateReleaseNotes(cwd, newVersion);

      this.log('Updating CHANGELOG.md from commit history...');
      await updateChangelog(cwd, newVersion, (m) => this.warn(m));

      let helmFiles: string[] = [];
      if (hasHelm) {
        this.log('Updating Helm chart version...');
        helmFiles = await updateHelmVersion(cwd, newVersion);
      }

      await stageAndCommit(cwd, newVersion, helmFiles);
      this.log(`Committed and tagged v${newVersion}.`);

      if (!flags['no-push']) {
        this.log('Pushing to remote...');
        await pushRelease(cwd);
      } else {
        this.log('Skipping push (--no-push). Run `git push && git push --tags` when ready.');
      }
    } catch (err) {
      this.error(
        `${err instanceof Error ? err.message : String(err)}\n\nThe working tree may be left partially modified — run \`git status\` to check before retrying.`,
      );
    }
  }
}
