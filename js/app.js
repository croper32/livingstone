// 1237 Livingstone — Make it yours. One scroll map drives three things: the walk-through film (M1 scrub, page-level world
// layer), the seven stops (stations: approach · dock · recede) and the model in your hand (one canvas, drawn into a moving rect).
import D from './data.js';
import { STOPS, ROOM_NAMES, GROUP_SHORT } from './copy.js';
import { createModel, createFlatModel, glAvailable } from './model.js';
import { createScrub } from './scrub.js';

const $ = id => document.getElementById(id);
const root = document.documentElement;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const wide = matchMedia('(min-width: 768px)');
const isPhone = () => !wide.matches;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const FPS = D.film.fps, LAST = (D.film.frames - 1) / FPS;
const E = .5, W = .6, X = .5, /* W3: dock 1.0 → 0.6 vh (a stop held ~6 s of slow scrolling with only subtle motion) */ RATE = .075, END_AT = .5; // in viewport heights; RATE = vh of scroll per film second
// cubic-bezier(0.16,1,0.3,1) — the corpus's entrance settle (SIGNATURE-PATTERNS §4), applied to scroll progress
const ease = (() => { const cx = 3 * .16, bx = 3 * (.3 - .16) - cx, ax = 1 - cx - bx, cy = 3 * 1, by = 3 * (1 - 1) - cy, ay = 1 - cy - by;
  const sx = t => ((ax * t + bx) * t + cx) * t, sy = t => ((ay * t + by) * t + cy) * t, dx = t => (3 * ax * t + 2 * bx) * t + cx;
  return x => { if (x <= 0) return 0; if (x >= 1) return 1; let t = x; for (let i = 0; i < 6; i++) { const d = dx(t); if (Math.abs(d) < 1e-6) break; t -= (sx(t) - x) / d; } return sy(clamp(t)); }; })();
const STILLS = [0, 435, 1663, 2212, 4292, 4597, 5359, 5619, 6123];
const GROUPS = D.groups, COLOURS = D.wallColours;
const LEVEL_NAME = { main: 'Main floor', lower: 'Lower level', upper: 'Upper floor' };

// W3: phones start fetching + parsing three.js now (0.69 MB, inside the pre-input budget), so its one-time ~130 ms
// evaluation (4x-throttled CPU) lands during the first seconds after load rather than in the middle of a scroll later
// (no early three.js on phones: the model build already waits for a pause in scrolling, and the pre-input byte budget is 2.48 MB)
// ---------------- state (choices persist per viewer; storage may be unavailable) ----------------
const store = { get() { try { return JSON.parse(localStorage.getItem('lv-choices') || '{}'); } catch { return {}; } }, set(v) { try { localStorage.setItem('lv-choices', JSON.stringify(v)); } catch {} } };
const chosen = new URLSearchParams(location.search).has('fresh') ? {} : store.get();
for (const k of Object.keys(chosen)) if (!GROUPS[k] || !GROUPS[k].arr.some(a => a.id === chosen[k])) delete chosen[k];
const viewIdx = {};

// ---------------- build the stops ----------------
const stopsEl = $('stops'), tpl = $('stopTpl');
const walks = [], secs = [];
const announce = t => { $('announce').textContent = ''; requestAnimationFrame(() => { $('announce').textContent = t; }); };
STOPS.forEach((s, i) => {
  const g = GROUPS[s.group];
  const w = document.createElement('div'); w.className = 'walk'; w.setAttribute('aria-hidden', 'true'); stopsEl.append(w); walks.push(w);
  const sec = tpl.content.firstElementChild.cloneNode(true); sec.id = `stop-${i + 1}`; sec.dataset.i = i;
  const hid = `stop-${i + 1}-t`; sec.setAttribute('aria-labelledby', hid);
  const h2 = sec.querySelector('h2'); h2.id = hid; h2.querySelector('.t').textContent = s.title; h2.querySelector('em').textContent = s.ask;
  sec.querySelector('.kicker').textContent = `${LEVEL_NAME[s.level]} · Stop ${i + 1} of ${STOPS.length}`;
  sec.querySelector('.body').textContent = s.body;
  viewIdx[s.group] = Math.max(0, g.views.findIndex(v => v.id === s.view));
  const ch = sec.querySelector('.choices'); ch.setAttribute('aria-label', `Choose what the ${GROUP_SHORT[s.group].toLowerCase()} becomes`);
  for (const a of g.arr) {
    const [title, sub] = s.arr[a.id];
    const b = document.createElement('button'); b.type = 'button'; b.className = 'choice'; b.dataset.arr = a.id; b.setAttribute('aria-pressed', 'false');
    b.innerHTML = `<img alt="" loading="lazy" decoding="async" width="480" height="360"><b></b><span></span>`;
    b.querySelector('b').textContent = title; b.querySelector('span').textContent = sub;
    b.addEventListener('click', () => choose(i, a.id));
    ch.append(b);
  }
  const vs = sec.querySelector('.views');
  if (g.views.length > 1) g.views.forEach((v, k) => { const b = document.createElement('button'); b.type = 'button'; const same = g.views.filter(x => x.room === v.room); b.textContent = (ROOM_NAMES[v.room] || v.room).replace(' room', '') + (same.length > 1 ? ' ' + (same.indexOf(v) + 1) : ''); b.dataset.k = k; b.setAttribute('aria-pressed', 'false'); b.addEventListener('click', () => { viewIdx[s.group] = k; paintStop(i); }); vs.append(b); });
  if (g.views.length > 1) { const nx = document.createElement('button'); nx.type = 'button'; nx.className = 'view-next'; nx.addEventListener('click', () => { viewIdx[s.group] = (viewIdx[s.group] + 1) % g.views.length; paintStop(i); }); vs.append(nx); }
  const range = sec.querySelector('.cmp-range'), cmp = sec.querySelector('.cmp');
  range.addEventListener('input', () => cmp.style.setProperty('--pos', range.value + '%'));
  sec.querySelector('.walk-on').addEventListener('click', () => reduced.matches ? jumpToStop(i + 1) : play());
  stopsEl.append(sec); secs.push(sec);
  paintStop(i);
});
const endWalk = document.createElement('div'); endWalk.className = 'walk'; endWalk.setAttribute('aria-hidden', 'true'); stopsEl.append(endWalk);

