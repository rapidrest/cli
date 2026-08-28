///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { Command, Flags } from '@oclif/core';
import { runProjectBin } from '../lib/project.js';

export default class Test extends Command {
  static override description = 'Runs the project\'s test suite via Vitest.';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --coverage',
    '<%= config.bin %> <%= command.id %> --watch',
    '<%= config.bin %> <%= command.id %> src/routes/HelloRoute.test.ts',
  ];

  // Allows extra positional args (e.g. a test file path/pattern) to pass through to Vitest.
  static override strict = false;

  static override flags = {
    coverage: Flags.boolean({ description: 'Run tests with code coverage.' }),
    watch: Flags.boolean({ description: 'Run tests in watch mode instead of a single pass.' }),
  };

  async run(): Promise<void> {
    const { flags, argv } = await this.parse(Test);
    const cwd = process.cwd();
    const extraArgs = argv as string[];

    const args = [
      ...(flags.watch ? [] : ['run']),
      ...(flags.coverage ? ['--coverage'] : []),
      ...extraArgs,
    ];

    try {
      await runProjectBin(cwd, 'vitest', args);
    } catch (e) {
      this.error(e instanceof Error ? e.message : String(e));
    }
  }
}
