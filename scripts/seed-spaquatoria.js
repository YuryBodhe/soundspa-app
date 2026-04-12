// Seed script for Spaquatoria tenant + admin user + 3 channels
// Run with: node scripts/seed-spaquatoria.js

const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const db = new Database("soundspa.sqlite");

function runMigrations() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      brand_name TEXT NOT NULL,
      paid_till INTEGER NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      tenant_id INTEGER NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    );

    CREATE TABLE IF NOT EXISTS channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      stream_url TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tenant_channels (
      tenant_id INTEGER NOT NULL,
      channel_id INTEGER NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id),
      FOREIGN KEY (channel_id) REFERENCES channels(id)
    );
  `);
}

function seedSpaquatoria() {
  const email = "108aura@gmail.com";
  const plainPassword = "12345678"; // будет храниться в БД только в виде хэша
  const name = "Spaquatoria Admin";

  const tenantSlug = "spaquatoria";
  const brandName = "Spaquatoria";

  const channels = [
    {
      code: "deep_relax",
      displayName: "Deep Relax Mix",
      streamUrl: "https://radio.bodhemusic.com/listen/deep_relax/radio.mp3",
    },
    {
      code: "spaquatoria_healing",
      displayName: "Spaquatoria Healing Mix",
      streamUrl: "https://radio.bodhemusic.com/listen/spaquatoria_healing/radio.mp3",
    },
    {
      code: "dynamic_spa",
      displayName: "Dynamic Spa Mix",
      streamUrl: "https://radio.bodhemusic.com/listen/dynamic_spa/radio.mp3",
    },
  ];

  const tx = db.transaction(() => {
    // Upsert tenant
    const existingTenant = db
      .prepare("SELECT * FROM tenants WHERE slug = ?")
      .get(tenantSlug);

    let tenantId;
    const paidTillMs = Date.now() + 7 * 24 * 60 * 60 * 1000; // +7 дней триала

    if (existingTenant) {
      tenantId = existingTenant.id;
      db.prepare(
        "UPDATE tenants SET brand_name = ?, paid_till = ? WHERE id = ?"
      ).run(brandName, paidTillMs, tenantId);
    } else {
      const result = db
        .prepare(
          "INSERT INTO tenants (slug, brand_name, paid_till) VALUES (?, ?, ?)"
        )
        .run(tenantSlug, brandName, paidTillMs);
      tenantId = result.lastInsertRowid;
    }

    // Upsert channels
    const channelIds = {};
    for (const ch of channels) {
      const existingChannel = db
        .prepare("SELECT * FROM channels WHERE code = ?")
        .get(ch.code);

      let channelId;
      if (existingChannel) {
        channelId = existingChannel.id;
        db.prepare(
          "UPDATE channels SET display_name = ?, stream_url = ? WHERE id = ?"
        ).run(ch.displayName, ch.streamUrl, channelId);
      } else {
        const res = db
          .prepare(
            "INSERT INTO channels (code, display_name, stream_url) VALUES (?, ?, ?)"
          )
          .run(ch.code, ch.displayName, ch.streamUrl);
        channelId = res.lastInsertRowid;
      }

      channelIds[ch.code] = channelId;

      // Link tenant ↔ channel (ignore duplicates)
      const existingLink = db
        .prepare(
          "SELECT 1 FROM tenant_channels WHERE tenant_id = ? AND channel_id = ?"
        )
        .get(tenantId, channelId);
      if (!existingLink) {
        db
          .prepare(
            "INSERT INTO tenant_channels (tenant_id, channel_id) VALUES (?, ?)"
          )
          .run(tenantId, channelId);
      }
    }

    // Upsert user
    const existingUser = db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(email);

    const passwordHash = bcrypt.hashSync(plainPassword, 10);

    if (existingUser) {
      db.prepare(
        "UPDATE users SET password_hash = ?, name = ?, tenant_id = ? WHERE id = ?"
      ).run(passwordHash, name, tenantId, existingUser.id);
    } else {
      db
        .prepare(
          "INSERT INTO users (email, password_hash, name, tenant_id) VALUES (?, ?, ?, ?)"
        )
        .run(email, passwordHash, name, tenantId);
    }
  });

  tx();
}

runMigrations();
seedSpaquatoria();

console.log("Seed complete: Spaquatoria tenant + admin + 3 channels");
