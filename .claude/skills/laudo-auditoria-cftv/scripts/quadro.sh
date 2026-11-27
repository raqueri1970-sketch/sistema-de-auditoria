#!/usr/bin/env bash
# Extrai a evidência de um instante do vídeo: quadro original com área marcada em vermelho + ampliação da área.
# Uso: quadro.sh <video.mp4> <tempo_s> <x> <y> <largura> <altura> <prefixo_saida>
#  -> <prefixo>_quadro.jpg e <prefixo>_zoom.jpg
# x/y/largura/altura em pixels da resolução ORIGINAL do vídeo (veja com ffprobe).
set -euo pipefail
VID="$1"; T="$2"; X="$3"; Y="$4"; W="$5"; H="$6"; P="$7"
ffmpeg -v error -y -ss "$T" -i "$VID" -frames:v 1 -vf "drawbox=x=$X:y=$Y:w=$W:h=$H:color=red:t=4" -q:v 2 "${P}_quadro.jpg"
ffmpeg -v error -y -ss "$T" -i "$VID" -frames:v 1 -vf "crop=$W:$H:$X:$Y,scale=-1:600:flags=lanczos,unsharp=5:5:0.8" -q:v 2 "${P}_zoom.jpg"
echo "${P}_quadro.jpg ${P}_zoom.jpg"
