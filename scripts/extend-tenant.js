// extend-tenant.js
// Usage: node scripts/extend-tenant.js <slug> <days>
// Example: node scripts/extend-tenant.js spaquatoria 30

const Database = require("better-sqlite3");

const db = new Database("soundspa.sqlite");

function extendTenant(slug, days) {
  const tenant = db
    .prepare("SELECT id, paid_till FROM tenants WHERE slug = ?")
    .get(slug);

  if (!tenant) {
    console.error(`Tenant with slug "${slug}" not found`);
    process.exit(1);
  }

  const now = Date.now();
  const currentPaidTill = tenant.paid_till || now;
  const base = currentPaidTill > now ? currentPaidTill : now;
  const newPaidTill = base + days * 24 * 60 * 60 * 1000;

  db.prepare("UPDATE tenants SET paid_till = ? WHERE id = ?").run(
    newPaidTill,
    tenant.id
  );

  const diffDays = Math.ceil((newPaidTill - now) / (24 * 60 * 60 * 1000));
  console.log(
    `Extended tenant "${slug}" by ${days} day(s). New access: ~${diffDays} days from now.`
  );
}

function main() {
  const [, , slug, daysStr] = process.argv;
  if (!slug || !daysStr) {
    console.error("Usage: node scripts/extend-tenant.js <slug> <days>");
    process.exit(1);
  }

  const days = parseInt(daysStr, 10);
  if (Number.isNaN(days) || days <= 0) {
    console.error("<days> must be a positive integer");
    process.exit(1);
  }

  extendTenant(slug, days);
}

main();
