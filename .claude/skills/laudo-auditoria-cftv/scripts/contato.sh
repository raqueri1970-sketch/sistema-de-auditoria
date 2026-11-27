#!/usr/bin/env bash
# Folha de contato de um vídeo de CFTV: 1 quadro a cada N segundos, com o tempo do vídeo carimbado.
# Uso: contato.sh <video.mp4> <saida.jpg> [intervalo_s=1] [colunas=8]
set -euo pipefail
VID="$1"; OUT="$2"; STEP="${3:-1}"; COLS="${4:-8}"
DUR=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$VID")
N=$(python3 -c "import math;print(math.ceil($DUR/$STEP))")
ROWS=$(( (N + COLS - 1) / COLS ))
ffmpeg -v error -y -i "$VID" -vf "fps=1/$STEP,scale=320:-1,drawtext=text='%{pts\:hms}':x=5:y=5:fontsize=18:fontcolor=yellow:box=1:boxcolor=black,tile=${COLS}x${ROWS}" -frames:v 1 "$OUT"
echo "duração=${DUR}s quadros=$N grade=${COLS}x${ROWS} -> $OUT"
