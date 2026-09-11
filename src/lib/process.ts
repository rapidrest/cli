///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { spawn, type ChildProcess } from 'child_process';

// Terminates `child` along with any processes it spawned. A plain `child.kill()` only signals the
// single process cross-spawn/Node actually launched. On Windows that's frequently a wrapper
// (cross-spawn shells out via cmd.exe for node_modules/.bin/*.cmd shims like tsx/vite), with the
// real tsx/vite/node process running as a grandchild; killing just the wrapper leaves that
// grandchild running in the background with native addons (e.g. rolldown's .node binding) loaded,
// which keeps their files locked and breaks a subsequent `yarn install`. `taskkill /t` walks the
// whole process tree by PID instead of only the immediate child.
//
// On POSIX, killing the process group (negative PID) reaches any subprocesses the child itself
// spawned. This only works when the child was started with `detached: true`, which makes it the
// leader of its own process group; otherwise (or if the child has already exited) we fall back to
// signalling the child directly.
export function killProcessTree(child: ChildProcess): Promise<void> {
  const { pid } = child;

  if (process.platform === 'win32' && pid != null) {
    return new Promise((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' });
      killer.once('exit', () => resolve());
      killer.once('error', () => resolve());
    });
  }

  if (pid != null) {
    try {
      process.kill(-pid, 'SIGTERM');
      return Promise.resolve();
    } catch {
      // pid isn't a process group leader (child wasn't spawned with detached: true) or has
      // already exited — fall back to signalling the child process directly.
    }
  }

  child.kill();
  return Promise.resolve();
}
