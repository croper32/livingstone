// The house in your hand — the listing engine's exploded, plan-textured model (engine/template/src/js/rooms.js buildModel,
// Morewood gl.js lineage), rendered into a moving screen rect. Geometry is the engine's, unchanged: plate = the level's own
// plan crop, walls from listing.json through walls.js, room polygons in plan_px through the level transform.
// W2 additions: room fills in each room's sampled wall colour, a "you are here" glow, level lift that follows the film's floor,
// and camera.setViewOffset so ONE fixed full-viewport canvas draws the model into any rect (hand card, stop panel, ending).
import D from './data.js';
import { wallPieces } from './walls.js';
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const LEVELS = D.levels, ORDER = D.order;
const ROOMS = D.rooms;
const toPlanWorld = (lvl, x, y) => { const t = LEVELS[lvl].tf, c = Math.cos(t.rot * Math.PI / 180), s = Math.sin(t.rot * Math.PI / 180); return [t.ox + t.s * (c * x - s * y), t.oz + t.s * (s * x + c * y)]; };
// W3b: a cheap probe. The old one created a throwaway WebGL context (~24 ms on a 4x-throttled phone, at module run, twice);
// createModel makes the real context and throws into the flat fallback if it cannot.
export function glAvailable() {
  if (new URLSearchParams(location.search).has('nowebgl')) return false;
  return !!window.WebGLRenderingContext;
}

