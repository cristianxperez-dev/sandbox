/* Call the Game — ballpark at regulation dimensions (metres; x = first-base side, z toward the catcher, home plate front at z = 0).
   Infield painted top-down into a texture at true scale (accurate lines, arcs and boxes); mound, plate and rubber as geometry;
   outfield wall 330 ft down the lines to 400 ft in centre, batter's eye, tiered stands with a crowd texture, light towers, sky. */
import { THREE, FT, RUBBER_Z, MOUND_H } from "./world3d.js";

const HOME = new THREE.Vector2(0, 0.708 * FT);          // centre of the plate (front edge at z = 0)
const wallR = (a) => (330 + 70 * Math.pow(Math.cos(a * 2), 2)) * FT * (Math.abs(a) <= Math.PI / 4 ? 1 : 1);   // a = angle from centre field

function infieldTexture(size, span) {
  // top-down painting centred on the plate, span metres across; +x right, canvas y = toward the pitcher (−z)
  const c = document.createElement("canvas"); c.width = c.height = size; const g = c.getContext("2d");
  const k = size / span, cx = size / 2, cy = size * 0.86;
  const P = (x, z) => [cx + x * k, cy + z * k];                 // world (x, z) → canvas
  // grass with mowing stripes
  g.fillStyle = "#3f7a33"; g.fillRect(0, 0, size, size);
  for (let i = -30; i < 30; i++) { if (i % 2) continue; g.save(); g.translate(...P(0, 0)); g.rotate(Math.PI / 4); g.fillStyle = "rgba(255,255,255,.035)"; g.fillRect(i * 4.5 * k, -200 * k, 4.5 * k, 400 * k); g.restore(); }
  for (let i = -30; i < 30; i++) { if (i % 2) continue; g.save(); g.translate(...P(0, 0)); g.rotate(-Math.PI / 4); g.fillStyle = "rgba(0,0,0,.03)"; g.fillRect(i * 4.5 * k, -200 * k, 4.5 * k, 400 * k); g.restore(); }
  const dirt = "#ab774e";
  // infield skin: 95-ft arc from the front of the rubber, between the foul lines
  const rub = P(0, RUBBER_Z);
  g.fillStyle = dirt; g.beginPath(); g.moveTo(...P(0, 0));
  g.arc(rub[0], rub[1], 95 * FT * k, Math.PI * 1.25 - 0.5, Math.PI * 1.75 + 0.5); g.closePath(); g.fill();
  // infield grass: the square inside the base paths
  const b = 90 * FT / Math.SQRT2;
  g.fillStyle = "#417c35"; g.beginPath(); const inset = 3 * FT;
  // grass runs right up to the foul lines from home to first and third; the skin is only the arc behind the bases
  g.moveTo(...P(0, 0)); g.lineTo(...P(b + 2, -b + 2)); g.lineTo(...P(b, -b)); g.lineTo(...P(0, -2 * b + inset)); g.lineTo(...P(-b, -b)); g.lineTo(...P(-b - 2, -b + 2)); g.closePath(); g.fill();
  // home-plate circle, mound circle, base cut-outs
  const circ = (x, z, r, col) => { g.fillStyle = col; g.beginPath(); g.arc(...P(x, z), r * k, 0, Math.PI * 2); g.fill(); };
  circ(0, HOME.y, 13 * FT, dirt); circ(0, RUBBER_Z + 1.5 * FT, 9 * FT, dirt);
  for (const [x, z] of [[b, -b], [0, -2 * b], [-b, -b]]) circ(x, z, 13 * FT, dirt);
  // base paths (3 ft either side of the line)
  g.strokeStyle = dirt; g.lineWidth = 6 * FT * k; g.lineCap = "round";
  // (home → first and home → third stay grass, as in modern parks: only the chalk foul line runs there)
  g.beginPath(); g.moveTo(...P(b, -b)); g.lineTo(...P(0, -2 * b)); g.lineTo(...P(-b, -b)); g.stroke();
  // chalk: foul lines, batter's boxes, catcher's box, coach's boxes
  g.strokeStyle = "#f3efe6"; g.lineWidth = Math.max(1.5, 0.076 * k); g.lineCap = "butt";
  for (const s of [-1, 1]) { g.beginPath(); g.moveTo(...P(s * 0.708 * FT * 0 + s * 3 * FT, -3 * FT + 0 * 0)); g.lineTo(...P(s * 140, -140)); g.stroke(); }
  const w = 8.5 / 12 * FT;
  for (const s of [-1, 1]) { const x0 = s * (w + 6 / 12 * FT), x1 = s * (w + 6 / 12 * FT + 4 * FT); const zf = -(3 * FT) + w, zb = 3 * FT + w;
    g.beginPath(); g.moveTo(...P(x0, zf)); g.lineTo(...P(x1, zf)); g.lineTo(...P(x1, zb)); g.lineTo(...P(x0, zb)); g.closePath(); g.stroke(); }
  g.beginPath(); g.moveTo(...P(-21.5 / 12 * FT, 3 * FT + w)); g.lineTo(...P(-21.5 / 12 * FT, 3 * FT + w + 8 * FT)); g.lineTo(...P(21.5 / 12 * FT, 3 * FT + w + 8 * FT)); g.lineTo(...P(21.5 / 12 * FT, 3 * FT + w)); g.stroke();
  // on-deck circles
  for (const s of [-1, 1]) { g.fillStyle = "#3a6f2f"; g.beginPath(); g.arc(...P(s * 37 * FT, 12 * FT), 2.5 * FT * k, 0, Math.PI * 2); g.fill(); }
  // dirt texture noise
  const img = g.getImageData(0, 0, size, size), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 14; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return { tex, cx, cy, k, span };
}

