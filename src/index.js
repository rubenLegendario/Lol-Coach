import os from 'node:os';
import { config } from './config.js';
import { App } from './app.js';
import { createServer } from './server.js';

const app = new App();
const server = createServer(app);

server.listen(config.port, config.host, () => {
  console.log(`\n  LoL Coach en marcha → http://localhost:${config.port}`);
  if (config.host === '0.0.0.0') {
    const lan = Object.values(os.networkInterfaces()).flat().find((i) => i.family === 'IPv4' && !i.internal);
    if (lan) console.log(`  Desde el móvil/tablet (misma WiFi) → http://${lan.address}:${config.port}`);
  }
  console.log('  Abre el LoL y entra en una partida o en la Herramienta de práctica.\n');
});

const demoIdx = process.argv.indexOf('--demo');
const start = demoIdx === -1
  ? app.start()
  : app.init().then(async () => (await import('./demo.js')).runDemo(app, process.argv[demoIdx + 1], process.argv[demoIdx + 2]));

start.catch((err) => {
  console.error('No se pudo iniciar:', err);
  process.exit(1);
});