// W3b: the build is SLICED. W3 ran it as one ~130 ms task (4x-throttled phone) once scrolling paused; a scroll that
// resumed during it held the screen 125–153 ms (traced: TimerFire → three.js setSize/texSubImage2D/program link).
// Now each step is its own task, and `slice()` (the caller's) runs before each one: it yields to input and, on phones,
// waits while the page is being scrolled. Textures decode off the main thread (createImageBitmap); programs are compiled
// up front and their link is polled (KHR_parallel_shader_compile where available). The steps are short but NOT bounded:
// module evaluation, context creation, one level's geometry, the compile call and the first render are each indivisible
// (measured at 4x CPU: ≤ ~25 ms each untraced, ~30 ms traced; W3b-NOTES §2) — a scroll that resumes inside one waits for it.
// Context loss at any point rejects into the caller's flat fallback, and a failed build releases what it allocated (Codex review c1 #1, #4).
export async function createModel(opts) {
  const own = { bitmaps: [], renderer: null, labels: [], resize: null, lost: false };
  const onLost = () => { own.lost = true; };
  opts.canvas.addEventListener('webglcontextlost', onLost);
  try { return await buildModel(opts, own); }
  catch (e) {
    own.failed = true;
    for (const b of own.bitmaps) b.close?.();
    if (own.resize) removeEventListener('resize', own.resize);
    for (const el of own.labels) el.remove();
    try { own.renderer?.dispose(); } catch {}
    throw e;
  } finally { opts.canvas.removeEventListener('webglcontextlost', onLost); }
}
async function buildModel({ canvas, labelsEl, reduced, slice = () => new Promise(r => setTimeout(r, 0)) }, own) {
  const T = window.__modelSteps = [];
  const live = () => { if (own.lost || own.renderer?.getContext().isContextLost()) throw new Error('WebGL context lost'); };
  const step = async (name, fn) => { await slice(); live(); const t0 = performance.now(); const v = await fn(); T.push([name, +(performance.now() - t0).toFixed(1)]); live(); return v; };
  const THREE = await import('../vendor/three.module.min.js');
  const loadTex = async url => { const b = await (await fetch(url)).blob(); const bm = await createImageBitmap(b, { imageOrientation: 'flipY', premultiplyAlpha: 'none' }); if (own.failed) { bm.close?.(); throw new Error('build abandoned'); } own.bitmaps.push(bm); // a decode finishing after a failed build is released (Codex review c2 #1)
    const t = new THREE.Texture(bm); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t; }; // decoded off the main thread; flipped at decode = TextureLoader's flipY
  const toWorld = (lvl, x, y) => { const [X, Z] = toPlanWorld(lvl, x, y); return new THREE.Vector3(X, 0, Z); };
  const texes = {}; await Promise.all(ORDER.map(async k => { texes[k] = await loadTex(LEVELS[k].plate); }));
  const renderer = await step('context', () => own.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: false })); // W3b: was preserveDrawingBuffer: true — a preserved full-viewport buffer held the whole window's presentation (45–120 ms holds in the recede tails while the model re-rendered; A/B: tails stress 2/2 runs with a stall → 0/2 without WebGL, 1 marginal 42.9 ms in 4 with this change). The model renders on demand with a full clear every time, so nothing relies on the preserved buffer.
  own.renderer = renderer; renderer.autoClear = false;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, .1, 400);
  scene.add(new THREE.HemisphereLight(0xfff8ee, 0x6d6257, 1.35));
  const sun = new THREE.DirectionalLight(0xfff1dd, 1.8); sun.position.set(10, 30, 14); scene.add(sun);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const groups = {}, centres = {}, fills = {}, outlines = {};
  for (const key of ORDER) await step('level ' + key, () => {
    const L = LEVELS[key]; const g = new THREE.Group(); g.userData = { mats: [] };
    const rot = L.tf.rot * Math.PI / 180;
    const a = toWorld(key, 0, 0), c0 = toWorld(key, L.w / 2, L.h / 2); const wM = L.w * L.tf.s, dM = L.h * L.tf.s;
    const tex = texes[key]; tex.anisotropy = maxAniso;
    const top = new THREE.MeshStandardMaterial({ map: tex, roughness: .95, transparent: true });
    const side = new THREE.MeshStandardMaterial({ color: 0xD9D2C2, roughness: 1, transparent: true });
    const board = new THREE.Mesh(new THREE.BoxGeometry(wM, .16, dM), [side, side, top, side, side, side]);
    if (rot) board.position.set(c0.x, -.08, c0.z), board.rotation.y = -rot; else board.position.set(a.x + wM / 2, -.08, a.z + dM / 2);
    g.add(board); g.userData.mats.push(top, side);
    const m = new THREE.MeshStandardMaterial({ color: 0xF6F2EA, roughness: .85, transparent: true }); g.userData.mats.push(m);
    const pieces = wallPieces(D.walls[key] || [], (x, y) => toPlanWorld(key, x, y), { s: L.tf.s, rot, wallH: D.wallH, postH: D.postH, postM: 8 / 43.5 });
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), m, Math.max(1, pieces.boxes.length)); const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    pieces.boxes.forEach((bx, i) => { q.setFromAxisAngle(up, -bx.yaw); mtx.compose(new THREE.Vector3(bx.x, bx.h / 2, bx.z), q, new THREE.Vector3(bx.w, bx.h, bx.d)); inst.setMatrixAt(i, mtx); });
    if (!pieces.boxes.length) inst.count = 0;
    for (const pw of pieces.polys) { const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pw.pts.map(([x, z]) => new THREE.Vector2(x, -z))), { depth: pw.h, bevelEnabled: false }); const pm = new THREE.Mesh(geo, m); pm.rotation.x = -Math.PI / 2; g.add(pm); }
    g.add(inst);
    const edgeMat = new THREE.MeshBasicMaterial({ color: 0x1E2730, transparent: true }); g.userData.mats.push(edgeMat);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(wM + .02, .04, dM + .02), edgeMat); edge.position.set(board.position.x, -.18, board.position.z); edge.rotation.y = board.rotation.y; g.add(edge);
    g.position.y = L.y; scene.add(g); groups[key] = g;
    centres[key] = new THREE.Vector3(board.position.x, L.y, board.position.z);
  });
  // room fills (one mesh per room; hidden until chosen) + outlines (stop focus) — polygons in plan_px through the level transform
  const roomById = Object.fromEntries(ROOMS.map(r => [r.id, r]));
  const shapeOf = r => new THREE.Shape(r.poly.map(([x, y]) => { const p = toWorld(r.lvl, x, y); return new THREE.Vector2(p.x, -p.z); }));
  await step('rooms', () => { for (const r of ROOMS) {
    const fm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shapeOf(r)), fm); mesh.rotation.x = -Math.PI / 2; mesh.position.y = .012; mesh.visible = false; mesh.renderOrder = 2;
    groups[r.lvl].add(mesh); fills[r.id] = { mesh, cur: 0, goal: 0, color: null };
    const pts = r.poly.map(([x, y]) => { const p = toWorld(r.lvl, x, y); return new THREE.Vector3(p.x, .03, p.z); });
    const ol = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x1E2730, transparent: true, opacity: 0 })); ol.visible = false; ol.renderOrder = 3;
    groups[r.lvl].add(ol); outlines[r.id] = { line: ol, cur: 0, goal: 0 };
  } });
  // "you are here": a warm glow over the room the film is in
  const hereMat = new THREE.MeshBasicMaterial({ color: 0xF2B544, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
  const here = new THREE.Mesh(new THREE.BufferGeometry(), hereMat); here.rotation.x = -Math.PI / 2; here.position.y = .02; here.renderOrder = 4; here.visible = false; if (!new URLSearchParams(location.search).has('plant-noglow')) scene.add(here); // planted-defect hook (tools/glow.mjs negative control)
  let hereRoom = null, hereCur = 0, hereGoal = 0;
  // labels (HTML chips) for filled rooms, shown only when the model is large
  const labels = {};
  for (const r of ROOMS) { const el = document.createElement('span'); el.className = 'mlabel'; el.hidden = true; labelsEl.append(el); own.labels.push(el); labels[r.id] = { el, pos: toWorld(r.lvl, r.pin[0], r.pin[1]), lvl: r.lvl, text: '' }; }

  const layout = Object.fromEntries(ORDER.map(k => [k, { y: LEVELS[k].y, o: 1 }])), cur = JSON.parse(JSON.stringify(layout));
  let focus = 'all';
  function applyLayout() {
    if (focus === 'all') ORDER.forEach(k => { layout[k].y = LEVELS[k].y * 1.45; layout[k].o = 1; });
    else { const li = ORDER.indexOf(focus); ORDER.forEach((k, i) => { layout[k].y = i > li ? LEVELS[focus].y + 2.4 + (i - li) * 1.6 : i < li ? LEVELS[focus].y - 2.2 * (li - i) : LEVELS[focus].y; layout[k].o = i === li ? 1 : i > li ? .1 : .32; }); }
  }
  applyLayout(); Object.assign(cur, JSON.parse(JSON.stringify(layout)));
  // camera rig: spherical around the focused level's centre; radius fitted to the rect
  const rig = { theta: -0.55, phi: 0.98, R: 9, target: new THREE.Vector3(6.75, 3, 6) }, goal = { theta: -0.55, phi: 0.98, R: 9, target: new THREE.Vector3(6.75, 3, 6) };
  let last = performance.now(), rect = { x: 0, y: 0, w: 300, h: 300 }, rectVisible = true, spin = false, userTheta = 0, dirty = true, running = false;
  function poseFor() {
    const all = focus === 'all';
    const tgt = all ? new THREE.Vector3((centres.lower.x + centres.upper.x) / 2, (cur.lower.y + cur.upper.y) / 2 + .4, (centres.lower.z + centres.upper.z) / 2) : centres[focus].clone().setY(LEVELS[focus].y + .3);
    const radiusWorld = all ? 12.4 : 8.2; // bounding radius of the stack / of one level (metres)
    const vf = camera.fov * Math.PI / 180, asp = rect.w / Math.max(1, rect.h), hf = 2 * Math.atan(Math.tan(vf / 2) * asp);
    const R = radiusWorld / Math.sin(Math.min(vf, hf) / 2) * .92;
    return { theta: -0.55 + userTheta, phi: all ? 1.0 : .82, R, target: tgt };
  }
  function retarget() { const p = poseFor(); goal.theta = p.theta; goal.phi = p.phi; goal.R = p.R; goal.target.copy(p.target); kick(); }
  function resize() { renderer.setSize(innerWidth, innerHeight, false); kick(); }
  await step('size', () => { renderer.setSize(innerWidth, innerHeight, false); }); addEventListener('resize', resize); own.resize = resize;
  const v = new THREE.Vector3();
  function frame(dt) {
    window.__lvModelN = (window.__lvModelN || 0) + 1; // W3b diagnostic: model renders (the instrument logs it per animation frame)
    const k = reduced.matches ? 1 : 1 - Math.pow(.004, dt);
    let moving = false;
    const step = (o, key, g) => { const d = g - o[key]; if (Math.abs(d) > 1e-4) { o[key] += d * k; moving = true; } else o[key] = g; };
    if (spin && !reduced.matches) { userTheta += dt * .12; goal.theta = -0.55 + userTheta; moving = true; }
    step(rig, 'theta', goal.theta); step(rig, 'phi', goal.phi); step(rig, 'R', goal.R);
    if (rig.target.distanceTo(goal.target) > 1e-4) { rig.target.lerp(goal.target, k); moving = true; } else rig.target.copy(goal.target);
    ORDER.forEach(key => { step(cur[key], 'y', layout[key].y); step(cur[key], 'o', layout[key].o); const g = groups[key]; g.position.y = cur[key].y; g.visible = cur[key].o > .01; g.userData.mats.forEach(m => { m.opacity = cur[key].o; m.depthWrite = cur[key].o > .9; }); });
    for (const [id, f] of Object.entries(fills)) { if (Math.abs(f.goal - f.cur) > .002) { f.cur += (f.goal - f.cur) * (reduced.matches ? 1 : 1 - Math.pow(.02, dt)); moving = true; } else f.cur = f.goal; f.mesh.material.opacity = f.cur * .93 * cur[roomById[id].lvl].o; f.mesh.visible = f.cur > .005; }
    for (const [id, o] of Object.entries(outlines)) { if (Math.abs(o.goal - o.cur) > .002) { o.cur += (o.goal - o.cur) * k; moving = true; } else o.cur = o.goal; o.line.material.opacity = o.cur * cur[roomById[id].lvl].o; o.line.visible = o.cur > .005; }
    if (Math.abs(hereGoal - hereCur) > .002) { hereCur += (hereGoal - hereCur) * k; moving = true; } else hereCur = hereGoal;
    if (hereRoom) { hereMat.opacity = hereCur * .62 * cur[hereRoom.lvl].o; here.visible = hereCur > .005; here.position.y = cur[hereRoom.lvl].y + .02; } else here.visible = false;
    // camera into the rect
    const W = innerWidth, H = innerHeight;
    camera.aspect = rect.w / Math.max(1, rect.h);
    camera.setViewOffset(rect.w, rect.h, -rect.x, -rect.y, W, H);
    camera.position.set(rig.target.x + rig.R * Math.sin(rig.phi) * Math.sin(rig.theta), rig.target.y + rig.R * Math.cos(rig.phi), rig.target.z + rig.R * Math.sin(rig.phi) * Math.cos(rig.theta));
    camera.lookAt(rig.target); camera.updateProjectionMatrix();
    renderer.setScissorTest(false); renderer.clear(); renderer.setScissorTest(true); renderer.setScissor(rect.x, H - rect.y - rect.h, rect.w, rect.h); renderer.render(scene, camera);
    // labels: project into canvas space; only inside a large rect
    const big = rect.w >= 360 && rectVisible, placed = [];
    const items = Object.entries(labels).map(([id, L]) => { const f = fills[id]; let show = big && L.text && f.cur > .5 && cur[L.lvl].o > .6, x = 0, y = 0;
      if (show) { v.copy(L.pos); v.y = cur[L.lvl].y + .2; v.project(camera); x = (v.x * .5 + .5) * W; y = (-v.y * .5 + .5) * H; show = x > rect.x + 10 && x < rect.x + rect.w - 10 && y > rect.y + 10 && y < rect.y + rect.h - 10 && v.z < 1; }
      return { L, show, x, y }; }).sort((a, b) => a.y - b.y);
    for (const it of items) { // simple collision pass: push a label down until it clears the ones already placed
      if (it.show) { const w = it.L.el.offsetWidth || it.L.text.length * 6.5 + 26, h = 24; let y = it.y;
        for (let k = 0; k < 8; k++) { const hit = placed.find(p => Math.abs(p.x - it.x) < (p.w + w) / 2 + 4 && Math.abs(p.y - y) < h); if (!hit) break; y = hit.y + h; }
        placed.push({ x: it.x, y, w }); it.L.el.style.transform = `translate(${it.x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%)`; }
      if (it.L.el.hidden === it.show) it.L.el.hidden = !it.show; }
    return moving;
  }
  let built = false; // W3b: no render loop until the sliced build is done (an early kick rendered — uploading + compiling — in one ~55 ms frame)
  function kick() { dirty = true; if (running || !built) return; running = true; last = performance.now(); requestAnimationFrame(loop); }
  function loop(now) { const dt = Math.min(.05, (now - last) / 1000); last = now; const moving = frame(dt); if (moving || dirty) { dirty = false; requestAnimationFrame(loop); } else running = false; }
  // drag to turn (only when the caller enables a hit area)
  let drag = null, scrollTheta = 0;
  const api = {
    setRect(r, visible = true) { if (r.x === rect.x && r.y === rect.y && r.w === rect.w && r.h === rect.h && visible === rectVisible) return; const sizeChanged = Math.abs(r.w - rect.w) > .5 || Math.abs(r.h - rect.h) > .5; rect = { ...r }; rectVisible = visible; canvas.style.visibility = visible ? '' : 'hidden'; if (sizeChanged) { const p = poseFor(); goal.R = p.R; rig.R = p.R; } kick(); },
    setFocus(l) { if (l === focus) return; focus = l; applyLayout(); retarget(); },
    setHere(roomId) { const r = roomId && roomById[roomId]; if (!r) { if (hereGoal !== 0) { hereGoal = 0; kick(); } return; } if (hereRoom?.id === r.id && hereGoal === 1) return; if (hereRoom?.id !== r.id) { here.geometry.dispose(); here.geometry = new THREE.ShapeGeometry(shapeOf(r)); hereRoom = r; } hereGoal = 1; kick(); },
    setFill(roomId, hex, label) { const f = fills[roomId]; if (!f) return; if (hex) { f.mesh.material.color.set(hex); f.goal = 1; } else f.goal = 0; labels[roomId].text = label || ''; labels[roomId].el.innerHTML = label ? `<i style="background:${hex}"></i>${label}` : ''; kick(); },
    setOutline(ids) { let ch = false; for (const [id, o] of Object.entries(outlines)) { const g = ids.includes(id) ? 1 : 0; if (o.goal !== g) { o.goal = g; ch = true; } } if (ch) kick(); },
    setSpin(on) { if (spin === on) return; spin = on; kick(); },
    nudge(d) { userTheta += d; goal.theta = -0.55 + userTheta + scrollTheta; kick(); },
    setTurn(d) { if (Math.abs(d - scrollTheta) < 1e-4) return; scrollTheta = d; goal.theta = -0.55 + userTheta + scrollTheta; kick(); }, // W3: scroll-linked turn at the stops
    dragStart(x) { drag = { x, th: userTheta }; },
    dragMove(x) { if (!drag) return; userTheta = drag.th - (x - drag.x) * .006; goal.theta = -0.55 + userTheta + scrollTheta; kick(); },
    dragEnd() { drag = null; },
    kick, renderer, get rect() { return rect; },
  };
  retarget(); Object.assign(rig, { theta: goal.theta, phi: goal.phi, R: goal.R }); rig.target.copy(goal.target);
  for (const key of ORDER) await step('texture ' + key, () => renderer.initTexture(texes[key])); // one upload (+ mipmaps) per task
  // every program the model will ever use (fills, outlines and the glow are hidden until needed: shown for the compile only)
  const hidden = [...Object.values(fills).map(f => f.mesh), ...Object.values(outlines).map(o => o.line), here].filter(o => !o.visible);
  // compile every program now, then poll the links without blocking (three's compileAsync polls forever if the context is
  // lost mid-compile — its isReady() caches the null; Codex review c1 #1); give up waiting after 4 s (the first render links)
  await step('compile', async () => { hidden.forEach(o => { o.visible = true; }); camera.aspect = 1; camera.updateProjectionMatrix();
    let mats; try { mats = [...renderer.compile(scene, camera)]; } finally { hidden.forEach(o => { o.visible = false; }); }
    for (const t0 = performance.now(); performance.now() - t0 < 4000;) {
      live(); if (mats.every(m => renderer.properties.get(m).currentProgram?.isReady() !== false)) break;
      await new Promise(r => setTimeout(r, 16));
    } });
  await step('first frame', () => { dirty = false; frame(0); }); built = true;
  const gle = renderer.getContext(); if (!gle || gle.isContextLost()) throw new Error('WebGL context lost');
  return api;
}

// No-WebGL fallback: the three plan crops, flat, with the same room fills as SVG polygons (same data, same colours).
export function createFlatModel({ host, labelsEl }) {
  const wrap = document.createElement('div'); wrap.className = 'flatmodel'; wrap.setAttribute('aria-hidden', 'true'); host.append(wrap);
  const polys = {};
  for (const key of [...ORDER].reverse()) {
    const L = LEVELS[key]; const fig = document.createElement('figure'); fig.className = 'flat-level'; fig.dataset.level = key;
    fig.innerHTML = `<img src="${L.plate}" alt="" width="${L.w}" height="${L.h}"><svg viewBox="0 0 ${L.w} ${L.h}" aria-hidden="true"></svg><figcaption>${L.name}</figcaption>`;
    const svg = fig.querySelector('svg');
    for (const r of ROOMS.filter(r => r.lvl === key)) { const p = document.createElementNS('http://www.w3.org/2000/svg', 'polygon'); p.setAttribute('points', r.poly.map(q => q.join(',')).join(' ')); svg.append(p); polys[r.id] = p; }
    wrap.append(fig);
  }
  let focus = 'all';
  return {
    setRect(r, visible = true) { Object.assign(wrap.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px', opacity: visible ? '' : '0.002' }); /* W3: kept painted when 'hidden' (its first paint mid-scroll held the phone screen ~100 ms) */ wrap.classList.toggle('is-wide', r.w > r.h * 1.3); wrap.classList.toggle('is-small', r.w < 360); },
    setFocus(l) { focus = l; wrap.dataset.focus = l; },
    setHere(id) { for (const [k, p] of Object.entries(polys)) p.classList.toggle('here', k === id); },
    setFill(id, hex) { const p = polys[id]; if (!p) return; p.style.fill = hex || ''; p.classList.toggle('filled', !!hex); },
    setOutline(ids) { for (const [k, p] of Object.entries(polys)) p.classList.toggle('outlined', ids.includes(k)); },
    setSpin() {}, setTurn() {}, nudge() {}, dragStart() {}, dragMove() {}, dragEnd() {}, kick() {}, flat: true,
    destroy() { wrap.remove(); },
  };
}
