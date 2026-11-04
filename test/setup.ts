///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { join } from 'path';
import { vi } from 'vitest';

// Commands find their templates through resolveTemplates(), which can download them from GitHub.
// Tests always render this checkout's templates/ instead and never touch the network (many command
// tests also mock fs, which the real resolution reads through). templateSource's own tests
// vi.unmock() it.
export const TEST_TEMPLATES_DIR = join(import.meta.dirname, '..', 'templates');
export const TEST_TEMPLATES_VERSION = '0.0.0-test';

vi.mock('../src/lib/templateSource.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/templateSource.js')>();
  return {
    ...actual,
    resolveTemplates: vi.fn(async () => ({ dir: TEST_TEMPLATES_DIR, version: TEST_TEMPLATES_VERSION, source: 'checkout' })),
  };
});
