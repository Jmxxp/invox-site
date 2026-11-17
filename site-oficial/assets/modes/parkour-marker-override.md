# Parkour: marcador com mais contraste

Fonte: `Jmxxp/INVOX`, commit `d96a2b6bbfcadab74b30a124a2cbfbcc5b725db4`, `scripts/ui/room_mode_stage.gd`. O checkout original permanece intacto. A alteração abaixo existe somente na cópia isolada usada para renderizar a prévia do site.

O raio da esfera passou de `0.10` para `0.18`, a altura de `0.20` para `0.36` e a cor de `#d9a8ff` para `#f7edff`. Um contorno violeta geométrico, com faces frontais descartadas, mantém a esfera visível sobre as plataformas claras. Caminho, salto, velocidade, fase de visibilidade, câmera, luzes e plataformas não foram alterados.

## Alteração na fixture

Na construção de `_parkour_marker`, substitua o raio/altura e a cor pelos valores acima. Depois de adicionar `marker` à cena, acrescente:

```gdscript
var outline := MeshInstance3D.new()
outline.name = "WebParkourMarkerOutline"
outline.mesh = sphere
outline.scale = Vector3.ONE * 1.10
outline.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
var outline_material := StandardMaterial3D.new()
outline_material.albedo_color = Color("6a278d")
outline_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
outline_material.cull_mode = BaseMaterial3D.CULL_FRONT
outline.material_override = outline_material
marker.add_child(outline)
```

## Renderização

Use a fixture `INVOX Web Modes`, sem autoloads ou microfone e com diretório de usuário próprio. O script `capture.gd` continua chamando `stage.present(clock, delta)` com o relógio nativo. Crie previamente a pasta de saída e renderize com Godot 4.7.2:

```text
Godot_v4.7.2-stable_win64_console.exe --path <fixture> --rendering-method gl_compatibility --audio-driver Dummy --write-movie <saida>/frame.png --fixed-fps 20 --quit-after 200 --resolution 640x360 --position -10000,-10000 -- parkour
```

Codifique os 200 quadros com FFmpeg 9.0.2, sem áudio ou filtros de imagem:

```text
ffmpeg -y -framerate 20 -i <saida>/frame%08d.png -frames:v 200 -c:v libvpx-vp9 -b:v 0 -crf 24 -pix_fmt yuv420p -row-mt 1 -deadline good -cpu-used 2 -an mode-parkour.webm
```

O poster é uma cópia direta de `frame00000000.png`. O vídeo mantém 640 × 360 pixels, 20 fps e 10 segundos. Não houve edição raster, interpolação, crossfade ou alteração de tempo. Os hashes do código original, da fixture alterada e dos arquivos finais estão em `provenance.json`.
