/* Browser port of INVOX's InvoxBlockVortex, revision
 * 1d74177d6d12be982cd6d75995e5f290395132e3. Original authored voxel cells,
 * timing and cursor spring; responsive framing and native WebGL2 material. */
(() => {
  "use strict";
  const canvas = document.getElementById("lobby-canvas");
  if (!canvas) return;
  const stage = canvas.closest(".lobby-stage"), playButton = document.getElementById("lobby-play");
  const shapeButtons = [...document.querySelectorAll("[data-lobby-shape]")];
  const shapeLabels = document.querySelectorAll(".lobby-shape-name"), phaseLabels = document.querySelectorAll(".lobby-phase");
  const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: true, powerPreference: "low-power" });
  function unavailable() { stage?.classList.add("is-unavailable"); if (playButton) playButton.disabled = true; shapeButtons.forEach(button => { button.disabled = true; }); }
  if (!gl) { unavailable(); return; }
  const TAU = Math.PI * 2, BUILD = 3.2, HOLD = 6.2, UNBUILD = 2.2, CYCLE = 14, TURN = 1.65, TRANSFER_SCALE = 0.68;
  const clamp = (x, low = 0, high = 1) => Math.max(low, Math.min(high, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
  const smoothest = x => { x = clamp(x); return x * x * x * (x * (x * 6 - 15) + 10); };
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const length = a => Math.hypot(...a);
  const normal = a => mul(a, 1 / Math.max(length(a), 1e-8));
  const mix3 = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
  const rotateY = (a, t) => [a[0] * Math.cos(t) + a[2] * Math.sin(t), a[1], -a[0] * Math.sin(t) + a[2] * Math.cos(t)];
  const hex = value => [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16) / 255);
  const lighten = (a, t) => a.map(v => v + (1 - v) * t), darken = (a, t) => mul(a, 1 - t);
  const cells = () => new Map();
  const voxel = (form, x, y, z, color) => form.set(`${x},${y},${z}`, { point: [x, y, z], color });
  function makeForm(key, name, form, spacing, baseY) {
    const ordered = [...form.values()].sort((a, b) => a.point[1] - b.point[1]
      || (a.point[0] ** 2 + a.point[2] ** 2) - (b.point[0] ** 2 + b.point[2] ** 2)
      || a.point[2] - b.point[2] || a.point[0] - b.point[0]);
    return { key, name, positions: ordered.map(cell => add(mul(cell.point, spacing), [0, baseY, 0])), colors: ordered.map(cell => cell.color), extent: spacing * 0.925 };
  }
  function house() {
    const c = cells(), stone = hex("b8b1c6"), wall = hex("aaa1bc"), trim = hex("dbd5e5"), roof = hex("7548a3"), glass = hex("729eae"), dark = hex("44344f");
    for (let x = -5; x <= 5; x++) for (let z = -3; z <= 3; z++) voxel(c, x, 0, z, stone);
    for (let y = 1; y <= 5; y++) for (let x = -5; x <= 5; x++) for (let z = -3; z <= 3; z++) {
      if (Math.abs(x) !== 5 && Math.abs(z) !== 3) continue;
      let color = wall;
      if (Math.abs(z) === 3) {
        if (x >= -1 && x <= 0 && y <= 3) color = dark;
        else if ([-4, -3, 2, 3].includes(x) && [3, 4].includes(y)) color = glass;
      }
      if (Math.abs(x) === 5 && [-1, 0, 1].includes(z) && [3, 4].includes(y)) color = glass;
      if (y === 5 || (Math.abs(x) === 5 && Math.abs(z) === 3)) color = trim;
      voxel(c, x, y, z, color);
    }
    for (let x = -6; x <= 6; x++) {
      const roofY = 6 + Math.floor((6 - Math.abs(x)) * 0.65);
      for (let z = -4; z <= 4; z++) voxel(c, x, roofY, z, Math.abs(z) === 4 ? lighten(roof, 0.07) : roof);
      if (Math.abs(x) <= 5) for (let y = 6; y < roofY; y++) { voxel(c, x, y, -3, wall); voxel(c, x, y, 3, wall); }
    }
    for (let y = 8; y <= 11; y++) { voxel(c, -3, y, -1, darken(stone, 0.15)); voxel(c, -2, y, -1, darken(stone, 0.15)); }
    for (let x = -2; x <= 1; x++) voxel(c, x, 0, 4, trim);
    return makeForm("house", "Casa", c, 0.42, -2.35);
  }
  function robot() {
    const c = cells(), body = hex("a8a2b4"), pale = hex("cec8d9"), purple = hex("8254aa"), joint = hex("4d455c"), eyes = hex("9bcbd7");
    for (const side of [-1, 1]) {
      for (const x of [side, side * 2]) for (let y = 1; y <= 3; y++) for (let z = -1; z <= 1; z++) voxel(c, x, y, z, y === 3 ? joint : body);
      for (const x of [side, side * 2, side * 3]) for (let z = -1; z <= 2; z++) voxel(c, x, 0, z, purple);
    }
    for (let x = -3; x <= 3; x++) for (let y = 4; y <= 8; y++) for (let z = -1; z <= 1; z++) {
      let color = y >= 6 && z === 1 ? purple : body;
      if (x === 0 && y === 7 && z === 1) color = eyes;
      voxel(c, x, y, z, color);
    }
    for (const side of [-1, 1]) for (const y of [7, 8]) for (let z = -1; z <= 1; z++) voxel(c, side * 4, y, z, pale);
    for (const x of [-5, -4]) for (let y = 3; y <= 6; y++) for (const z of [0, 1]) voxel(c, x, y, z, y === 3 ? purple : body);
    for (const x of [4, 5]) for (let y = 9; y <= 11; y++) for (const z of [0, 1]) voxel(c, x, y, z, y === 11 ? purple : body);
    for (const x of [-1, 0, 1]) voxel(c, x, 9, 0, joint);
    for (let x = -2; x <= 2; x++) for (let y = 10; y <= 13; y++) for (let z = -1; z <= 1; z++) {
      let color = pale;
      if (z === 1 && y === 12) color = Math.abs(x) === 1 ? eyes : joint;
      if (z === 1 && y === 10 && Math.abs(x) <= 1) color = joint;
      voxel(c, x, y, z, color);
    }
    voxel(c, 0, 14, 0, purple);
    return makeForm("robot", "Robô", c, 0.36, -2.35);
  }
  function ship() {
    const c = cells(), hull = hex("b8b4c8"), pale = hex("d6d2df"), purple = hex("78509c"), underside = hex("5b526d"), cockpit = hex("7399ac"), engine = hex("aac6db");
    for (let z = -7; z <= 7; z++) {
      const halfWidth = z > 5 ? 0 : z > 1 ? 1 : 2;
      for (let x = -halfWidth; x <= halfWidth; x++) for (let y = 0; y <= 2; y++) voxel(c, x, y, z, y === 0 ? underside : hull);
    }
    for (let x = -1; x <= 1; x++) { for (let z = 0; z <= 4; z++) voxel(c, x, 3, z, cockpit); voxel(c, x, 4, 0, pale); }
    for (const side of [-1, 1]) {
      for (let width = 3; width <= 8; width++) {
        const rear = -2 - Math.floor((width - 3) * 0.55);
        for (let z = rear - 2; z < rear + 2; z++) voxel(c, side * width, 1, z, width >= 7 ? purple : pale);
        voxel(c, side * width, 2, rear, hull);
      }
      for (const x of [side, side * 2]) for (const y of [1, 2]) voxel(c, x, y, -8, engine);
    }
    for (let y = 3; y <= 6; y++) for (let z = -6; z <= -4; z++) if (z <= -4 - Math.floor((y - 3) * 0.5)) voxel(c, 0, y, z, y === 6 ? purple : pale);
    return makeForm("ship", "Nave", c, 0.34, -1.17);
  }
  const forms = [house(), robot(), ship()];
  const capacity = Math.max(...forms.map(form => form.positions.length));
  const offsets = Array.from({ length: capacity }, () => [0, 0, 0]);
  const velocities = Array.from({ length: capacity }, () => [0, 0, 0]);
  const instances = new Float32Array(capacity * 18);
  const random = index => { const x = Math.sin(index * 127.1 + 0x1A70C) * 43758.5453; return x - Math.floor(x); };
  function bevelMesh() {
    const vertices = [], axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], half = 0.5, bevel = 0.452;
    function face(points, n) { for (let i = 1; i < points.length - 1; i++) for (const point of [points[0], points[i], points[i + 1]]) vertices.push(...point, ...n); }
    for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
      const n = mul(axes[axis], sign), u = axes[(axis + 1) % 3], v = axes[(axis + 2) % 3];
      face([[-bevel, -bevel], [bevel, -bevel], [bevel, bevel], [-bevel, bevel]].map(p => add(mul(n, half), add(mul(u, p[0]), mul(v, p[1])))), n);
    }
    for (let axis = 0; axis < 3; axis++) for (const signA of [-1, 1]) for (const signB of [-1, 1]) {
      const a = mul(axes[axis], signA), b = mul(axes[(axis + 1) % 3], signB), c = axes[(axis + 2) % 3];
      face([add(add(mul(a, half), mul(b, bevel)), mul(c, -bevel)), add(add(mul(a, bevel), mul(b, half)), mul(c, -bevel)), add(add(mul(a, bevel), mul(b, half)), mul(c, bevel)), add(add(mul(a, half), mul(b, bevel)), mul(c, bevel))], normal(add(a, b)));
    }
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) face([[x * half, y * bevel, z * bevel], [x * bevel, y * half, z * bevel], [x * bevel, y * bevel, z * half]], normal([x, y, z]));
    return new Float32Array(vertices);
  }
  const vertexShader = `#version 300 es
  precision highp float;
  layout(location=0) in vec3 a_position; layout(location=1) in vec3 a_normal;
  layout(location=2) in vec3 i_position; layout(location=3) in vec3 i_x; layout(location=4) in vec3 i_y; layout(location=5) in vec3 i_z;
  layout(location=6) in vec3 i_color; layout(location=7) in vec3 i_custom;
  uniform mat4 u_viewProjection;
  out vec3 v_world; out vec3 v_normal; out vec3 v_local; out vec3 v_color; out vec3 v_custom;
  void main(){mat3 basis=mat3(i_x,i_y,i_z);v_world=basis*a_position+i_position;v_normal=normalize(basis*a_normal);v_local=a_position;v_color=i_color;v_custom=i_custom;gl_Position=u_viewProjection*vec4(v_world,1.0);}`;
  const fragmentShader = `#version 300 es
  precision highp float;
  in vec3 v_world;in vec3 v_normal;in vec3 v_local;in vec3 v_color;in vec3 v_custom;
  uniform vec3 u_eye;uniform vec3 u_key;uniform vec3 u_rim;uniform vec3 u_cursor;uniform float u_cursorEnergy;uniform float u_time;
  out vec4 outColor;
  vec3 toLinear(vec3 c){return pow(c,vec3(2.2));}
  vec3 light(vec3 n,vec3 view,vec3 direction,vec3 radiance,vec3 albedo,float rough){
    vec3 h=normalize(view+direction);float nv=max(dot(n,view),0.001);float nl=max(dot(n,direction),0.0);float nh=max(dot(n,h),0.0);float hv=max(dot(h,view),0.0);
    float a=rough*rough;float aa=a*a;float denom=nh*nh*(aa-1.0)+1.0;float distribution=aa/(3.14159265*denom*denom+0.0001);
    float k=(rough+1.0)*(rough+1.0)/8.0;float geometry=nv/(nv*(1.0-k)+k)*nl/(nl*(1.0-k)+k);
    vec3 f0=mix(vec3(0.04*0.64),albedo,0.27);vec3 fresnel=f0+(1.0-f0)*pow(1.0-hv,5.0);
    vec3 specular=distribution*geometry*fresnel/(4.0*nv*max(nl,0.001)+0.0001);return ((1.0-fresnel)*0.73*albedo/3.14159265+specular)*radiance*nl;
  }
  vec3 omni(vec3 n,vec3 view,vec3 position,vec3 color,float energy,float range,vec3 albedo,float rough){vec3 d=position-v_world;float attenuation=pow(max(1.0-length(d)/range,0.0),2.0);return light(n,view,normalize(d),color*energy*attenuation,albedo,rough);}
  void main(){
    vec3 n=normalize(v_normal),view=normalize(u_eye-v_world),v=abs(v_local);float second=max(min(v.x,v.y),min(max(v.x,v.y),v.z));float edge=smoothstep(0.402,0.474,second);float rim=pow(1.0-clamp(dot(n,view),0.0,1.0),3.5);
    float phase=v_custom.x*6.283185;float hover=v_custom.z;float reflection=v_custom.y;float pulse=0.88+0.12*sin(u_time*0.48+phase);float rough=mix(0.38,0.27,hover);
    vec3 albedo=toLinear(v_color)*vec3(1.08,0.78,1.0)*(0.88+edge*0.12);vec3 color=albedo*vec3(0.17,0.07,0.22)*0.62;
    color+=light(n,view,normalize(vec3(-0.283,0.743,0.607)),toLinear(vec3(0.93,0.81,1.0))*2.5,albedo,rough);
    color+=omni(n,view,u_key,toLinear(vec3(0.78,0.26,1.0)),3.2,13.0,albedo,rough);
    color+=omni(n,view,u_rim,toLinear(vec3(0.74,0.18,1.0)),2.5,14.0,albedo,rough);
    color+=omni(n,view,u_cursor,toLinear(vec3(0.88,0.25,1.0)),u_cursorEnergy,2.2,albedo,rough);
    vec3 violet=vec3(0.57,0.09,0.92),magenta=vec3(0.78,0.16,1.0);vec3 tint=mix(violet,magenta,0.5+0.5*sin(phase+u_time*0.08));
    color+=tint*(edge*0.13+rim*0.06)*pulse;color+=magenta*hover*(0.07+rim*0.09);color+=mix(vec3(0.72,0.16,1.0),vec3(0.90,0.25,1.0),rim)*reflection*(0.12+edge*0.20+rim*0.10);
    color=(color*(2.51*color+0.03))/(color*(2.43*color+0.59)+0.14);outColor=vec4(pow(clamp(color,0.0,1.0),vec3(1.0/2.2)),1.0);
  }`;
  let program, instanceBuffer, vertexCount;
  function compile(type, code) {
    const shader = gl.createShader(type); gl.shaderSource(shader, code); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { const error = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(error); }
    return shader;
  }
  try {
    const vertex = compile(gl.VERTEX_SHADER, vertexShader), fragment = compile(gl.FRAGMENT_SHADER, fragmentShader);
    program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const mesh = bevelMesh(); vertexCount = mesh.length / 6;
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const meshBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, meshBuffer); gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
    for (let attribute = 0; attribute < 2; attribute++) { gl.enableVertexAttribArray(attribute); gl.vertexAttribPointer(attribute, 3, gl.FLOAT, false, 24, attribute * 12); }
    instanceBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer); gl.bufferData(gl.ARRAY_BUFFER, instances.byteLength, gl.DYNAMIC_DRAW);
    for (let attribute = 2; attribute <= 7; attribute++) { gl.enableVertexAttribArray(attribute); gl.vertexAttribPointer(attribute, 3, gl.FLOAT, false, 72, (attribute - 2) * 12); gl.vertexAttribDivisor(attribute, 1); }
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.clearColor(0, 0, 0, 0);
  } catch (error) { unavailable(); console.warn("A visualização 3D do INVOX não pôde iniciar.", error); return; }
  const uniforms = Object.fromEntries(["viewProjection", "eye", "key", "rim", "cursor", "cursorEnergy", "time"].map(name => [name, gl.getUniformLocation(program, `u_${name}`)]));
  let width = 1, height = 1, elapsed = motionPreference.matches ? BUILD + 2 : BUILD + 0.6;
  let paused = motionPreference.matches, motionOptIn = false;
  const effectsEnabled = true;
  let visible = false, frame = 0, lastTime = 0, contextLost = false;
  let parallax = [0, 0], cursorUV = [0.5, 0.5], cursorInside = false, activeTouch = null, cursorEnergy = 0;
  let pointerClient = null;
  let currentKey = "", lastPhase = "";
  function cycleState() {
    const index = Math.floor(elapsed / CYCLE) % forms.length, local = elapsed % CYCLE;
    let phase = "build", time = local;
    if (local + 1e-6 >= BUILD + HOLD + UNBUILD) { phase = "stage"; time -= BUILD + HOLD + UNBUILD; }
    else if (local + 1e-6 >= BUILD + HOLD) { phase = "unbuild"; time -= BUILD + HOLD; }
    else if (local + 1e-6 >= BUILD) { phase = "hold"; time -= BUILD; }
    const form = forms[index], next = forms[(index + 1) % 3], previous = forms[(index + 2) % 3];
    return { index, form, next, previous, phase, time: Math.max(time, 0), count: form.positions.length, nextCount: next.positions.length, visible: phase === "stage" ? Math.max(form.positions.length, next.positions.length) : form.positions.length };
  }
  function transfer(form, index, fallback) {
    let point;
    if (index < form.positions.length) point = [...form.positions[index]];
    else { point = [...fallback.positions[index]]; point[0] *= 0.66; point[1] += 0.55; }
    point[0] *= 1.18; point[2] *= 1.18; point[1] = (point[1] + 0.7) * 1.32 - 0.40;
    return rotateY(point, TURN);
  }
  function blockPose(index, state) {
    const { form, next, previous } = state, rank = index / Math.max(state.count - 1, 1);
    let position = [0, 0, 0], rotation = [0, 0, 0], extent = 0.25, presence = 1, light = 0;
    let color = index < state.count ? form.colors[index] : next.colors[index];
    if (state.phase === "build") {
      const travel = clamp((state.time - rank * 2.25) / 0.95), eased = smoothest(travel);
      const origin = transfer(previous, index, form), destination = form.positions[index], arc = Math.sin(travel * Math.PI);
      const bend = clamp(length(sub(origin, destination)) * 0.15, 0.12, 0.72);
      position = add(mix3(origin, destination, eased), mul([Math.sin(rank * TAU) * bend * 0.44, bend, Math.cos(rank * TAU) * bend * 0.34], arc));
      rotation = [arc * 0.08, lerp(TURN, 0, eased), arc * -0.06]; extent = lerp(previous.extent * TRANSFER_SCALE, form.extent, eased);
      light = Math.exp(-(((travel - 0.92) * 10) ** 2)) * 0.90;
    } else if (state.phase === "hold") {
      const turn = TURN * smoothest(state.time / HOLD); rotation[1] = turn; position = rotateY(form.positions[index], turn); extent = form.extent;
      const scan = clamp((state.time - 0.12) / 1.55), scanHeight = lerp(-2.8, 3.3, scan);
      light = Math.exp(-(((position[1] - scanHeight) * 2.5) ** 2)) * (1 - smooth((state.time - 1.5) / 0.5)) * 0.62;
    } else if (state.phase === "unbuild") {
      const travel = clamp((state.time - (1 - rank) * 1.4) / 0.8), eased = smoothest(travel);
      position = mix3(rotateY(form.positions[index], TURN), transfer(form, index, next), eased); position[1] += Math.sin(travel * Math.PI) * 0.14;
      rotation[1] = TURN; extent = lerp(form.extent, form.extent * TRANSFER_SCALE, eased); light = Math.sin(travel * Math.PI) * 0.22;
    } else {
      const blend = smoothest((state.time - 0.25) / 1.85); position = transfer(form, index, next); rotation[1] = TURN; extent = form.extent * TRANSFER_SCALE;
      if (index < state.count && index < state.nextCount) color = mix3(color, next.colors[index], blend);
      else if (index >= state.count) presence = blend;
      else presence = 1 - blend;
    }
    return { position, rotation, extent: extent * Math.max(presence, 1e-5), color, light };
  }
  function eulerBasis(rotation) {
    const [x, y, z] = rotation, cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
    return [cy * cz + sy * sx * sz, cx * sz, -sy * cz + cy * sx * sz, -cy * sz + sy * sx * cz, cx * cz, sy * sz + cy * sx * cz, sy * cx, -sx, cy * cx];
  }
  function basisMultiply(a, b) {
    const result = new Array(9);
    for (let column = 0; column < 3; column++) for (let row = 0; row < 3; row++) result[column * 3 + row] = a[row] * b[column * 3] + a[3 + row] * b[column * 3 + 1] + a[6 + row] * b[column * 3 + 2];
    return result;
  }
  function camera(state) {
    let framing = 0;
    if (state.phase === "build") framing = 1 - smooth((state.time - 2.15) / (BUILD - 2.15));
    else if (state.phase === "unbuild") framing = smooth(state.time / 1.15);
    else if (state.phase === "stage") framing = 1;
    const distance = 11.6 * Math.max(1, 0.98 * height / width);
    let eye = rotateY(mul([6.1, 5.5, 11.8], distance / 14.2 * (1 + framing * 0.60)), Math.sin(elapsed * 0.19) * 0.035);
    eye[1] += Math.sin(elapsed * 0.26) * 0.10; eye = add(eye, [parallax[0] * 0.20, -parallax[1] * 0.12, 0]);
    const forward = normal(sub([0, -0.70, 0], eye)), right = normal(cross(forward, [0, 1, 0])), up = cross(right, forward);
    const view = [right[0], up[0], -forward[0], 0, right[1], up[1], -forward[1], 0, right[2], up[2], -forward[2], 0, -dot(right, eye), -dot(up, eye), dot(forward, eye), 1];
    const f = 1 / Math.tan(38 * Math.PI / 360), near = 0.2, far = 50;
    const projection = [f * height / width, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0], matrix = new Float32Array(16);
    for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++) for (let k = 0; k < 4; k++) matrix[column * 4 + row] += projection[k * 4 + row] * view[column * 4 + k];
    return { eye, forward, right, up, f, matrix };
  }
  function react(index, pose, view, delta) {
    let target = [0, 0, 0]; const local = sub(pose.position, view.eye), depth = dot(local, view.forward);
    if (cursorInside && depth > 0.20001) {
      const px = width * 0.5 + dot(local, view.right) * view.f * height * 0.5 / depth, py = height * 0.5 - dot(local, view.up) * view.f * height * 0.5 / depth;
      const dx = px - cursorUV[0] * width, dy = py - cursorUV[1] * height, distance = Math.hypot(dx, dy);
      if (distance < 232) {
        const direction = distance > 0.01 ? [dx / distance, dy / distance] : [1, 0], falloff = (1 - distance / 232) ** 1.5;
        const worldDirection = sub(mul(view.right, direction[0]), mul(view.up, direction[1])), tangent = sub(mul(view.right, -direction[1]), mul(view.up, direction[0]));
        target = mul(add(worldDirection, mul(tangent, 0.22)), 1.85 * falloff);
      }
    }
    let offset = offsets[index], velocity = velocities[index];
    if (delta > 0) {
      const steps = Math.max(1, Math.ceil(delta / 0.008)), step = delta / steps;
      for (let iteration = 0; iteration < steps; iteration++) {
        velocity = add(velocity, mul(sub(mul(sub(target, offset), 145), mul(velocity, 17)), step)); offset = add(offset, mul(velocity, step));
        if (length(offset) > 2.10) offset = mul(normal(offset), 2.10);
      }
      if (length(velocity) > 11) velocity = mul(normal(velocity), 11);
      velocities[index] = velocity; offsets[index] = offset;
    }
    pose.position = add(pose.position, offset); pose.basis = basisMultiply(eulerBasis([-offset[1] * 0.22, offset[0] * 0.24, offset[0] * 0.18]), eulerBasis(pose.rotation)).map(value => value * pose.extent);
    pose.response = clamp(length(offset) / 0.85); return pose;
  }
  function updateLabels(state) {
    if (currentKey !== state.form.key) {
      currentKey = state.form.key; shapeLabels.forEach(label => { label.textContent = state.form.name; });
      shapeButtons.forEach(button => { const active = button.dataset.lobbyShape === currentKey; button.classList.toggle("is-active", active); button.setAttribute("aria-pressed", String(active)); });
    }
    if (lastPhase !== state.phase) {
      lastPhase = state.phase;
      const names = { build: "Montando", hold: "Forma completa", unbuild: "Desmontando", stage: "Próxima forma" };
      phaseLabels.forEach(label => { label.textContent = names[state.phase]; }); if (stage) stage.dataset.phase = state.phase;
    }
    if (playButton) {
      const stopped = paused || !effectsEnabled || (motionPreference.matches && !motionOptIn);
      playButton.setAttribute("aria-pressed", String(stopped));
      if (playButton.getAttribute("role") === "switch") playButton.setAttribute("aria-checked", String(!stopped));
      playButton.setAttribute("aria-label", stopped ? "Continuar animação" : "Pausar animação"); playButton.disabled = !effectsEnabled;
      const icon = playButton.querySelector("i"), label = playButton.querySelector("span");
      if (icon) { icon.classList.toggle("fa-play", stopped); icon.classList.toggle("fa-pause", !stopped); }
      if (label) label.textContent = stopped ? "Continuar" : "Pausar";
    }
  }
  function render(delta = 0) {
    if (contextLost) return;
    const state = cycleState(), view = camera(state);
    for (let index = 0; index < state.visible; index++) {
      const pose = react(index, blockPose(index, state), view, delta), cursor = index * 18;
      instances.set(pose.position, cursor); instances.set(pose.basis, cursor + 3); instances.set(pose.color, cursor + 12); instances.set([random(index), pose.light, pose.response], cursor + 15);
    }
    gl.useProgram(program); gl.viewport(0, 0, canvas.width, canvas.height); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(uniforms.viewProjection, false, view.matrix); gl.uniform3fv(uniforms.eye, view.eye);
    gl.uniform3fv(uniforms.key, [-3.4 + Math.sin(elapsed * 0.16) * 0.45, 4.6, 3]); gl.uniform3fv(uniforms.rim, [3.5, 2.2 + Math.sin(elapsed * 0.18) * 0.25, -3.2]);
    const ray = normal(add(view.forward, add(mul(view.right, (cursorUV[0] * 2 - 1) * width / height / view.f), mul(view.up, (1 - cursorUV[1] * 2) / view.f))));
    gl.uniform3fv(uniforms.cursor, add(view.eye, mul(ray, 11))); gl.uniform1f(uniforms.cursorEnergy, cursorEnergy); gl.uniform1f(uniforms.time, elapsed);
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer); gl.bufferSubData(gl.ARRAY_BUFFER, 0, instances.subarray(0, state.visible * 18));
    gl.drawArraysInstanced(gl.TRIANGLES, 0, vertexCount, state.visible); updateLabels(state);
  }
  function clearPointer(reset = false, forgetPosition = false) {
    cursorInside = false; cursorUV = [0.5, 0.5]; activeTouch = null;
    if (forgetPosition || pointerClient?.type !== "mouse") pointerClient = null;
    if (reset) { parallax = [0, 0]; cursorEnergy = 0; for (let i = 0; i < capacity; i++) { offsets[i] = [0, 0, 0]; velocities[i] = [0, 0, 0]; } }
  }
  function running() { return visible && !document.hidden && effectsEnabled && !paused && (!motionPreference.matches || motionOptIn) && !contextLost; }
  function schedule() {
    if (running() && !frame) { lastTime = 0; frame = requestAnimationFrame(tick); }
    else if (!running() && frame) { cancelAnimationFrame(frame); frame = 0; lastTime = 0; }
  }
  function tick(timestamp) {
    frame = 0; if (!running()) return;
    const delta = lastTime ? Math.min((timestamp - lastTime) / 1000, 0.1) : 0;
    lastTime = timestamp; elapsed = (elapsed + delta) % (CYCLE * 300);
    refreshPointer();
    const target = cursorInside ? [clamp(cursorUV[0] - 0.5, -0.5, 0.5) * 2, clamp(cursorUV[1] - 0.5, -0.5, 0.5) * 2] : [0, 0];
    const response = 1 - Math.exp(-delta * 1.8); parallax = parallax.map((value, i) => lerp(value, target[i], response)); cursorEnergy = lerp(cursorEnergy, cursorInside ? 1.45 : 0, 1 - Math.exp(-delta * 7));
    render(delta); if (running()) frame = requestAnimationFrame(tick);
  }
  function resize() {
    const box = canvas.getBoundingClientRect(); width = Math.max(box.width, 1); height = Math.max(box.height, 1);
    const pixelRatio = Math.min(devicePixelRatio || 1, 2), cap = Math.min(1, 1600 / (width * pixelRatio), 1100 / (height * pixelRatio));
    canvas.width = Math.max(1, Math.round(width * pixelRatio * cap)); canvas.height = Math.max(1, Math.round(height * pixelRatio * cap)); render();
  }
  function setPaused(value) { paused = Boolean(value); if (!paused) motionOptIn = true; else clearPointer(true); render(); schedule(); }
  function selectShape(key) {
    const index = forms.findIndex(form => form.key === key); if (index < 0) return;
    elapsed = index * CYCLE + (paused || !effectsEnabled || (motionPreference.matches && !motionOptIn) ? BUILD + 2 : 0);
    clearPointer(true); render(); schedule();
  }
  shapeButtons.forEach(button => button.addEventListener("click", () => selectShape(button.dataset.lobbyShape)));
  playButton?.addEventListener("click", () => setPaused(!paused));
  function refreshPointer() {
    cursorInside = false;
    if (!pointerClient) return;
    const box = canvas.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    cursorUV = [(pointerClient.x - box.left) / box.width, (pointerClient.y - box.top) / box.height];
    const inside = cursorUV.every(value => value >= 0 && value <= 1) && running();
    cursorInside = inside && (pointerClient.type === "mouse"
      ? document.elementFromPoint(pointerClient.x, pointerClient.y) === canvas
      : pointerClient.id === activeTouch);
  }
  function pointerPosition(event) {
    pointerClient = { x: event.clientX, y: event.clientY, type: event.pointerType, id: event.pointerId };
    refreshPointer();
  }
  window.addEventListener("pointermove", event => {
    if (event.pointerType === "mouse" && activeTouch === null) pointerClient = { x: event.clientX, y: event.clientY, type: "mouse", id: event.pointerId };
  }, { passive: true });
  window.addEventListener("pointerout", event => {
    if (event.pointerType === "mouse" && activeTouch === null && event.relatedTarget === null) clearPointer(false, true);
  }, { passive: true });
  canvas.addEventListener("pointermove", event => { if ((event.pointerType === "mouse" && activeTouch === null) || event.pointerId === activeTouch) pointerPosition(event); });
  canvas.addEventListener("pointerenter", event => { if (event.pointerType === "mouse" && activeTouch === null) pointerPosition(event); });
  canvas.addEventListener("pointerleave", () => clearPointer());
  canvas.addEventListener("pointerdown", event => { if (event.pointerType !== "mouse" && activeTouch === null && running()) { activeTouch = event.pointerId; canvas.setPointerCapture(event.pointerId); pointerPosition(event); } });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) canvas.addEventListener(name, event => { if (event.pointerId === activeTouch) clearPointer(); });
  canvas.addEventListener("keydown", event => {
    if ([" ", "Enter"].includes(event.key)) { event.preventDefault(); if (effectsEnabled) setPaused(!paused); }
    else if (["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); const state = cycleState(); selectShape(forms[(state.index + (event.key === "ArrowRight" ? 1 : 2)) % 3].key); }
  });
  canvas.addEventListener("webglcontextlost", event => { event.preventDefault(); contextLost = true; schedule(); stage?.classList.remove("is-ready"); unavailable(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) clearPointer(true, true); schedule(); });
  window.addEventListener("blur", () => { clearPointer(true, true); render(); });
  motionPreference.addEventListener("change", event => { if (event.matches) { paused = true; motionOptIn = false; clearPointer(true); render(); } schedule(); });
  const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(canvas);
  const visibilityObserver = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; if (!visible) clearPointer(true); schedule(); }, { threshold: 0.02 }); visibilityObserver.observe(canvas);
  stage?.classList.add("is-ready"); resize();
  window.INVOXLobby = Object.freeze({ selectShape, setPaused, getState: () => { const state = cycleState(); return { ready: true, elapsed, form: state.form.name, next: state.next.name, phase: state.phase, blocks: state.visible, capacity, paused, effects: effectsEnabled, running: running(), shapes: forms.map(form => ({ key: form.key, name: form.name, blocks: form.positions.length })) }; } });
})();
