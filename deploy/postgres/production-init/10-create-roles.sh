#!/bin/sh
set -eu

: "${V2_APP_DB_PASSWORD:?Missing application database role password}"
: "${V2_MIGRATION_DB_PASSWORD:?Missing migration database role password}"

# psql reads secrets from the process environment; they are not SQL arguments or log output.
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 <<'SQL'
\getenv app_password V2_APP_DB_PASSWORD
\getenv migration_password V2_MIGRATION_DB_PASSWORD
CREATE ROLE soundspa_v2_app LOGIN PASSWORD :'app_password';
CREATE ROLE soundspa_v2_migrator LOGIN PASSWORD :'migration_password';
GRANT CONNECT ON DATABASE soundspa_v2 TO soundspa_v2_app, soundspa_v2_migrator;
GRANT USAGE ON SCHEMA public TO soundspa_v2_app;
GRANT USAGE, CREATE ON SCHEMA public TO soundspa_v2_migrator;
ALTER DEFAULT PRIVILEGES FOR ROLE soundspa_v2_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO soundspa_v2_app;
ALTER DEFAULT PRIVILEGES FOR ROLE soundspa_v2_migrator IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO soundspa_v2_app;
SQL

unset V2_APP_DB_PASSWORD V2_MIGRATION_DB_PASSWORD
