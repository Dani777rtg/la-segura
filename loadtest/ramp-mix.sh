#!/usr/bin/env bash
cd "$(dirname "$0")"
export GOGC=25
for v in "$@"; do
  ./reset-data.sh
  ./run.sh mix $v 60s 60s 4 10 > /dev/null 2>&1
  node summarize.mjs results/mix-$v >> results/summary-mix.jsonl
  sleep 10
done
