import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { env } from './env.js';

serve({ fetch: createApp().fetch, port: env.port }, (info) => {
  console.log(`HeadlessERP API op http://localhost:${info.port} (spec: /openapi.json)`);
});