function paintStop(i) {
  const s = STOPS[i], g = GROUPS[s.group], sec = secs[i], v = g.views[viewIdx[s.group]], arr = chosen[s.group];
  const cmp = sec.querySelector('.cmp'), asis = sec.querySelector('.cmp-asis'), st = sec.querySelector('.cmp-staged');
  const name = GROUP_SHORT[s.group];
  if (asis.getAttribute('src') !== v.asis) { asis.src = v.asis; asis.alt = `${name}: the listing photo, as it is today`; }
  cmp.dataset.state = arr ? 'staged' : 'asis';
  if (arr) { const src = v.staged[arr]; if (st.getAttribute('src') !== src) st.src = src; st.alt = `${name}, virtually staged: ${s.arr[arr][0].toLowerCase()}, ${s.arr[arr][1]}`; }
  const note = sec.querySelector('.cmp-note');
  const long = arr ? 'Drag across the photo to compare it with today. Dragging does not change your choice.' : 'The walk-through stops here. This is the listing’s photo of the same room, taken in autumn. Choose a furnishing to see it here.';
  const short = arr ? 'Drag to compare with today. Your choice stays.' : 'Listing photo (autumn). Choose below to stage it.';
  if (note.dataset.k !== long) { note.dataset.k = long; note.innerHTML = '<span class="n-long"></span><span class="n-short"></span>'; note.firstChild.textContent = long; note.lastChild.textContent = short; }
  for (const b of sec.querySelectorAll('.choice')) { b.setAttribute('aria-pressed', String(b.dataset.arr === arr)); const img = b.querySelector('img'); const tv = g.views.find(x => x.id === (s.thumbView || s.view)) || v; const src = tv.thumb[b.dataset.arr]; if (img.getAttribute('src') !== src) img.src = src; }
  for (const b of sec.querySelectorAll('.views button[data-k]')) b.setAttribute('aria-pressed', String(+b.dataset.k === viewIdx[s.group]));
  const nx = sec.querySelector('.view-next'); if (nx) { const k = viewIdx[s.group]; nx.textContent = `Photo ${k + 1} of ${g.views.length} · ${(ROOM_NAMES[v.room] || v.room).replace(' room', '')} →`; nx.setAttribute('aria-label', `Show the next photo of this room (now photo ${k + 1} of ${g.views.length})`); }
}
function choose(i, arr) {
  const s = STOPS[i], first = !chosen[s.group]; chosen[s.group] = arr; store.set(chosen);
  paintStop(i);
  const sec = secs[i], cmp = sec.querySelector('.cmp'), range = sec.querySelector('.cmp-range');
  if (first && !reduced.matches) { const t0 = performance.now(); const go = now => { const p = clamp((now - t0) / 800), v = lerp(100, s.pos || 50, ease(p)); cmp.style.setProperty('--pos', v + '%'); range.value = v; if (p < 1) requestAnimationFrame(go); }; requestAnimationFrame(go); }
  else { if (first) range.value = s.pos || 50; cmp.style.setProperty('--pos', range.value + '%'); }
  applyChoices(); tally(); tiles();
  const n = Object.keys(chosen).length;
  announce(`${GROUP_SHORT[s.group]}: ${s.arr[arr][0]}. ${n} of ${STOPS.length} rooms made yours.`);
}

// ---------------- tally (header) + dots ----------------
const dotsEl = $('dots');
const dots = STOPS.map((s, i) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'dot'; b.addEventListener('click', () => jumpToStop(i)); dotsEl.append(b); return b; });
$('tallyCount').addEventListener('click', () => { const i = STOPS.findIndex(s => !chosen[s.group]); jumpToStop(i < 0 ? STOPS.length : i); });
function tally() {
  const n = Object.keys(chosen).length;
  $('tallyCount').textContent = n ? `${n} of ${STOPS.length}` : 'None yet'; $('tallyCount').setAttribute('aria-label', `${n ? n + ' of ' + STOPS.length : 'No'} rooms made yours. Go to the next room to choose.`);
  dots.forEach((b, i) => { const s = STOPS[i], on = !!chosen[s.group]; b.classList.toggle('is-on', on); b.style.setProperty('--c', COLOURS[GROUPS[s.group].modelRoom]); b.tabIndex = isPhone() ? -1 : 0; if (isPhone()) b.setAttribute('aria-hidden', 'true'); else b.removeAttribute('aria-hidden'); b.setAttribute('aria-label', `Stop ${i + 1}, ${GROUP_SHORT[s.group]}: ${on ? 'made yours as ' + s.arr[chosen[s.group]][0].toLowerCase() : 'not chosen yet'}. Go there.`); });
}
// ---------------- ending tiles ----------------
function tiles() {
  const ul = $('tiles'); ul.replaceChildren();
  STOPS.forEach((s, i) => {
    const g = GROUPS[s.group], v = g.views[Math.max(0, g.views.findIndex(x => x.id === s.view))], arr = chosen[s.group];
    const li = document.createElement('li'); li.className = 'tile' + (arr ? '' : ' is-empty');
    li.innerHTML = arr ? `<img src="${v.thumb[arr]}" alt="" loading="lazy" width="480" height="360"><span class="sw" style="--c:${COLOURS[g.modelRoom]}"></span><b></b><span class="what"></span>`
      : `<img src="${v.thumb.asis}" alt="" loading="lazy" width="480" height="360"><b></b><span class="empty"><span>Not chosen yet</span><button type="button">Choose</button></span>`;
    li.querySelector('b').textContent = GROUP_SHORT[s.group];
    if (arr) li.querySelector('.what').textContent = s.arr[arr][0]; else { const b = li.querySelector('button'); b.setAttribute('aria-label', `Choose a furnishing for the ${GROUP_SHORT[s.group].toLowerCase()}`); b.addEventListener('click', () => jumpToStop(i)); }
    ul.append(li);
  });
  const n = Object.keys(chosen).length;
  $('endLede').textContent = n === STOPS.length ? 'The house you just walked through, every room set up the way you would live in it.'
    : n ? `${n} of ${STOPS.length} rooms set up your way. The others wait as they are today; choose any of them below.`
    : 'Nothing chosen yet, so every room waits as it is today. Choose any of them below and it fills in on the house.';
}

