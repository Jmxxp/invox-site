# Parkour: marcador roxo e apoio sobre as plataformas

Fonte: `Jmxxp/INVOX`, commit `d96a2b6bbfcadab74b30a124a2cbfbcc5b725db4`, `scripts/ui/room_mode_stage.gd`. O checkout original permanece intacto. A alteração abaixo existe somente na cópia isolada usada para renderizar a prévia do site.

O raio da esfera passou de `0.10` para `0.18`, a altura de `0.20` para `0.36` e a cor de `#d9a8ff` para `#b51fff`. Um contorno geométrico roxo escuro (`#4d0a6b`), com faces frontais descartadas, mantém a esfera legível sobre as plataformas claras e o fundo escuro. A esfera e o contorno usam material `unshaded`, sem emissão ou sombras.

A altura-base do centro foi corrigida de `0.22` para `0.277`. As plataformas têm altura `0.15`; o raio externo do contorno é `0.18 × 1.10 = 0.198`. A base resulta de `0.075 + 0.198 + 0.004 = 0.277`: metade da altura da plataforma, raio externo e uma pequena folga. O movimento continua usando a interpolação linear original entre os centros, o arco `sin(fraction × PI) × 0.28` e a velocidade original. Câmera, luzes, plataformas, visibilidade (`phase < 7`), cadência dos saltos e ciclo de dez segundos foram preservados.

## Alteração na fixture

Na construção de `_parkour_marker`, substitua o raio/altura e a cor pelos valores acima. Preserve o material `unshaded`. Depois de adicionar `marker` à cena, acrescente:

```gdscript
var outline := MeshInstance3D.new()
outline.name = "WebParkourMarkerOutline"
outline.mesh = sphere
outline.scale = Vector3.ONE * 1.10
outline.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
var outline_material := StandardMaterial3D.new()
outline_material.albedo_color = Color("4d0a6b")
outline_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
outline_material.cull_mode = BaseMaterial3D.CULL_FRONT
outline.material_override = outline_material
marker.add_child(outline)
```

Em `present`, altere somente a altura-base da trajetória:

```gdscript
_parkour_marker.position = _parkour_blocks[index].position.lerp(
    _parkour_blocks[index + 1].position, fraction
) + Vector3.UP * (.277 + sin(fraction * PI) * .28)
```

## Verificação geométrica

Foram avaliados os sete saltos completos contra as oito plataformas, usando o raio externo `0.198`. Cada salto foi amostrado em `100.001` instantes, incluindo ambos os apoios: `5.600.056` testes de distância euclidiana entre o centro da esfera e a AABB fechada de cada plataforma, menos o raio. Esse teste inclui topos, laterais e quinas; não se limita aos pousos.

A menor folga amostrada foi `0.0019851244487755215`, no salto de índice `5` para `6`, contra a plataforma `6`, em `fraction = 0.09872`. Nos apoios a folga é `0.004`. A distância até uma AABB é uma função 1-Lipschitz. A velocidade máxima do centro, por unidade de `fraction`, é limitada por `L = 1.2990136358542592`. Como cada instante está a no máximo `0.000005` da amostra mais próxima, a folga contínua é pelo menos:

```text
0.0019851244487755215 - 1.2990136358542592 × 0.000005
= 0.0019786293805962502 > 0
```

Este cálculo reproduz a verificação em Node.js, sem dependências:

```javascript
const radius = .198, steps = 100000;
const boxes = Array.from({ length: 8 }, (_, i) => ({
  center: [Math.cos(i * .78) * .95, i * .20, Math.sin(i * .78) * .95],
  half: [(i % 3 ? .65 : .85) / 2, .075, (i % 2 ? .50 : .65) / 2]
}));
let minimum = Infinity, speed = 0, tests = 0;
for (let jump = 0; jump < 7; jump++) {
  const a = boxes[jump].center, b = boxes[jump + 1].center;
  speed = Math.max(speed, Math.hypot(b[0] - a[0], .20 + .28 * Math.PI, b[2] - a[2]));
  for (let sample = 0; sample <= steps; sample++) {
    const t = sample / steps;
    const p = a.map((v, axis) => v + (b[axis] - v) * t
      + (axis === 1 ? .277 + .28 * Math.sin(Math.PI * t) : 0));
    for (const box of boxes) {
      const d = p.map((v, axis) => Math.max(Math.abs(v - box.center[axis]) - box.half[axis], 0));
      minimum = Math.min(minimum, Math.hypot(...d) - radius);
      tests++;
    }
  }
}
const continuousLowerBound = minimum - speed / (2 * steps);
if (!(continuousLowerBound > 0)) throw new Error('Interseção possível');
console.log({ tests, minimum, speed, continuousLowerBound });
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

O poster é uma cópia direta de `frame00000000.png`. O vídeo mantém 640 × 360 pixels, 20 fps e 10 segundos. Não houve edição raster, interpolação, crossfade ou alteração de tempo na codificação. Foram inspecionados os frames `0`, `24`, `124`, `127` e `149`, incluindo pousos e o trecho mais próximo da plataforma seguinte.

O SHA-256 do `room_mode_stage.gd` original é `a3e75eceebe359854eff1d8bd6a69fa155f7f7b7a4e66cc35a226914ffd40d01`; o da fixture Parkour alterada é `1749c0316f1f2be0edea0dea3d7a69ee21d9cff609a81362b20c748b38e6ed0b`. Os hashes dos arquivos finais são registrados em `provenance.json`.
