# Domínio sem o piso retangular

Fonte: `Jmxxp/INVOX`, commit `d96a2b6bbfcadab74b30a124a2cbfbcc5b725db4`, `scripts/ui/room_mode_stage.gd`. A alteração existe apenas na fixture isolada do site; o checkout original não foi modificado.

Foram removidas as duas linhas de `_build_control_points()` que criavam `NeutralControlArena`: um `BoxMesh` cinza de tamanho `(5.4, 0.10, 2.8)`, na posição `(0, 0.03, 0)`. As bases circulares, anéis, letras A/B/C, textos, luzes e movimentos foram preservados.

O Godot 4.7.2 renderiza com a câmera original, sem autoloads ou microfone: `--rendering-method gl_compatibility --audio-driver Dummy --write-movie <saida>/frame.png --fixed-fps 20 --quit-after 180 --resolution 640x360 --position -10000,-10000 -- domination`.

Os 180 quadros são codificados por FFmpeg 9.0.2: `-framerate 20 -i <saida>/frame%08d.png -frames:v 180 -c:v libvpx-vp9 -b:v 0 -crf 24 -pix_fmt yuv420p -row-mt 1 -deadline good -cpu-used 2 -an mode-domination.webm`.

O poster é o primeiro quadro nativo. A prévia mantém 640 × 360, 20 fps e 9 segundos, sem edição raster ou alteração de tempo. Os hashes estão em `provenance.json`.
