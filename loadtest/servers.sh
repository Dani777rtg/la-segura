#!/usr/bin/env bash
# Uso: ./servers.sh start N | stop | status   (N procesos en 127.0.0.1..127.0.0.N, puerto 3100)
cd "$(dirname "$0")/../apps/api" || exit 1
case "$1" in
  start)
    for i in $(seq 1 "${2:-1}"); do
      LOAD_HOST=127.0.0.$i LOAD_PORT=3100 nohup node --import tsx src/loadtest-server.ts > ../../loadtest/results/server-$i.log 2>&1 &
    done
    sleep 6; for i in $(seq 1 "${2:-1}"); do curl -s -m 3 http://127.0.0.$i:3100/api/health; echo; done ;;
  stop)
    powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -like '*loadtest-server*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }" ;;
  status)
    powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -like '*loadtest-server*' } | Select ProcessId,CommandLine | Format-Table -Auto" ;;
esac
