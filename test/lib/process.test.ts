///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('child_process', () => ({ spawn: vi.fn() }));

import { spawn } from 'child_process';
import { killProcessTree } from '../../src/lib/process.js';

class FakeChild extends EventEmitter {
  pid?: number;
  killed = false;
  kill() { this.killed = true; }
  constructor(pid?: number) {
    super();
    this.pid = pid;
  }
}

async function withPlatform<T>(platform: string, fn: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: platform });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, 'platform', original);
  }
}

describe('killProcessTree', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('on win32', () => {
    it('shells out to taskkill /pid <pid> /t /f to kill the whole process tree', async () => {
      const killer = new FakeChild();
      vi.mocked(spawn).mockReturnValue(killer as any);

      await withPlatform('win32', async () => {
        const promise = killProcessTree(new FakeChild(1234) as any);
        killer.emit('exit', 0);
        await promise;
      });

      expect(spawn).toHaveBeenCalledWith('taskkill', ['/pid', '1234', '/t', '/f'], { stdio: 'ignore' });
    });

    it('resolves once taskkill errors out rather than hanging', async () => {
      const killer = new FakeChild();
      vi.mocked(spawn).mockReturnValue(killer as any);

      await withPlatform('win32', async () => {
        const promise = killProcessTree(new FakeChild(1234) as any);
        killer.emit('error', new Error('spawn ENOENT'));
        await expect(promise).resolves.toBeUndefined();
      });
    });

    it('falls back to child.kill() when the child has no pid', async () => {
      const child = new FakeChild(undefined);

      await withPlatform('win32', () => killProcessTree(child as any));

      expect(spawn).not.toHaveBeenCalled();
      expect(child.killed).toBe(true);
    });
  });

  describe('on POSIX', () => {
    it('signals the whole process group via the negative pid', async () => {
      const child = new FakeChild(4321);
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

      try {
        await withPlatform('linux', () => killProcessTree(child as any));
        expect(killSpy).toHaveBeenCalledWith(-4321, 'SIGTERM');
        expect(spawn).not.toHaveBeenCalled();
        expect(child.killed).toBe(false);
      } finally {
        killSpy.mockRestore();
      }
    });

    it('falls back to child.kill() when the process group signal fails', async () => {
      const child = new FakeChild(4321);
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
        throw new Error('ESRCH');
      });

      try {
        await withPlatform('linux', () => killProcessTree(child as any));
        expect(child.killed).toBe(true);
      } finally {
        killSpy.mockRestore();
      }
    });

    it('falls back to child.kill() when the child has no pid', async () => {
      const child = new FakeChild(undefined);
      const killSpy = vi.spyOn(process, 'kill');

      try {
        await withPlatform('linux', () => killProcessTree(child as any));
        expect(killSpy).not.toHaveBeenCalled();
        expect(child.killed).toBe(true);
      } finally {
        killSpy.mockRestore();
      }
    });
  });
});