// ---------------- the scroll map ----------------
let VH = innerHeight, lastW = innerWidth, anchors = [], stopY = [], endTop = 0;
function layout() {
  root.style.setProperty('--vh', VH / 100 + 'px');
  frameGeo();
  if (reduced.matches) { walks.forEach(w => w.style.removeProperty('--h')); secs.forEach(s => s.style.removeProperty('--h')); endWalk.style.removeProperty('--h'); }
  else {
    let prevT = 0;
    STOPS.forEach((s, i) => {
      const fixed = i === 0 ? (1 + E) * VH : (X + 1 + E) * VH;
      walks[i].style.setProperty('--h', Math.max(0, RATE * VH * (s.t - prevT) - fixed) + 'px');
      secs[i].style.setProperty('--h', (E + W + X + 1) * VH + 'px');
      prevT = s.t;
    });
    endWalk.style.setProperty('--h', Math.max(0, RATE * VH * (LAST - prevT) - (X + 1 - END_AT) * VH) + 'px');
  }
  const docTop = el => el.getBoundingClientRect().top + scrollY;
  stopY = secs.map(docTop); endTop = docTop($('ending'));
  anchors = [[0, 0]];
  STOPS.forEach((s, i) => {
    // W3b: between two stops that are close in the film (4→5, 6→7: the walk spacer collapses to 0) the film used to crawl
    // across the whole recede + tail + approach at a third of the normal rate (0.15 film frames per display frame on a slow
    // read). Now the film moves mostly in the stretch where nothing else moves (the recede tail and walk, e = 0), up to the
    // normal rate, and slower in the recede/approach, where the frame, photo and panel are already moving with the scroll.
    // Same frames, same order, same stop times: only how many scroll pixels each film second takes.
    if (i > 0 && !reduced.matches) {
      const p = STOPS[i - 1], ya = stopY[i - 1] + (E + W) * VH, yr = ya + X * VH, y1 = stopY[i], yb = y1 + E * VH, d = s.t - p.t;
      const rho = 1 / (RATE * VH), Lt = (yr - ya) + (yb - y1), L0 = y1 - yr;
      if (L0 > 0 && d / (Lt + L0) < rho * .98) {
        const r0 = Math.min(rho, d / (L0 + .25 * Lt)), rt = (d - r0 * L0) / Lt; // recede/approach keep >= a quarter of the tail's pace
        anchors.push([yr, p.t + rt * (yr - ya)], [y1, p.t + rt * (yr - ya) + r0 * L0]);
      }
    }
    anchors.push([stopY[i] + E * VH, s.t], [stopY[i] + (E + W) * VH, s.t]);
  });
  anchors.push([endTop - END_AT * VH, LAST]);
}
// the walk is framed: after the hero the full-bleed film settles into a 16:9 frame on paper, the house beside it (Open Hale's
// framed film; the model "beside" the walk, CONCEPT §5). One transform on the page-level #frame; caption + rail + hand placed beside.
let G = null;
function frameGeo() {
  const vw = innerWidth, vh = VH, head = isPhone() ? 56 : 64;
  const coverW = Math.max(vw, vh * 16 / 9), cover = { x: (vw - coverW) / 2, y: (vh - coverW * 9 / 16) / 2, w: coverW, h: coverW * 9 / 16 };
  let inset, rail, hand;
  if (isPhone()) {
    inset = { x: 0, y: head, w: vw, h: vw * 9 / 16 };
    rail = { x: 16, y: inset.y + inset.h + 12, w: vw - 32 };
    const hy = rail.y + 118; hand = { x: 12, y: hy, w: vw - 24, h: Math.max(160, vh - hy - 12) };
  } else {
    const gut = vw >= 1100 ? 40 : 24, col = Math.min(400, Math.max(280, vw * .25)), gap = 32, top = head + 16;
    let w = vw - 2 * gut - col - gap, h = w * 9 / 16; const hMax = vh - top - 150; if (h > hMax) { h = hMax; w = h * 16 / 9; }
    inset = { x: gut, y: top, w, h };
    rail = { x: gut, y: top + h + 16, w };
    hand = { x: gut + w + gap, y: top, w: Math.min(col, vw - gut - (gut + w + gap)), h: h + 112 };
  }
  G = { cover, inset, rail, hand };
}
function tAt(y) {
  if (y <= anchors[0][0]) return 0;
  for (let k = 1; k < anchors.length; k++) { const [y0, t0] = anchors[k - 1], [y1, t1] = anchors[k]; if (y <= y1) return y1 > y0 ? t0 + (t1 - t0) * (y - y0) / (y1 - y0) : t1; }
  return LAST;
}
function yAt(t) { let y = 0; for (let k = 1; k < anchors.length; k++) { const [y0, t0] = anchors[k - 1], [y1, t1] = anchors[k]; if (t1 > t0 && t >= t0 && t <= t1) y = y0 + (y1 - y0) * (t - t0) / (t1 - t0); else if (t1 === t0 && t === t0) y = y1; } return y; }
const dockY = i => stopY[i] + (E + .15) * VH;
function jumpToStop(i) { stopPlay(); if (i >= STOPS.length) { scrollTo({ top: endTop, behavior: 'instant' }); return; } if (reduced.matches) { secs[i].scrollIntoView({ block: 'start' }); return; } const y = dockY(i), far = Math.abs(scrollY - y) > 3 * VH; scrollTo({ top: y, behavior: far ? 'instant' : 'smooth' }); }
function spanAt(t) { const S = D.film.spans; let lo = 0, hi = S.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (S[m].t0 <= t) lo = m; else hi = m - 1; } return S[lo]; }
// the span's own disclosure, in the engine's words (only the internal route-history note is dropped: it says nothing about what is on screen)
function spanText(span) { const parts = span.label.split(' · ').filter(p => p !== 'carried from a superseded route');
  const head = parts.shift(); return [head === 'Original source view' ? 'Real walk-through footage' : head === 'Generated camera connection' ? 'Generated camera move' : head, ...parts].join(', '); }
