#!/usr/bin/env bash
# Uso: ./run.sh <escenario> <VUS> <RAMP> <HOLD> <numServidores> [THINK]
# Arranca el monitor, ejecuta k6 y deja resultados en loadtest/results/<escenario>-<VUS>.*
cd "$(dirname "$0")" || exit 1
S=$1; V=$2; R=$3; H=$4; N=${5:-1}; T=${6:-10}; export ROT=${ROT:-0}; TAG=${TAG:-}
BASES=$(for i in $(seq 1 "$N"); do printf "http://127.0.0.$i:3100,"; done); BASES=${BASES%,}
node monitor.mjs results/$S-$V$TAG.mon.csv "$N" & MON=$!
SCENARIO=$S VUS=$V RAMP=$R HOLD=$H THINK=$T BASES=$BASES ./bin/k6.exe run --compatibility-mode=base k6/parcero.js --summary-export results/$S-$V$TAG.summary.json > results/$S-$V$TAG.txt 2>&1
kill $MON 2>/dev/null
tail -45 results/$S-$V$TAG.txt
