import { describe, it, expect } from 'vitest';
import { createServer, Server } from 'net';
import { findAvailablePort } from '../../src/lib/port.js';

function listenOn(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolve(server));
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('findAvailablePort', () => {
  it('returns the requested port when it is free', async () => {
    const port = await findAvailablePort(41230);
    expect(port).toBe(41230);
  });

  it('returns the next free port when the requested one is occupied', async () => {
    const occupied = await listenOn(41231);
    try {
      const port = await findAvailablePort(41231);
      expect(port).toBe(41232);
    } finally {
      await closeServer(occupied);
    }
  });

  it('skips multiple consecutive occupied ports', async () => {
    const first = await listenOn(41233);
    const second = await listenOn(41234);
    try {
      const port = await findAvailablePort(41233);
      expect(port).toBe(41235);
    } finally {
      await closeServer(first);
      await closeServer(second);
    }
  });
});
