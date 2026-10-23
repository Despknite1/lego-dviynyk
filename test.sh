#!/bin/bash
# usage: ./test.sh BASEURL endpoint jsonfile
J=$(curl -s -X POST -H 'Content-Type: application/json' --data @$3 $1/api/$2 | python3 -c 'import sys,json;print(json.load(sys.stdin)["job"])')
for i in $(seq 150); do sleep 3; R=$(curl -s $1/job/$J); case "$R" in *'"pending"'*) ;; *) echo "$R"; exit;; esac; done
