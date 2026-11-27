#!/usr/bin/env bash
# Sequência ampliada de uma área para ver movimentos finos (mãos, bolsos, balcão).
# Uso: zoom_seq.sh <video.mp4> <x> <y> <largura> <altura> <saida.jpg> <t1> <t2> ... (até 12 tempos)
set -euo pipefail
VID="$1"; X="$2"; Y="$3"; W="$4"; H="$5"; OUT="$6"; shift 6
TMP=$(mktemp -d); i=0; IN=()
for t in "$@"; do
  ffmpeg -v error -y -ss "$t" -i "$VID" -frames:v 1 -vf "crop=$W:$H:$X:$Y,scale=360:-1:flags=lanczos,drawtext=text='t=$t':x=5:y=5:fontsize=22:fontcolor=yellow:box=1:boxcolor=black" "$TMP/$i.jpg"
  IN+=(-i "$TMP/$i.jpg"); i=$((i+1))
done
COLS=$(( i < 6 ? i : 6 )); ROWS=$(( (i + COLS - 1) / COLS ))
if [ "$i" -eq 1 ]; then cp "$TMP/0.jpg" "$OUT"; else
  ffmpeg -v error -y "${IN[@]}" -filter_complex "xstack=inputs=$i:grid=${COLS}x${ROWS}:fill=black" "$OUT"; fi
rm -rf "$TMP"; echo "$OUT"
