import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const cfg = loadConfig();
const { app, processor } = await buildApp(cfg);
processor.resume();
await app.listen({ port: cfg.port, host: cfg.host });
