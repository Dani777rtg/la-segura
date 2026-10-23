#!/usr/bin/env bash
# Uso: ./ramp.sh <escenario> <numServidores> <think> <nivel> [nivel...]   (rampa 60 s + 60 s sostenido, BD reiniciada entre niveles)
cd "$(dirname "$0")"
export GOGC=25
S=$1; N=$2; T=$3; shift 3
for v in "$@"; do
  ./reset-data.sh
  TAG=${TAG:-} ./run.sh $S $v 60s 60s $N $T > /dev/null 2>&1
  node summarize.mjs results/$S-$v${TAG:-} >> results/summary-$S${TAG:-}.jsonl
  sleep 15
done
