#!/usr/bin/env bash
# Runs every test. Needs only Ruby and Node - no Discourse, no database.
set -uo pipefail
cd "$(dirname "$0")"

status=0

echo "== Ruby =="
for file in ruby/*_test.rb; do
  printf '%-28s' "$(basename "$file")"
  if output=$(ruby "$file" 2>&1); then
    echo "$(echo "$output" | grep -E '^[0-9]+ runs' || echo ok)"
  else
    echo "FAILED"; echo "$output"; status=1
  fi
done

echo
echo "== JavaScript =="
cd js
if [ ! -d node_modules ]; then
  echo "installing jsdom..."
  npm install --silent --no-audit --no-fund >/dev/null 2>&1 || true
fi

node --test 2>&1 | grep -E "^# (tests|pass|fail)"
node --test >/dev/null 2>&1 || status=1

echo
[ $status -eq 0 ] && echo "all green" || echo "FAILURES"
exit $status