function roomOf(span, t) { const r = span.kind === 'original' || (t - span.t0) < (span.t1 - span.t0) / 2 ? span.from : span.to; return r.startsWith('stair') ? null : r; }

// ---------------- the film (M1) ----------------
const film = $('film'), still = $('still');
const DESK_SRC = 'films/livingstone-d7-cand1-web.mp4', PHONE_SRC = 'films/livingstone-d7-cand1-web-720p.mp4'; // D7's shipped web encodes (packets/D7-NOTES.md §0)
let ready = false, target = 0, playing = false, playTo = LAST, blobUrl = null, buffering = false, phoneMode = isPhone();
// W3: no seek chain in the scroll path. Scrolling draws the scrub frames (js/scrub.js); the D7 encode is seeked only when
// the scroll has come to rest, and shown (crisp) once it holds exactly that frame.
let restFrame = -1, crisp = false;
const seek = () => {};
const frameOf = sec => Math.floor(sec * FPS + 1e-3);
function restSeek(k) { if (!ready || playing) return; const q = Math.min(LAST, k / FPS); if (frameOf(film.currentTime) === k && !film.seeking) { markCrisp(k); return; } film.currentTime = q + 1e-4; }
function markCrisp(k) { if (k === restFrame && !playing) { crisp = true; root.classList.add('film-crisp'); } }
// review fix (Codex c0 #5): certify 'crisp' on the frame actually presented after the seek, not on a rounded time
film.addEventListener('seeked', () => { const want = restFrame; if (want < 0) return; if (frameOf(film.currentTime) !== want) { restSeek(want); return; }
  if (film.requestVideoFrameCallback) film.requestVideoFrameCallback((now, m) => { if (restFrame === want && frameOf(m.mediaTime) === want) markCrisp(want); }); else markCrisp(want); });
film.addEventListener('loadeddata', () => { ready = true; root.classList.add('film-on'); if (pendingResume !== null) { film.currentTime = pendingResume; pendingResume = null; } if (restFrame >= 0) restSeek(restFrame); });
let pendingResume = null;
function attach(src) { ready = false; film.preload = phoneMode ? 'metadata' : 'auto'; film.src = src; film.load(); }
function loadFilm() {
  if (reduced.matches) return;
  if (!phoneMode) { attach(DESK_SRC); return; }
  // W3: phones no longer wait for the whole 35.6 MB file before scrolling moves the film: the scrub frames carry the
  // scroll (sparse 1-second pack first, then 2-second chunks around the reader); the 720p encode streams for rest + Play
  if (!film.src) attach(PHONE_SRC); return;
  // phones: the 540p encode downloads in full before scroll-scrubbing (the engine's phone strategy); Play works meanwhile
  if (buffering || blobUrl) return; buffering = true; const box = $('phoneLoad'); box.hidden = false;
  (async () => { try {
    const r = await fetch(PHONE_SRC); if (!r.ok) throw Error('film unavailable'); const total = +r.headers.get('Content-Length') || 0; const rd = r.body.getReader(), parts = []; let got = 0, last = 0;
    for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; const now = performance.now(); if (now - last > 200) { last = now; $('phoneLoadBar').style.transform = `scaleX(${total ? got / total : 0})`; $('phoneLoadText').textContent = `Loading the walk-through · ${total ? Math.round(100 * got / total) : 0} %. Press Play to watch now.`; } }
    blobUrl = URL.createObjectURL(new Blob(parts, { type: 'video/mp4' })); box.hidden = true;
    if (!playing) { pendingResume = ready ? film.currentTime : null; attach(blobUrl); }
  } catch { $('phoneLoadText').textContent = 'The walk-through could not load for scrolling here. Press Play to watch it.'; } })();
}
function nearestStill(t) { const f = Math.round(t * FPS); let best = 0; for (const s of STILLS) if (s <= f + 3) best = s; return best; }
let stillFrame = 0;
function paintStill(t) { if (ready || scrub?.started) return; const f = nearestStill(t); if (f === stillFrame) return; stillFrame = f; still.srcset = `media/film/f${f}-800.webp 800w, media/film/f${f}.webp 1600w`; still.src = `media/film/f${f}.webp`; }

