PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenants (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL,
  slug             TEXT NOT NULL UNIQUE,
  brand_name       TEXT,
  trial_started_at TEXT,
  trial_ends_at    TEXT,
  paid_till        TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL,
  password   TEXT NOT NULL,
  tenant_id  INTEGER NOT NULL,
  CONSTRAINT unique_email_tenant UNIQUE (email, tenant_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE TABLE IF NOT EXISTS channels (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT NOT NULL UNIQUE,
  slug         TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  mood         TEXT,
  stream_url   TEXT NOT NULL,
  image        TEXT,
  "order"      INTEGER NOT NULL DEFAULT 0,
  is_new       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tenant_channels (
  tenant_id  INTEGER NOT NULL,
  channel_id INTEGER NOT NULL,
  "order"    INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT tenant_channels_pk UNIQUE (tenant_id, channel_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (channel_id) REFERENCES channels(id)
);

CREATE TABLE IF NOT EXISTS invites (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL UNIQUE,
  max_uses   INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS login_tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  token      TEXT NOT NULL UNIQUE,
  user_id    INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Seed data (idempotent)
INSERT OR IGNORE INTO tenants (id, name, slug, brand_name, trial_started_at, trial_ends_at, paid_till)
VALUES
  (1, 'Spaquatoria', 'spaquatoria', 'Spaquatoria', NULL, NULL, '2026-04-12'),
  (2, 'Divnitsa',    'divnitsa',    'Дивница',     NULL, NULL, '2026-12-31');

INSERT OR IGNORE INTO channels (id, code, slug, display_name, mood, stream_url, image, "order", is_new)
VALUES
  (1, 'deep_relax',           'deep-relax',           'Deep Relax Mix',       'Relaxing · Live', 'https://radio.bodhemusic.com/listen/deep_relax/radio.mp3',           '/channel-1.jpg',        1, 0),
  (2, 'spaquatoria_healing',  'spaquatoria-healing',  'Healing Mix',          'Deep · Live',     'https://radio.bodhemusic.com/listen/spaquatoria_healing/radio.mp3', '/channel-2.jpg',        2, 1),
  (3, 'dynamic_spa',          'dynamic-spa',          'Dynamic Spa Mix',      'Energizing · Live','https://radio.bodhemusic.com/listen/dynamic_spa/radio.mp3',          '/channel-3.jpg',        3, 0),
  (4, 'divnitsa',             'divnitsa',             'Дивница',              'Signature · Live','https://radio.bodhemusic.com/listen/divnitsa/radio.mp3',             '/channel-divnitsa.jpg', 1, 0);

INSERT OR IGNORE INTO tenant_channels (tenant_id, channel_id, "order")
VALUES
  -- Spaquatoria: Deep Relax, Dynamic Spa, Healing
  (1, 1, 1),
  (1, 3, 2),
  (1, 2, 3),
  -- Divnitsa: Дивница, Deep Relax, Dynamic Spa
  (2, 4, 1),
  (2, 1, 2),
  (2, 3, 3);

-- Default user for login page (legacy)
INSERT OR IGNORE INTO users (id, email, password, tenant_id)
VALUES
  (1, '108aura@gmail.com', '12345678', 1);
