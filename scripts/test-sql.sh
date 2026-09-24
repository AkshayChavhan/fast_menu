#!/usr/bin/env bash
# Run the SQL tests in supabase/tests/ against a throwaway PostgreSQL cluster.
#
# The real schema needs Supabase-only objects (auth.users, storage, RLS), so
# instead of loading it wholesale we mirror the tables the functions under test
# touch (supabase/tests/fixtures.sql) and extract the functions themselves
# straight out of supabase/migrations/ — so the tests always run the shipped
# code, not a copy that can drift. A function that a later migration redefines
# is taken from the latest file that defines it, exactly as Postgres would end
# up with after running the migrations in order.
#
# Nothing outside the temp directory is touched: your own PostgreSQL is never
# started, and the cluster is deleted on exit.
#
# Requires the postgres binaries on PATH (initdb, pg_ctl, psql).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS="$ROOT/supabase/migrations"

# Functions to load, in dependency order, and the test files to run against
# them. Add to both lists as new database functions gain tests.
FUNCTIONS=(insert_dish_modifiers import_menu is_platform_admin normalize_hotel_name claim_trial enforce_trial_before_publish list_trial_reviews review_trial set_dish_modifiers schedule_is_open category_is_open dish_special_active order_items_recalc orders_recalc_session generate_order_code check_rate_limit insert_order_items place_order get_order_by_code cancel_order_by_code create_service_request session_for_tables approve_order reject_order staff_cancel_order staff_create_order staff_set_order_items staff_move_order open_table_session clear_table_session resolve_service_request)
TESTS=(import_menu.test.sql claim_trial.test.sql set_dish_modifiers.test.sql schedules.test.sql orders.test.sql staff_orders.test.sql)

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

# Print the body of `create or replace function public.<name>(` from the
# latest migration that defines it: from that line up to and including the
# closing `$$;` line. If a file defines the function twice, the last wins.
extract_function() {
  local fn="$1"
  local file
  file="$(grep -l -E "^create or replace function public\.${fn}\(" "$MIGRATIONS"/*.sql | sort | tail -1 || true)"
  if [ -z "$file" ]; then
    echo "error: could not find ${fn}() in $MIGRATIONS" >&2
    exit 1
  fi
  echo "==> extracting ${fn}() from ${file#"$ROOT/"}"
  awk -v fn="$fn" '
    $0 ~ ("^create or replace function public\\." fn "\\(") { buf = ""; f = 1 }
    f { buf = buf $0 "\n" }
    f && /^\$\$;/ { f = 0; out = buf }
    END { printf "%s", out }
  ' "$file" > "$TMP/$fn.sql"
  if [ ! -s "$TMP/$fn.sql" ]; then
    echo "error: ${fn}() in $file has no terminating \$\$; line" >&2
    exit 1
  fi
  psql_run -f "$TMP/$fn.sql" >/dev/null
}

for fn in "${FUNCTIONS[@]}"; do
  extract_function "$fn"
done

for t in "${TESTS[@]}"; do
  echo "==> running supabase/tests/$t"
  # PASS lines are RAISE NOTICE, which psql writes to stderr.
  psql_run -f "$ROOT/supabase/tests/$t" 2>&1
done

echo "==> ok"