// ---------------- play: an autopilot walk to the next room; scroll follows the film ----------------
const playBtn = $('playBtn');
let playGen = 0; // review fix (Codex c0 #2): a Play still waiting for the film is cancelled by any scroll input or another click
async function play() {
  if (reduced.matches) { openFilmDialog(); return; }
  if (playing) { stopPlay(); return; }
  const gen = ++playGen;
  let t = tAt(scrollY); if (t >= LAST - .05) { scrollTo({ top: 0, behavior: 'instant' }); t = 0; }
  const next = STOPS.find(s => s.t > t + .05); playTo = next ? next.t : LAST;
  if (!ready || film.readyState < 2) { if (!film.src) attach(phoneMode ? (blobUrl || PHONE_SRC) : DESK_SRC); await new Promise(res => { const ok = () => { film.removeEventListener('loadeddata', ok); res(); }; if (film.readyState >= 2) res(); else film.addEventListener('loadeddata', ok); }); if (gen !== playGen) return; t = tAt(scrollY); const nx = STOPS.find(s => s.t > t + .05); playTo = nx ? nx.t : LAST; }
  if (gen !== playGen) return;
  film.currentTime = t; playing = true; root.classList.add('film-playing'); playBtn.innerHTML = '<span aria-hidden="true">Ⅱ</span>'; playBtn.classList.add('is-playing'); playBtn.setAttribute('aria-label', 'Pause the walk-through');
  try { await film.play(); } catch { stopPlay(); return; }
  requestAnimationFrame(follow);
}
function follow() {
  if (!playing) return;
  const t = film.currentTime;
  if (t >= playTo - .02) { stopPlay(); target = playTo; const i = STOPS.findIndex(s => s.t === playTo); scrollTo({ top: i >= 0 ? dockY(i) : yAt(LAST), behavior: 'instant' }); seek(); return; }
  scrollTo({ top: yAt(t), behavior: 'instant' }); requestAnimationFrame(follow);
}
function stopPlay() { playGen++; /* Codex c2 #2: every stop path also cancels a Play still loading */ if (!playing) return; playing = false; film.pause(); target = film.currentTime; sm = target * FPS; restFrame = frameOf(film.currentTime); crisp = true; root.classList.add('film-crisp'); root.classList.remove('film-playing'); lastTick = 0; scrub?.setTarget(sm, 0); /* review fix (Codex c0 #3): the paused video stays on screen; the canvas is redrawn at the same frame underneath */ playBtn.innerHTML = '<span aria-hidden="true">▶</span>'; playBtn.classList.remove('is-playing'); playBtn.setAttribute('aria-label', 'Play the walk-through to the next room'); }
for (const ev of ['wheel', 'touchstart']) addEventListener(ev, () => { playGen++; if (playing) stopPlay(); }, { passive: true });
// Codex c3 #2: scrolling keys cancel Play (or a Play still loading) from anywhere, except controls that use those keys
addEventListener('keydown', e => { const k = e.key, t = e.target; if (!['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(k)) return;
  if (t.matches?.('input, textarea, select, [contenteditable]') || (k === ' ' && t.matches?.('button, a, [role=button]')) || t === hit) return; stopPlay(); });
playBtn.addEventListener('click', play); $('heroPlay').addEventListener('click', play);
function openFilmDialog() { // reduced motion: the film is offered, never moved by scroll
  let d = $('filmDialog'); if (!d) { d = document.createElement('dialog'); d.id = 'filmDialog'; d.className = 'film-dialog'; d.innerHTML = `<form method="dialog"><button class="btn btn-light btn-sm">Close</button></form><video controls playsinline preload="metadata" src="${isPhone() ? PHONE_SRC : DESK_SRC}" aria-label="The walk-through film of 1237 Livingstone"></video><p class="dlg-cap" aria-live="polite"></p><p class="dlg-note"></p>`;
    d.querySelector('.dlg-note').textContent = D.disclosures.generated_motion + ' ' + D.disclosures.unphotographed_transit;
    const v = d.querySelector('video'), cap = d.querySelector('.dlg-cap'); const say = () => { const sp = spanAt(v.currentTime), r = roomOf(sp, v.currentTime); const txt = `${r ? ROOM_NAMES[r] || r : 'Stairs'} · ${LEVEL_NAME[sp.floor]} · ${spanText(sp)}`; if (cap.textContent !== txt) cap.textContent = txt; };
    v.addEventListener('timeupdate', say); v.addEventListener('seeked', say); say();
    document.body.append(d); d.addEventListener('close', () => v.pause()); }
  d.showModal();
}

// ---------------- rail ----------------
const floorsEl = $('floors');
const chapters = D.film.chapters.map((c, i, a) => ({ ...c, end: i < a.length - 1 ? a[i + 1].t : LAST }));
const floorEls = chapters.map(c => { const li = document.createElement('li'); li.style.setProperty('--w', (c.end - c.t).toFixed(2)); li.innerHTML = `<button type="button"></button><span class="track"><i></i></span>`; li.querySelector('button').textContent = c.label; li.querySelector('button').setAttribute('aria-label', `Go to the ${c.label.toLowerCase()} in the walk-through`); li.querySelector('button').addEventListener('click', () => { stopPlay(); scrollTo({ top: yAt(c.t + .6), behavior: 'instant' }); }); floorsEl.append(li); return li; });

// ---------------- the model in your hand ----------------
let model = null;
const handEl = $('hand'), hit = $('modelHit');
const rectOf = el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
const _sc = new WeakMap(); const css = (el, obj) => { let c = _sc.get(el); if (!c) _sc.set(el, c = {}); for (const k in obj) { const v = obj[k]; if (c[k] !== v) { c[k] = v; if (k.startsWith('--')) el.style.setProperty(k, v); else el.style[k] = v; } } };
// W3: set a class only when it changes (classList.toggle rewrites the attribute every call: a whole-document style
// invalidation on every scroll frame — measured as a mutation per frame on <html>)
const tog = (el, c, on) => { if (el.classList.contains(c) !== !!on) el.classList.toggle(c, !!on); };
const mix = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t) });
function applyChoices() {
  if (!model) return;
  for (const [gid, g] of Object.entries(GROUPS)) { const arr = chosen[gid]; const s = STOPS.find(x => x.group === gid);
    for (const r of g.rooms) model.setFill(r, arr ? COLOURS[r] : null, arr && r === g.modelRoom ? `${GROUP_SHORT[gid]} · ${s.arr[arr][0]}` : ''); }
}
let interim = null;
function makeInterim() { if (interim || reduced.matches) return; interim = model = createFlatModel({ host: document.body, labelsEl: $('modelLabels') }); applyChoices(); update(); }
// W3b: the 3D build runs as short steps; before each one, yield to input, and on phones wait while the page is scrolling.
// A scroll that resumes inside a step still waits for that step (each ≤ ~25 ms at 4x CPU as measured, not guaranteed; Codex review c2 #2)
const modelSlice = () => new Promise(res => { const go = () => (!phoneMode || performance.now() - lastScrollAt >= 300) ? (window.scheduler?.yield ? scheduler.yield().then(res) : setTimeout(res, 0)) : setTimeout(go, 100); setTimeout(go, 0); });
async function initModel() { window.__w3ModelAt = performance.now();
  if (phoneMode && glAvailable() && !interim) makeInterim(); // W3: the flat plans stand in on phones until the 3D build (which waits for a scroll pause) is ready
  let m3 = null;
  try { if (!glAvailable()) throw Error('no webgl'); m3 = await createModel({ canvas: $('modelCanvas'), labelsEl: $('modelLabels'), reduced, slice: modelSlice }); }
  catch (e) { console.warn('model fallback:', e?.message || e); interim?.destroy(); interim = null; $('modelCanvas').hidden = true; model = createFlatModel({ host: document.body, labelsEl: $('modelLabels') }); root.classList.add('no-gl'); applyChoices(); update(); return; }
  // W3: compile the outline shaders at a stop-sized rect, hidden, BEFORE the 3D model takes over (the first outline draw
  // otherwise compiled mid-scroll at stop 1); on phones the flat stand-in stays visible until this is done (audit c1 #2)
  { const r = rectOf(secs[0].querySelector('.slot')); m3.setRect({ x: Math.round(r.x), y: 0, w: Math.round(r.w), h: Math.round(r.h) }, false); }
  m3.setFocus('all'); m3.setOutline(Object.values(GROUPS).flatMap(g => g.rooms)); await new Promise(r => setTimeout(r, 500)); m3.setOutline([]);
  await modelSlice(); // W3b: the hand-over (flat stand-in out, 3D canvas in) also waits for a pause in scrolling on phones
  interim?.destroy(); interim = null; model = m3;
  applyChoices(); update();
}
// drag to turn (hit area sits over the model only while it is large)
hit.tabIndex = -1;
hit.addEventListener('pointerdown', e => { model?.dragStart(e.clientX); hit.setPointerCapture(e.pointerId); });
hit.addEventListener('pointermove', e => model?.dragMove(e.clientX));
hit.addEventListener('pointerup', () => model?.dragEnd()); hit.addEventListener('pointercancel', () => model?.dragEnd());
hit.addEventListener('keydown', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); model?.nudge(e.key === 'ArrowLeft' ? -.3 : .3); } });

