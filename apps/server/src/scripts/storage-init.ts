import { setTimeout as delay } from 'node:timers/promises';
import { loadConfig } from '../config.js';
import { createStorage } from '../infra/storage.js';

const storage = createStorage(loadConfig());
try {
  for (let attempt = 1; ; attempt++) {
    try { await storage.ensureBucket(); break; }
    catch {
      if (attempt >= 30) throw new Error('Storage initialization exhausted retries');
      console.info(`Waiting for Silo (${attempt}/30)`);
      await delay(2000);
    }
  }
  console.info('Private storage bucket ready');
} catch { console.error('Storage initialization failed'); process.exitCode = 1; }
finally { storage.close(); }
