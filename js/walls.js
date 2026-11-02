// Wall geometry for the plan-textured model (listing-engine template, B1). Pure: no DOM, testable in node
// (engine/checks/runtime/wall_geometry.mjs). A wall is a plan_px outline from listing.json (rect, polygon or thick segment).
// Rectangles (4 vertices, right angles) take Morewood's instanced-box path exactly; any other outline (L-shaped, diagonal,
// concave) is extruded from its FULL polygon, so no traced geometry is lost.
export function isRectangle(v, tol = 1e-6) {
  if (v.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const a = v[i], b = v[(i + 1) % 4], c = v[(i + 2) % 4];
    const ux = b[0] - a[0], uy = b[1] - a[1], wx = c[0] - b[0], wy = c[1] - b[1];
    const lu = Math.hypot(ux, uy), lw = Math.hypot(wx, wy);
    if (lu < tol || lw < tol || Math.abs(ux * wx + uy * wy) > 1e-3 * lu * lw) return false;
  }
  return true;
}
// -> { boxes: [{x, z, w, d, h, yaw}], polys: [{pts: [[x, z]...], h}] }  (world metres; level transform applied by toWorld)
export function wallPieces(walls, toWorld, { s, rot, wallH, postH, postM }) {
  const boxes = [], polys = [];
  for (const wl of walls) {
    const v = wl.v;
    if (isRectangle(v)) {
      const e1 = Math.hypot(v[1][0] - v[0][0], v[1][1] - v[0][1]), e2 = Math.hypot(v[2][0] - v[1][0], v[2][1] - v[1][1]);
      const cx = v.reduce((a, p) => a + p[0], 0) / 4, cy = v.reduce((a, p) => a + p[1], 0) / 4; const p = toWorld(cx, cy);
      const lw = e1 * s, lh = e2 * s, isPost = lw < postM && lh < postM;
      boxes.push({ x: p[0], z: p[1], w: Math.max(lw, .05), d: Math.max(lh, .05), h: wl.h || (isPost ? postH : wallH), yaw: Math.atan2(v[1][1] - v[0][1], v[1][0] - v[0][0]) + rot });
    } else polys.push({ pts: v.map(([x, y]) => toWorld(x, y)), h: wl.h || wallH });
  }
  return { boxes, polys };
}
export const polyArea = pts => Math.abs(pts.reduce((a, p, i) => { const q = pts[(i + 1) % pts.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
