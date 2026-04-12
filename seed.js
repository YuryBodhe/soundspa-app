// Seed script to initialize channels in Spaquatoria (tenant_id = 1)

import { db } from './db';
import { channels } from './drizzle/schema';

async function seedData() {
  await db.insert(channels).values([
    { name: 'Forest Ambience', streamUrl: 'https://radio.bodhemusic.com/listen/forest_ambience/radio.mp3', kind: 'noise' },
    { name: 'Ocean Waves', streamUrl: 'https://radio.bodhemusic.com/listen/ocean_waves/radio.mp3', kind: 'noise' },
    { name: 'Soft Piano', streamUrl: 'https://radio.bodhemusic.com/listen/soft_piano/radio.mp3', kind: 'music' },
  ]);
}

seedData();