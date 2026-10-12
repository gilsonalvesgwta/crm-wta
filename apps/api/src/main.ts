import { loadConfig } from './config.js';
import { createApp } from './server.js';

const cfg = loadConfig();
const app = await createApp(cfg);
await app.listen({ port: cfg.PORT, host: '0.0.0.0' });
