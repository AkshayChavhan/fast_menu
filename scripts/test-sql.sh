#!/usr/bin/env bash
# Run the SQL tests in supabase/tests/ against a throwaway PostgreSQL cluster.
#
# The real schema needs Supabase-only objects (auth.users, storage, RLS), so
# instead of loading it wholesale we mirror the tables the function under test
# touches (supabase/tests/fixtures.sql) and extract the function itself straight
# out of supabase/schema.sql — so the tests always run the shipped code, not a
# copy that can drift.
#
# Nothing outside the temp directory is touched: your own PostgreSQL is never
# started, and the cluster is deleted on exit.
#
# Requires the postgres binaries on PATH (initdb, pg_ctl, psql).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCHEMA="$ROOT/supabase/schema.sql"

for bin in initdb pg_ctl psql; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "error: '$bin' not found on PATH." >&2
    echo "  macOS:  brew install postgresql@14" >&2
    echo "  then:   export PATH=\"\$(brew --prefix postgresql@14)/bin:\$PATH\"" >&2
    exit 127
  fi
done

# Short path: a unix socket path over ~103 bytes is rejected by the server, and
# the repo may live somewhere deep. We use TCP on loopback, but keep it short
# anyway so the data directory doesn't hit other limits.
TMP="$(mktemp -d "${TMPDIR:-/tmp}/fmsql.XXXXXX")"
PORT="${PGTESTPORT:-55433}"

cleanup() {
  if [ -d "$TMP/pgdata" ]; then
    pg_ctl -D "$TMP/pgdata" -m immediate -w stop >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

echo "==> initialising a throwaway cluster in $TMP"
initdb -D "$TMP/pgdata" -U postgres --auth=trust >/dev/null

echo "==> starting it on 127.0.0.1:$PORT"
pg_ctl -D "$TMP/pgdata" \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" \
  -l "$TMP/pg.log" -w start >/dev/null

psql_run() {
  psql -h 127.0.0.1 -p "$PORT" -U postgres -d schematest \
       -v ON_ERROR_STOP=1 --quiet "$@"
}

createdb -h 127.0.0.1 -p "$PORT" -U postgres schematest

echo "==> loading fixtures"
psql_run -f "$ROOT/supabase/tests/fixtures.sql" >/dev/null

echo "==> extracting import_menu() from supabase/schema.sql"
# From the CREATE line up to (not including) the REVOKE that follows it.
awk '/^create or replace function public\.import_menu/{f=1}
     /^revoke all on function public\.import_menu/{f=0}
     f' "$SCHEMA" > "$TMP/import_menu.sql"

if [ ! -s "$TMP/import_menu.sql" ]; then
  echo "error: could not find import_menu() in $SCHEMA" >&2
  exit 1
fi
psql_run -f "$TMP/import_menu.sql" >/dev/null

echo "==> running supabase/tests/import_menu.test.sql"
# PASS lines are RAISE NOTICE, which psql writes to stderr.
psql_run -f "$ROOT/supabase/tests/import_menu.test.sql" 2>&1

echo "==> ok"
