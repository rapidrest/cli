import { createServer } from 'net';

function isPortAvailable(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = createServer();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, host);
  });
}

// Starting at `startPort`, probes successive ports (startPort, startPort + 1, ...)
// until one is free, and returns it. Used so `start`/`dev` can fall back to 3001, 3002, etc.
// when the default port 3000 is already occupied.
export async function findAvailablePort(startPort: number, host = '0.0.0.0'): Promise<number> {
  let port = startPort;
  while (!(await isPortAvailable(port, host))) {
    port++;
  }
  return port;
}