// ---------------- the film while scrolling (W3) ----------------
// the film follows a smoothed scroll target (tau 40 ms: wheel ticks read as motion, lag stays a few frames) drawn every
// animation frame from the scrub frames; at rest the crisp encode takes over on the exact frame
let scrub = null, sm = 0, lastTick = 0, lastScrollAt = 0, filmRaf = 0;
const TAU = 24; // ms: smoothing of the film target (v2 at 40 ms: drawn-frame lag p95 16–18 frames)
function startScrub(hold = false) { if (reduced.matches) return; if (scrub) { if (!hold) scrub.release(); return; } scrub = createScrub({ canvas: $('scrub'), base: `films/scrub/${phoneMode ? 'p' : 'd'}/`, frames: D.film.frames, phone: phoneMode, hold, onData: () => kickFilm() }); kickFilm(); }
const kickFilm = () => { if (!filmRaf) filmRaf = requestAnimationFrame(filmTick); };
function filmTick(now) {
  filmRaf = 0;
  if (!scrub || playing || reduced.matches) return;
  const tgt = Math.min(LAST, tAt(scrollY)) * FPS, dt = lastTick ? Math.min(100, now - lastTick) : 16; lastTick = now;
  const prev = sm; sm += (tgt - sm) * (1 - Math.exp(-dt / TAU)); if (Math.abs(tgt - sm) < .02) sm = tgt;
  const drew = scrub.setTarget(sm, sm - prev);
  if (drew && (sm > .5 || scrollY > 2)) tog(root, 'scrub-on', true);
  const settled = sm === tgt && now - lastScrollAt > 160;
  if (!settled) { if (crisp) { crisp = false; root.classList.remove('film-crisp'); } restFrame = -1; kickFilm(); return; }
  const k = Math.round(tgt); if (k !== restFrame) { restFrame = k; restSeek(k); }
  if (!drew) kickFilm(); // keep drawing until the frames for this position have decoded
}
window.__lvFilm = () => ({ sm, tgt: tAt(scrollY) * FPS, crisp, scrub: scrub?.coverage });

