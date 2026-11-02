// W3 — the film, frame by frame, for scrolling. The SAME frames as D7's approved master (tools/scrubframes.py: frame k
// of a pack = frame k of the master, by index, never re-timed), packed in 60-frame chunks and fetched span by span
// ahead of the reader. Every animation frame draws the frame the scroll asks for; between two packed frames it blends
// the neighbours by the fractional position, so ANY scroll movement moves the picture (no seek, no wait, no freeze).
// What is not loaded yet falls back to the nearest frames that are (a 1-second sparse pack loads first), so the film
// is scrubbable from first paint and sharpens in place as chunks arrive.
export function createScrub({ canvas, base, frames, phone, onDraw, onData, hold = false }) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const present = new Uint8Array(frames), blobs = new Map(), bitmaps = new Map(), inflight = new Set();
  let CAP = phone ? 60 : 80; const MAXDEC = 6; // W3b: desktop CAP is re-sized to the pack frame size with a floor of 32 frames, so decoded memory RISES with the sharper set: 768x432x80 = 106 MB -> 1600x900x32 = 184 MB RGBA (deliberate: the floor keeps the decode-ahead window of W3; a smaller cap was not measured; Codex review c1 #3)
  let cf = 0, idx = null, target = 0, dir = 1, drawnA = -1, drawnB = -1, drawnF = -1, drawnZ = 1, drawnT = 0, dirty = true, started = false, stopped = false;
  const loaded = new Set(), loading = new Set();
  let netBusy = 0, held = hold; const NET = phone ? 2 : 4; // held: before the first input only the first sparse pack loads (phone byte budget)

  function addPack(meta, buf) {
    for (let i = 0; i < meta.frames.length; i++) {
      const k = meta.frames[i]; if (present[k]) continue;
      blobs.set(k, new Blob([buf.slice(meta.offsets[i], meta.offsets[i + 1])], { type: 'image/webp' })); present[k] = 1;
    }
    dirty = true; onData?.();
  }
  async function fetchPack(meta, key) {
    if (loaded.has(key) || loading.has(key)) return; loading.add(key); netBusy++;
    try { const r = await fetch(base + meta.file); if (!r.ok) throw Error(r.status); addPack(meta, await r.arrayBuffer()); loaded.add(key); }
    catch { /* retried by the pump */ } finally { loading.delete(key); netBusy--; pump(); }
  }
  // fetch order: the sparse pack nearest the reader, then dense chunks outward from the reader, ahead first
  function pump() {
    if (!idx || stopped) return;
    if (held) { if (!loaded.has('s0') && !loading.has('s0')) fetchPack(idx.sparse[0], 's0'); return; }
    while (netBusy < NET) {
      const c0 = Math.floor(target / idx.chunkFrames);
      let pick = null;
      const free = k => !loaded.has(k) && !loading.has(k);
      const sp = Math.min(idx.sparse.length - 1, Math.floor(target / frames * idx.sparse.length));
      const order = [['s', sp], ['c', c0], ['c', c0 + dir], ['c', c0 - dir], ['s', sp + dir], ...[...idx.sparse.keys()].map(i => ['s', i])];
      for (let n = 2; n < idx.chunks.length; n++) order.push(['c', c0 + dir * n], ['c', c0 - dir * n]); // (Codex c2 advisory: both neighbours, once each)
      for (const [t, i] of order) { const arr = t === 's' ? idx.sparse : idx.chunks; if (i >= 0 && i < arr.length && free(t + i)) { pick = [t + i, arr[i]]; break; } }
      if (!pick) return;
      fetchPack(pick[1], pick[0]);
    }
  }
  function decode(k) {
    if (k < 0 || !present[k] || bitmaps.has(k) || inflight.has(k) || inflight.size >= MAXDEC) return;
    inflight.add(k);
    createImageBitmap(blobs.get(k)).then(bm => {
      bitmaps.set(k, bm);
      if (bitmaps.size > CAP) { // evict the decoded frames farthest from the reader
        const far = [...bitmaps.keys()].sort((a, b) => Math.abs(b - target) - Math.abs(a - target));
        for (const f of far.slice(0, bitmaps.size - CAP)) { bitmaps.get(f).close?.(); bitmaps.delete(f); }
      }
      dirty = true; onData?.();
    }).catch(() => {}).finally(() => inflight.delete(k));
  }
  const below = (f, set) => { for (let k = Math.min(frames - 1, Math.floor(f)); k >= 0; k--) if (set(k)) return k; return -1; };
  const above = (f, set) => { for (let k = Math.max(0, Math.ceil(f)); k < frames; k++) if (set(k)) return k; return -1; };
  const isP = k => present[k] === 1, isB = k => bitmaps.has(k);
  function draw() {
    if (!idx) return false;
    // the frames the scroll asks for, among those loaded; ask for their decode, and decode ahead in the direction of travel
    const a = below(target, isP), b = above(target, isP);
    decode(a); decode(b);
    for (let k = b + 1, n = 0; k > 0 && k < frames && n < 8; k++) if (present[k]) { decode(dir > 0 ? k : -1); n++; }
    for (let k = a - 1, n = 0; k >= 0 && n < 8; k--) if (present[k]) { decode(dir < 0 ? k : -1); n++; }
    // draw the nearest DECODED neighbours (falls back outward; never blank once anything is decoded)
    let A = below(target, isB), B = above(target, isB);
    if (A < 0 && B < 0) return false;
    if (A < 0) A = B; if (B < 0) B = A;
    const f = B > A ? (target - A) / (B - A) : 0;
    // review fix (Codex c0 #1, c2 #1; audit c1 first-paint run): while only sparse frames (or one frame) are decoded around
    // the reader, a dissolve between frames a second apart is too gradual to read as motion, so the picture also drifts
    // with the scroll (a 4 % push-in and a slow sideways drift, eased in and out); it settles back as the dense frames arrive
    const coarse = A === B || B - A > 3 * (idx.step || 2);
    cf += ((coarse ? 1 : 0) - cf) * .08; if (cf < .002) cf = 0;
    const z = 1 + .04 * cf, tri = cf ? Math.asin(Math.sin(target / 45 * Math.PI / 2)) * 2 / Math.PI * cf : 0;
    if (A === drawnA && B === drawnB && Math.abs(f - drawnF) < .004 && Math.abs(z - drawnZ) < .0005 && Math.abs(tri - drawnT) < .002 && !dirty && cf === 0) return true;
    const W = canvas.width, H = canvas.height, ox = (W * z - W) / 2;
    ctx.globalAlpha = 1; ctx.drawImage(bitmaps.get(A), -ox + tri * ox, (H - H * z) / 2, W * z, H * z);
    if (B !== A && f > .004) { ctx.globalAlpha = f; ctx.drawImage(bitmaps.get(B), -ox + tri * ox, (H - H * z) / 2, W * z, H * z); ctx.globalAlpha = 1; } // same transform as A (audit c2 advisory)
    drawnA = A; drawnB = B; drawnF = f; drawnZ = z; drawnT = tri; dirty = false; started = true; window.__lvDrawn = A + (B - A) * f; window.__lvBracket = [A, B, +cf.toFixed(3)]; onDraw?.(A, B, f);
    return true;
  }
  fetch(base + 'index.json').then(r => r.json()).then(j => { idx = j; canvas.width = j.w; canvas.height = j.h; if (!phone) CAP = Math.max(32, Math.round(80 * 768 * 432 / (j.w * j.h))); pump(); }).catch(() => {});
  return {
    setTarget(f, d) { if (d) dir = d > 0 ? 1 : -1; if (f !== target) { target = Math.max(0, Math.min(frames - 1, f)); } pump(); return draw(); },
    get started() { return started; },
    get coverage() { return idx ? { dense: [...loaded].filter(k => k[0] === 'c').length, of: idx.chunks.length, sparse: [...loaded].filter(k => k[0] === 's').length, decoded: bitmaps.size } : null; },
    exact(k) { return drawnA === k && drawnB === k; },
    stop() { stopped = true; },
    release() { if (held) { held = false; pump(); } },
  };
}
