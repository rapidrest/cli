///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////

// Detects the indentation unit used by the file's first indented line (e.g. "\t" for the
// tab-indented package.json the server template ships). Anything writing package.json back out
// should reuse this rather than a hardcoded 2-space indent, or every write silently reformats the
// whole file.
export function detectIndent(raw: string): string {
  const match = raw.match(/^[ \t]+/m);
  return match ? match[0] : '  ';
}