// ---------------- per-frame update from scroll ----------------
let raf = 0;
const onScroll = () => { lastScrollAt = performance.now(); kickFilm(); if (!raf) raf = requestAnimationFrame(update); };
function update() {
  raf = 0;
  const y = scrollY, rm = reduced.matches;
  const t = rm ? 0 : playing ? film.currentTime : tAt(y);
  if (!playing && !rm) target = t;
  if (!rm) paintStill(t);
  if (!rm) css(still, { transform: scrub?.started ? '' : `scale(${(1 + Math.min(.08, y / 4000)).toFixed(4)})` }); // W3: until the first film frame is drawn, the opening still responds to scroll
  // hero copy leaves on its own scroll window (mot-010: scene-1 opacity 1 - progress/0.22), before it reaches the header; its scrim follows
  const hc = document.querySelector('.hero-copy'), lift = rm ? 0 : y * 2.4; // the copy leaves upward 3.4x faster than the page, clipped at the header (contrast never fades)
  const hTop = hc.offsetTop + (hc.offsetParent ? hc.offsetParent.offsetTop : 0) - y - lift, head = isPhone() ? 56 : 64, gone = hTop + hc.offsetHeight <= head;
  css(hc, { transform: lift ? `translate3d(0,${(-lift).toFixed(1)}px,0)` : '', clipPath: lift ? `inset(${Math.max(0, head - hTop).toFixed(1)}px 0 0 0)` : '', visibility: gone ? 'hidden' : '' }); // W3: once the copy has left it stays hidden, so a late web-font reveal never paints it mid-scroll
  const heroA = gone ? 0 : 1;
  const fp = rm ? 0 : ease(clamp((y - .27 * VH) / (.55 * VH))); // starts once the hero copy has left // hero → framed walk
  const railEl = $('rail'); css(railEl, { transform: `translate3d(${G.rail.x}px,${G.rail.y.toFixed(1)}px,0)`, width: G.rail.w + 'px', opacity: clamp((fp - .9) / .1).toFixed(3) });
  tog(root, 'rail-hide', fp < .9);
  document.querySelector('.world-scrim').style.opacity = (1 - fp).toFixed(3);
  $('heroScrim').style.opacity = clamp(1 - (y - .1 * VH) / (.4 * VH)).toFixed(3);
  // stations
  let active = -1, e = 0, aMax = 0;
  secs.forEach((sec, i) => {
    let v = 0;
    if (!rm) { const rel = y - stopY[i]; v = rel < 0 ? 0 : rel < E * VH ? ease(rel / (E * VH)) : rel < (E + W) * VH ? 1 : rel < (E + W + X) * VH ? ease(1 - (rel - (E + W) * VH) / (X * VH)) : 0; }
    else { const r = sec.getBoundingClientRect(); v = r.top < VH * .5 && r.bottom > VH * .5 ? 1 : 0; }
    if (v > e) { e = v; active = i; }
    if (!rm) { css(sec, { '--e': v.toFixed(4) }); const a = clamp((v - .55) / .4), cmp = sec._cmp || (sec._cmp = sec.querySelector('.cmp')); css(cmp, { '--a': a.toFixed(3), visibility: a < .01 ? 'hidden' : '' }); aMax = Math.max(aMax, a); tog(cmp, 'ui-on', a > .97); css(sec._panel || (sec._panel = sec.querySelector('.panel')), { visibility: v < .005 ? 'hidden' : '' });
      if (a >= .01) panPhoto(cmp, clamp((y - stopY[i] - .2 * VH) / ((E + W + X - .4) * VH))); }
    tog(sec, 'is-live', v > .6);
  });
  // the film frame: full-bleed (hero) → framed beside the house (walk) → filling the photo side of a stop (dock)
  { const A = G.cover; let R = mix(A, G.inset, fp);
    if (active >= 0 && e > 0) { const vw = innerWidth, c = isPhone() ? { w: vw, h: .4 * VH } : { w: .57 * vw, h: VH }, cw = Math.max(c.w, c.h * 16 / 9); R = mix(R, { x: (c.w - cw) / 2, y: (c.h - cw * 9 / 16) / 2, w: cw, h: cw * 9 / 16 }, ease(clamp(e / .55))); }
    const fr = $('frame'); if (fr.style.width !== A.w + 'px') { fr.style.width = A.w + 'px'; fr.style.height = A.h + 'px'; }
    css(fr, { transform: `translate3d(${R.x.toFixed(1)}px,${R.y.toFixed(1)}px,0) scale(${(R.w / A.w).toFixed(5)})` }); }
  const endR = $('ending').getBoundingClientRect();
  const endF = ease(clamp((VH - endR.top) / (.7 * VH)));
  // header / rail / hand card
  tog(root, 'on-paper', endF > .5 || (fp > .6 && aMax < .5));
  tog(root, 'rail-off', rm || e > .01 || endF > .02);
  const heroHide = isPhone() ? clamp(1 - (y - .24 * VH) / (.16 * VH)) : 0; // phones: the card waits until the hero copy has gone
  { const vw = innerWidth, card = isPhone() ? { x: vw - 160, y: VH - 250, w: 148, h: 172 } : { x: vw - 340, y: VH - 412, w: 300, h: 340 }, r = mix(card, G.hand, fp);
    css(handEl, { transform: `translate3d(${r.x.toFixed(1)}px,${r.y.toFixed(1)}px,0)`, width: r.w.toFixed(1) + 'px', height: r.h.toFixed(1) + 'px', '--sh': (1 - fp).toFixed(3) }); }
  const handOff = Math.max(clamp(e * 4), endF, heroHide);
  // W3: on phones the card waiting in the hero stays painted at near-zero opacity (its first paint at y≈200 px held the screen ~130 ms)
  const heroWait = isPhone() && heroHide > .2 && Math.max(clamp(e * 4), endF) <= .2;
  css(handEl, { opacity: rm ? '0' : heroWait ? Math.max(.002, 1 - handOff).toFixed(3) : (1 - handOff).toFixed(3), visibility: rm || (handOff > .2 && !heroWait) ? 'hidden' : '' });
  // rail text
  const span = spanAt(t), room = roomOf(span, t), floor = LEVEL_NAME[span.floor];
  const rname = room ? ROOM_NAMES[room] || room : 'Stairs', where = `${rname} · ${floor}`;
  if ($('railRoom').textContent !== rname) { $('railRoom').textContent = rname; $('handWhere').textContent = where; }
  const chip = floor + ' · ' + spanText(span);
  if ($('railChip').textContent !== chip) $('railChip').textContent = chip;
  chapters.forEach((c, i) => css(floorEls[i], { '--p': clamp((t - c.t) / (c.end - c.t)).toFixed(3) }));
  dots.forEach((b, i) => tog(b, 'is-here', i === active && e > .5));
  // model
  if (model) {
    const hand = rectOf($('handSlot'));
    let r = hand, vis = !rm && heroHide < .98;
    if (endF > 0) r = mix(hand, rectOf($('endSlot')), endF);
    if (active >= 0 && e > 0 && endF === 0) r = mix(hand, rectOf(secs[active].querySelector('.slot')), ease(clamp((e - .2) / .8)));
    if (rm) { if (endF > .3) { r = rectOf($('endSlot')); vis = true; } else if (active >= 0) { r = rectOf(secs[active].querySelector('.slot')); vis = true; } }
    model.setRect({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }, vis && r.w > 20);
    const s = active >= 0 ? STOPS[active] : null;
    model.setFocus(endF > .3 ? 'all' : s && e > .3 ? s.level : y < .35 * VH && !playing ? 'all' : span.floor);
    model.setHere(endF > .1 || e > .3 ? null : room);
    model.setOutline([...(s && e > .3 && !chosen[s.group] ? GROUPS[s.group].rooms : []), ...Object.keys(chosen).flatMap(g => GROUPS[g].rooms)]);
    model.setSpin(endF > .98 && !rm);
    if (!rm && model.setTurn) model.setTurn(active >= 0 && e > 0 && endF === 0 ? (clamp((y - stopY[active]) / ((E + W + X) * VH)) - .5) * 1.2 : 0); // W3: the model turns with scroll at a stop
    const big = endF > .9 || e > .9;
    if (big) { Object.assign(hit.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' }); hit.tabIndex = 0; } else if (hit.style.width !== '0px') { Object.assign(hit.style, { width: '0px', height: '0px' }); hit.tabIndex = -1; }
  }
}
// W3: the docked photo is never still while you scroll — it pans across its own overscan (the listing photo is 4:3,
// the box is narrower, so the crop already hides ~30 % of its width), linear in scroll through approach, dock and recede
function panPhoto(cmp, p) {
  const ph = isPhone(), w = ph ? innerWidth : .57 * innerWidth, h = ph ? .4 * VH : VH, S = ph ? 1.25 + .12 * p : 1.02 + .1 * p; // a visible push-in as well as the pan
  let iw = h * S * 4 / 3, ih = h * S; if (iw < w * S) { iw = w * S; ih = iw * 3 / 4; }
  const x = -(iw - w) * (ph ? .15 + .7 * p : p), y = -(ih - h) * (ph ? .2 + .6 * p : .5);
  const st = { maxWidth: 'none', width: iw.toFixed(1) + 'px', height: ih.toFixed(1) + 'px', inset: 'auto', left: '0px', top: '0px', transform: `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0)` };
  for (const img of cmp._imgs || (cmp._imgs = cmp.querySelectorAll('.cmp-asis,.cmp-staged'))) css(img, st);
}
// focus entering a stop docks it (keyboard users never act on a hidden panel)
document.addEventListener('focusin', ev => { if (reduced.matches) return; const sec = ev.target.closest?.('.stop'); if (!sec) return; const i = +sec.dataset.i, rel = scrollY - stopY[i]; if (rel < E * VH * .9 || rel > (E + W) * VH) scrollTo({ top: dockY(i), behavior: 'instant' }); });
document.querySelector('.hero-act a').addEventListener('click', ev => { ev.preventDefault(); jumpToStop(0); });
document.querySelector('.skip').addEventListener('click', ev => { ev.preventDefault(); stopPlay(); scrollTo({ top: endTop, behavior: 'instant' }); $('endTitle').setAttribute('tabindex', '-1'); $('endTitle').focus({ preventScroll: true }); });
document.querySelector('.mark').addEventListener('click', ev => { ev.preventDefault(); stopPlay(); scrollTo({ top: 0, behavior: 'instant' }); });

addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', () => { const w = innerWidth, h = innerHeight; if (w === lastW && Math.abs(h - VH) < 160) { onScroll(); return; } const keepT = tAt(scrollY); lastW = w; VH = h; layout(); if (!reduced.matches) scrollTo({ top: yAt(keepT), behavior: 'instant' }); update(); });
reduced.addEventListener('change', () => location.reload());
wide.addEventListener('change', () => { root.classList.toggle('phone', isPhone()); layout(); tally(); update(); });
tally(); tiles(); layout(); update();
if (phoneMode && !reduced.matches && glAvailable()) makeInterim(); // W3: phones build the flat stand-in before first paint (doing it at 'load' held a scroll that had already started)
startScrub(phoneMode); // W3: film frames start loading with the page (phones: index + the 1-second sparse pack only until the first input), so a scroll that starts before 'load' still moves the film
if (false) startScrub(); // (was: desktop only) (not at 'load'), so a scroll before load still moves the film
let modelAsked = false, gotInput = false; const firstInput = () => { if (gotInput) return; gotInput = true; if (phoneMode) { startScrub(); lastScrollAt = performance.now(); /* W3: the rest of the film packs start with the first input (sparse-only blends are too gradual to read as motion) */ whenScrollIdle(loadFilm, 450); whenScrollIdle(predecode, 250); /* W3: the video (rest + Play) and image pre-decode start in a scroll pause on phones */ if (!modelAsked) { modelAsked = true; whenScrollIdle(initModel, 450); } } }; // W3: on phones the model's one-time build (~130 ms at 4x CPU) waits for a pause in scrolling, never lands mid-scroll
for (const ev of ['wheel', 'touchstart', 'keydown', 'pointerdown']) addEventListener(ev, firstInput, { passive: true }); // review fix (Codex c0 #4/#7): genuine input only, one latch
// run fn once the page has not scrolled for `ms` (one-time heavy work must not land in the middle of a scroll)
function whenScrollIdle(fn, ms) { const t = () => performance.now() - lastScrollAt >= ms ? fn() : setTimeout(t, 120); setTimeout(t, 120); }
// W3: decode every stop's photos and thumbnails before they are needed (the first stop otherwise held 250 ms on arrival)
let predecoded = false;
function predecode() { if (reduced.matches || predecoded) return; predecoded = true; let i = 0; const imgs = [...document.querySelectorAll('.stop img')]; const n = phoneMode ? 1 : 4; const next = () => { const b = imgs.slice(i, i + n); i += n; if (!b.length) return; Promise.all(b.map(im => { im.loading = 'eager'; return im.decode().catch(() => {}); })).then(() => setTimeout(next, 30)); }; next(); }
addEventListener('load', () => { /* film frames and the phone flat stand-in start at module run */ if (!phoneMode) { loadFilm(); startScrub(); setTimeout(predecode, 300); } if (!phoneMode) { window.requestIdleCallback ? requestIdleCallback(() => initModel(), { timeout: 600 }) : setTimeout(initModel, 200); } layout(); update(); });
window.__lv = { geom: { E, W, X }, tAt, yAt, dockY, stops: STOPS, get state() { return { t: tAt(scrollY), ready, playing, chosen: { ...chosen }, anchors, stopY, endTop, VH, blob: !!blobUrl, model: !!model, flat: !!model?.flat }; }, choose, jumpToStop, play, stopPlay, film };
