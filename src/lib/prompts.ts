///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { input } from '@inquirer/prompts';
import { readGitAuthor, readProjectAuthor } from "./project.js";

export async function inputAuthor(cwd?: string) {
    const author = (await readGitAuthor()) ?? (cwd ? await readProjectAuthor(cwd) : undefined);
    return await input({ message: 'Enter the author name:', default: author, required: true });
}