function crowdTexture() {
  const c = document.createElement("canvas"); c.width = 512; c.height = 128; const g = c.getContext("2d");
  g.fillStyle = "#30343b"; g.fillRect(0, 0, 512, 128);
  const cols = ["#8f8a80", "#6a2a2e", "#3b4a66", "#a7a297", "#6d727b", "#7d4a42", "#9c917c", "#2f3a52", "#4d535d"];
  for (let r = 0; r < 16; r++) for (let x = 0; x < 512; x += 4) { if (Math.random() < 0.25) continue; g.fillStyle = cols[(Math.random() * cols.length) | 0]; g.fillRect(x + Math.random(), r * 8 + 2, 3, 4); }
  for (let r = 0; r < 16; r++) { g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(0, r * 8 + 6.5, 512, 1.5); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.repeat.set(24, 1); return t;
}

export function buildStadium(scene, quality = "high") {
  const grp = new THREE.Group();
  const std = (col, r = 0.9, m = 0) => new THREE.MeshStandardMaterial({ color: col, roughness: r, metalness: m });
  // sky dome
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: new THREE.Color("#4f86c6") }, mid: { value: new THREE.Color("#a9c7e6") }, bot: { value: new THREE.Color("#dfe8ef") } },
    vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: "uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.6, h)) : mix(bot, mid, smoothstep(-0.02, 0.12, h)); gl_FragColor = vec4(c, 1.0); }" }));
  grp.add(sky); scene.background = null; scene.fog = new THREE.Fog("#c6d6e4", 90, 330);
  // ground: the painted infield near home; a large mowed outfield beyond
  const span = 70, inf = infieldTexture(quality === "low" ? 1024 : 2048, span);
  const near = new THREE.Mesh(new THREE.PlaneGeometry(span, span), std("#ffffff", 0.95)); near.material.map = inf.tex;
  near.rotation.x = -Math.PI / 2; near.position.set(0, 0, -(span * 0.86 - span / 2)); near.receiveShadow = true; grp.add(near);
  const far = new THREE.Mesh(new THREE.CircleGeometry(170, 64), std("#3e7832")); far.rotation.x = -Math.PI / 2; far.position.y = -0.02; grp.add(far);
  // warning track + wall + batter's eye
  const track = new THREE.Mesh(new THREE.RingGeometry(1, 1.0001, 4), std("#9c6f4a")); grp.add(track); track.visible = false;
  const segs = 64, wallH = 10 * FT, pts = [];
  for (let i = 0; i <= segs; i++) { const a = -Math.PI / 4 - 0.06 + (i / segs) * (Math.PI / 2 + 0.12); pts.push([Math.sin(a) * wallR(a), -Math.cos(a) * wallR(a) + HOME.y]); }
  const wallGeo = new THREE.BufferGeometry(), wv = [], trk = [];
  for (let i = 0; i < segs; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
    wv.push(x0, 0, z0, x1, 0, z1, x1, wallH, z1, x0, 0, z0, x1, wallH, z1, x0, wallH, z0);
    const s = 1 - 15 * FT / Math.hypot(x0, z0 - HOME.y), s1 = 1 - 15 * FT / Math.hypot(x1, z1 - HOME.y);
    trk.push(x0 * s, 0.01, (z0 - HOME.y) * s + HOME.y, x1 * s1, 0.01, (z1 - HOME.y) * s1 + HOME.y, x1, 0.01, z1, x0 * s, 0.01, (z0 - HOME.y) * s + HOME.y, x1, 0.01, z1, x0, 0.01, z0);
  }
  wallGeo.setAttribute("position", new THREE.Float32BufferAttribute(wv, 3)); wallGeo.computeVertexNormals();
  grp.add(new THREE.Mesh(wallGeo, new THREE.MeshStandardMaterial({ color: "#1f3a2a", roughness: 0.9, side: THREE.DoubleSide })));
  const tg = new THREE.BufferGeometry(); tg.setAttribute("position", new THREE.Float32BufferAttribute(trk, 3)); tg.computeVertexNormals();
  grp.add(new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ color: "#9a6c48", roughness: 1, side: THREE.DoubleSide })));
  const eye = new THREE.Mesh(new THREE.BoxGeometry(48 * FT, 30 * FT, 2), std("#1b3324", 1)); eye.position.set(0, 15 * FT, -wallR(0) - 6 + HOME.y); grp.add(eye);
  // yellow top-of-wall line
  const lineG = new THREE.BufferGeometry().setFromPoints(pts.map(([x, z]) => new THREE.Vector3(x, wallH + 0.02, z)));
  grp.add(new THREE.Line(lineG, new THREE.LineBasicMaterial({ color: "#d8b13b" })));
  // stands: three tiers behind the outfield and down the lines, crowd texture, a cream facade band
  const crowd = crowdTexture(), standMat = new THREE.MeshStandardMaterial({ map: crowd, roughness: 1 }), facade = std("#e9e2d2", 0.8), roof = std("#2d3440", 0.7);
  const tiers = [[11, 40, 3, 30], [58, 96, 42, 32]];        // [front height ft, back height ft, setback m, depth m]
  for (const [y0, y1, d0, dep] of tiers) {
    const g = new THREE.BufferGeometry(), v = [], uv = [], N = 72, a0 = -Math.PI / 2 - 0.2, a1 = Math.PI / 2 + 0.2;
    for (let i = 0; i < N; i++) {
      const aa = a0 + (i / N) * (a1 - a0), ab = a0 + ((i + 1) / N) * (a1 - a0);
      const R = (a) => Math.max(wallR(Math.max(-Math.PI / 4, Math.min(Math.PI / 4, a))) * (Math.abs(a) > Math.PI / 4 ? 0.92 : 1), 80);
      const p = (a, r, y) => [Math.sin(a) * r, y, -Math.cos(a) * r + HOME.y];
      const A0 = p(aa, R(aa) + d0, y0 * FT), B0 = p(ab, R(ab) + d0, y0 * FT), A1 = p(aa, R(aa) + d0 + dep, y1 * FT), B1 = p(ab, R(ab) + d0 + dep, y1 * FT);
      v.push(...A0, ...B0, ...B1, ...A0, ...B1, ...A1); uv.push(i / N, 0, (i + 1) / N, 0, (i + 1) / N, 1, i / N, 0, (i + 1) / N, 1, i / N, 1);
    }
    g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, standMat); m.material.side = THREE.DoubleSide; grp.add(m);
    // fascia under the front row of each deck
    const fg = new THREE.BufferGeometry(), fv = [];
    for (let i = 0; i < N; i++) {
      const aa = a0 + (i / N) * (a1 - a0), ab = a0 + ((i + 1) / N) * (a1 - a0);
      const R = (a) => Math.max(wallR(Math.max(-Math.PI / 4, Math.min(Math.PI / 4, a))) * (Math.abs(a) > Math.PI / 4 ? 0.92 : 1), 80);
      const p = (a, r, y) => [Math.sin(a) * r, y, -Math.cos(a) * r + HOME.y];
      const top = y0 * FT, bot = (y0 - (y0 > 30 ? 9 : 2)) * FT;
      const A = p(aa, R(aa) + d0, top), B = p(ab, R(ab) + d0, top), Ab = p(aa, R(aa) + d0, bot), Bb = p(ab, R(ab) + d0, bot);
      fv.push(...Ab, ...Bb, ...B, ...Ab, ...B, ...A);
    }
    fg.setAttribute("position", new THREE.Float32BufferAttribute(fv, 3)); fg.computeVertexNormals();
    grp.add(new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ color: y0 > 30 ? "#e6dfcf" : "#26313d", roughness: 0.8, side: THREE.DoubleSide })));
  }
  // light towers
  for (const s of [-1, 1]) for (const a of [0.55, 1.15]) {
    const r = 150, x = s * Math.sin(a) * r, z = -Math.cos(a) * r + HOME.y;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 48, 8), roof); pole.position.set(x, 24, z); grp.add(pole);
    const bank = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 1), std("#d9dde2", 0.4, 0.3)); bank.position.set(x, 50, z); bank.lookAt(0, 0, 0); grp.add(bank);
  }
  // plate, mound and rubber as geometry
  const s = new THREE.Shape(), w = 8.5 / 12 * FT; s.moveTo(-w, 0); s.lineTo(w, 0); s.lineTo(w, w); s.lineTo(0, 2 * w); s.lineTo(-w, w); s.closePath();
  const plate = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false }), std("#f6f4ee", 0.55)); plate.rotation.x = Math.PI / 2; plate.position.y = 0.012; plate.receiveShadow = true; grp.add(plate);
  const prof = []; const R = 9 * FT;
  for (let i = 0; i <= 28; i++) { const r = (i / 28) * R; prof.push(new THREE.Vector2(r, r < 0.55 ? MOUND_H : Math.max(0, MOUND_H - (r - 0.55) * (1 / 12) * 1.15))); }
  prof.push(new THREE.Vector2(R + 0.05, 0));
  const mound = new THREE.Mesh(new THREE.LatheGeometry(prof.reverse(), 56), std("#b1805a", 0.98)); mound.position.set(0, 0, RUBBER_Z + 1.5 * FT); mound.receiveShadow = true; grp.add(mound);
  const rubber = new THREE.Mesh(new THREE.BoxGeometry(24 / 12 * FT, 0.03, 6 / 12 * FT), std("#f6f3ec", 0.6)); rubber.position.set(0, MOUND_H + 0.012, RUBBER_Z); grp.add(rubber);
  // bases
  const b = 90 * FT / Math.SQRT2;
  for (const [x, z] of [[b, -b], [0, -2 * b], [-b, -b]]) { const base = new THREE.Mesh(new THREE.BoxGeometry(18 / 12 * FT, 0.08, 18 / 12 * FT), std("#f7f6f1", 0.6)); base.position.set(x, 0.04, z + HOME.y * 0); base.rotation.y = Math.PI / 4; grp.add(base); }
  scene.add(grp);
  return grp;
}
