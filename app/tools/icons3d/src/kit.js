// The Housefi 3D icon kit: materials, shapes and small building blocks shared by every icon. The look matches the
// Housefi website's 3D scene: glossy "soft 3D" plastics with a clearcoat, chrome, warm wood, frosted glass, and the
// brand palette taken from the logo.
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

export { THREE }

export const C = {
  // Brand (logo)
  cobalt: '#0A45F5',
  royal: '#1746E8',
  blue: '#2F6BFF',
  sky: '#5AA9FF',
  cyan: '#06BFF8',
  aqua: '#48D9F5',
  deep: '#0420E8',
  orange: '#FF8A10',
  amber: '#FFC83A',
  yellow: '#FFD52E',
  // Neutrals
  white: '#FFFFFF',
  snow: '#F3F6FC',
  mist: '#DCE4F5',
  steel: '#9AA6BF',
  slate: '#56607E',
  ink: '#1B2340',
  // States
  green: '#1FBF6A',
  mint: '#5FE0A0',
  red: '#F0474D',
  pink: '#FF7AA8',
  // Materials
  wood: '#C98A4B',
  woodDark: '#9A5E2C',
  leaf: '#3BBF7A',
  leafDark: '#24965C',
  gold: '#FFC23A',
  // People
  skin: '#E2A47E',
  skinDeep: '#C9875E',
  hair: '#2A1E1A',
  lips: '#C2525C',
}

/**
 * Albedo for a brand colour. The lighting is bright enough for white to read as white, which would push saturated
 * colours past 1.0 so tone mapping washes them out; saturated colours are darkened in linear space so that, once lit,
 * they land on the brand colour itself. (Same rule as the website.)
 */
export function albedo(color) {
  const c = new THREE.Color(color)
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl)
  if (hsl.s > 0.45) c.multiplyScalar(THREE.MathUtils.lerp(1, 0.5, THREE.MathUtils.smoothstep(hsl.s, 0.45, 0.9)))
  return c
}

// ---------- materials ----------

export const plastic = (color, o = {}) => new THREE.MeshPhysicalMaterial({ roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.16, ...o, color: albedo(o.color ?? color) })
export const matte = (color, o = {}) => new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0, ...o, color: albedo(o.color ?? color) })
export const chrome = (o = {}) => new THREE.MeshStandardMaterial({ color: '#E9EDF5', roughness: 0.12, metalness: 1, ...o })
export const metal = (color = '#B9C2D3', o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.28, metalness: 0.85, ...o })
export const glow = (color, intensity = 1) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.4 })
export const glass = (o = {}) => new THREE.MeshPhysicalMaterial({ color: '#FFFFFF', transmission: 1, roughness: 0.08, thickness: 0.1, ior: 1.4, clearcoat: 1, attenuationColor: new THREE.Color('#D9F3FF'), attenuationDistance: 2, ...o })
export const tinted = (color, opacity = 0.6, o = {}) => new THREE.MeshPhysicalMaterial({ color, transparent: true, opacity, roughness: 0.1, clearcoat: 1, depthWrite: false, ...o })
export const bubbleMat = () => new THREE.MeshPhysicalMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.4, roughness: 0, iridescence: 1, iridescenceIOR: 1.33, iridescenceThicknessRange: [180, 620], clearcoat: 1, depthWrite: false })
export const skin = (tone = C.skin) => new THREE.MeshPhysicalMaterial({ color: albedo(tone), roughness: 0.55, sheen: 0.6, sheenColor: new THREE.Color('#FFD9C4'), clearcoat: 0.15 })

// ---------- shapes ----------

/** Adds a mesh to a parent at a position, with optional rotation (radians) and returns it. */
export function put(parent, geometry, material, pos = [0, 0, 0], rot = [0, 0, 0], scale) {
  const m = new THREE.Mesh(geometry, material)
  m.position.set(...pos)
  m.rotation.set(...rot)
  if (scale !== undefined) Array.isArray(scale) ? m.scale.set(...scale) : m.scale.setScalar(scale)
  m.castShadow = true
  m.receiveShadow = true
  parent.add(m)
  return m
}

export const rbox = (w, h, d, r = Math.min(w, h, d) * 0.22, seg = 4) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, Math.min(w, h, d) / 2 - 1e-4))
export const cyl = (rt, rb, h, seg = 48) => new THREE.CylinderGeometry(rt, rb, h, seg)
export const sphere = (r, seg = 40) => new THREE.SphereGeometry(r, seg, Math.round(seg * 0.7))
export const torus = (r, tube, arc = Math.PI * 2, seg = 64) => new THREE.TorusGeometry(r, tube, 20, seg, arc)
export const capsule = (r, len, seg = 24) => new THREE.CapsuleGeometry(r, len, 8, seg)
export const cone = (r, h, seg = 48) => new THREE.ConeGeometry(r, h, seg)

/** A rounded rectangle path (for extrusions and holes). */
export function roundRect(path, x0, y0, x1, y1, r) {
  r = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2)
  path.moveTo(x0 + r, y0)
  path.lineTo(x1 - r, y0)
  path.quadraticCurveTo(x1, y0, x1, y0 + r)
  path.lineTo(x1, y1 - r)
  path.quadraticCurveTo(x1, y1, x1 - r, y1)
  path.lineTo(x0 + r, y1)
  path.quadraticCurveTo(x0, y1, x0, y1 - r)
  path.lineTo(x0, y0 + r)
  path.quadraticCurveTo(x0, y0, x0 + r, y0)
  return path
}

/** Extrudes a 2D shape with soft bevelled edges; the result is centred on z. */
export function extrude(shape, depth, bevel = 0.03, curveSegments = 24) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments })
  g.translate(0, 0, -depth / 2)
  return g
}

/** Shape from a list of [x, y] points. */
export function poly(points) {
  const s = new THREE.Shape()
  points.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)))
  s.closePath()
  return s
}

/** A thick stroke along a 2D polyline, as a tube (used for check marks, crosses and simple glyphs). */
export function stroke(points, radius, z = 0) {
  const curve = new THREE.CurvePath()
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]]
    curve.add(new THREE.LineCurve3(new THREE.Vector3(a[0], a[1], z), new THREE.Vector3(b[0], b[1], z)))
  }
  const g = new THREE.TubeGeometry(curve, 24 * points.length, radius, 16, false)
  return g
}

/** Rounded end caps for a stroke (spheres at each point). */
export function strokeWithCaps(parent, points, radius, mat, z = 0) {
  put(parent, stroke(points, radius, z), mat)
  for (const [x, y] of points) put(parent, sphere(radius, 20), mat, [x, y, z])
}

export function group(parent, pos = [0, 0, 0], rot = [0, 0, 0], scale = 1) {
  const g = new THREE.Group()
  g.position.set(...pos)
  g.rotation.set(...rot)
  g.scale.setScalar(scale)
  parent?.add(g)
  return g
}

// ---------- canvas textures ----------

const FONT = '"Anek Latin", "Anek Telugu", "Segoe UI", Arial, sans-serif'

export function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d'), w, h)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

/** Wood grain. */
export function woodTexture(base = C.wood) {
  const t = canvasTexture(512, 256, (g) => {
    g.fillStyle = base
    g.fillRect(0, 0, 512, 256)
    for (let i = 0; i < 26; i++) {
      const y = (i / 26) * 256 + Math.sin(i * 1.7) * 6
      g.strokeStyle = i % 3 === 0 ? 'rgba(120,70,30,0.35)' : 'rgba(255,220,170,0.18)'
      g.lineWidth = 2 + (i % 4)
      g.beginPath()
      g.moveTo(0, y)
      for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x / 60 + i) * 5)
      g.stroke()
    }
  })
  t.wrapS = THREE.RepeatWrapping
  return t
}

/** A face with text or a symbol, for coins, keypads, calendars and screens. */
export function labelTexture(text, { bg = null, fg = '#FFFFFF', size = 0.62, weight = 800, w = 256, h = 256 } = {}) {
  return canvasTexture(w, h, (g) => {
    if (bg) {
      g.fillStyle = bg
      g.fillRect(0, 0, w, h)
    }
    g.fillStyle = fg
    g.font = `${weight} ${Math.round(h * size)}px ${FONT}`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(text, w / 2, h / 2 + h * 0.04)
  })
}

/** A plane with a texture, slightly in front of a surface. */
export function decal(parent, texture, w, h, pos, rot = [0, 0, 0], o = {}) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: texture, transparent: true, roughness: 0.45, ...o }))
  m.position.set(...pos)
  m.rotation.set(...rot)
  parent.add(m)
  return m
}

// ---------- building blocks ----------

const BADGE_COLORS = { check: C.green, cross: C.red, clock: C.amber, alert: C.amber, plus: C.cobalt, rupee: C.gold, star: C.amber }

/**
 * A round status badge (check, cross, clock, alert, plus, rupee) — the same small sign across every icon that shows
 * a state, so "done", "failed" and "waiting" always look the same.
 */
export function badge(parent, kind, pos, scale = 1) {
  const g = group(parent, pos, [0, 0, 0], scale)
  const body = plastic(BADGE_COLORS[kind] ?? C.cobalt, { roughness: 0.22 })
  put(g, cyl(0.5, 0.5, 0.2, 64), body, [0, 0, 0], [Math.PI / 2, 0, 0])
  put(g, torus(0.5, 0.1, Math.PI * 2, 64), body, [0, 0, 0])
  const white = plastic(C.white, { roughness: 0.25 })
  const ink = kind === 'clock' || kind === 'alert' || kind === 'rupee' ? plastic('#5A3A00', { roughness: 0.3 }) : white
  const z = 0.13
  if (kind === 'check') strokeWithCaps(g, [[-0.22, 0.0], [-0.06, -0.16], [0.24, 0.16]], 0.075, white, z)
  if (kind === 'cross') {
    strokeWithCaps(g, [[-0.18, -0.18], [0.18, 0.18]], 0.075, white, z)
    strokeWithCaps(g, [[-0.18, 0.18], [0.18, -0.18]], 0.075, white, z)
  }
  if (kind === 'plus') {
    strokeWithCaps(g, [[-0.2, 0], [0.2, 0]], 0.075, white, z)
    strokeWithCaps(g, [[0, -0.2], [0, 0.2]], 0.075, white, z)
  }
  if (kind === 'clock') {
    strokeWithCaps(g, [[0, 0.22], [0, 0], [0.16, -0.08]], 0.06, ink, z)
  }
  if (kind === 'alert') {
    strokeWithCaps(g, [[0, 0.22], [0, -0.02]], 0.07, ink, z)
    put(g, sphere(0.075, 20), ink, [0, -0.2, z])
  }
  if (kind === 'rupee') decal(g, labelTexture('₹', { fg: '#5A3A00', size: 0.7 }), 0.7, 0.7, [0, 0, 0.115])
  if (kind === 'star') {
    const pts = []
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 0.12 : 0.28
      const a = Math.PI / 2 + (i / 10) * Math.PI * 2
      pts.push([Math.cos(a) * r, Math.sin(a) * r])
    }
    put(g, extrude(poly(pts), 0.06, 0.02), white, [0, 0, z])
  }
  return g
}

/** A gold coin with ₹ on its face. */
export function coin(parent, pos, rot = [0, 0, 0], r = 0.42) {
  const g = group(parent, pos, rot)
  const gold = plastic(C.gold, { roughness: 0.25, metalness: 0.25 })
  put(g, cyl(r, r, r * 0.28, 64), gold, [0, 0, 0], [Math.PI / 2, 0, 0])
  put(g, torus(r * 0.98, r * 0.08, Math.PI * 2, 64), plastic('#F0A81C', { roughness: 0.25, metalness: 0.25 }), [0, 0, r * 0.12])
  decal(g, labelTexture('₹', { fg: '#A8650A', size: 0.66 }), r * 1.5, r * 1.5, [0, 0, r * 0.145])
  return g
}

/** A phone (front faces +z) with an optional screen texture. */
export function phone(parent, pos, rot = [0, 0, 0], { screen = null, color = C.ink } = {}) {
  const g = group(parent, pos, rot)
  put(g, rbox(0.9, 1.7, 0.12, 0.16), plastic(color, { roughness: 0.3 }))
  const scr = new THREE.MeshStandardMaterial({ color: '#FFFFFF', map: screen, roughness: 0.3, emissive: '#FFFFFF', emissiveIntensity: screen ? 0.18 : 0.05, emissiveMap: screen })
  put(g, rbox(0.78, 1.56, 0.02, 0.1), scr, [0, 0, 0.06])
  put(g, rbox(0.24, 0.05, 0.02, 0.025), plastic('#0B0F1E'), [0, 0.7, 0.072])
  return g
}

/** A card (bank card) with a chip; front faces +z. */
export function bankCard(parent, pos, rot = [0, 0, 0], color = C.cobalt) {
  const g = group(parent, pos, rot)
  put(g, rbox(1.6, 1.02, 0.07, 0.12), plastic(color, { roughness: 0.25 }))
  put(g, rbox(1.6, 0.16, 0.075, 0.02), plastic('#0A1A60', { roughness: 0.4 }), [0, 0.22, 0.002])
  put(g, rbox(0.3, 0.22, 0.03, 0.04), plastic(C.gold, { metalness: 0.4, roughness: 0.25 }), [-0.5, -0.12, 0.045])
  put(g, rbox(0.5, 0.06, 0.02, 0.03), plastic('#FFFFFF'), [0.32, -0.3, 0.04])
  return g
}

/** A sheet of paper with lines (and optional heading bar), front faces +z. */
export function paper(parent, pos, rot = [0, 0, 0], { w = 1.2, h = 1.55, lines = 4, accent = C.cobalt } = {}) {
  const g = group(parent, pos, rot)
  put(g, rbox(w, h, 0.05, 0.08), plastic(C.white, { roughness: 0.45 }))
  put(g, rbox(w * 0.55, 0.1, 0.02, 0.04), plastic(accent), [-w * 0.15, h * 0.33, 0.03])
  for (let i = 0; i < lines; i++) put(g, rbox(w * (0.72 - (i % 2) * 0.18), 0.06, 0.02, 0.025), plastic(C.mist), [-w * (0.06 + (i % 2) * 0.09), h * 0.14 - i * 0.18, 0.03])
  return g
}

// ---------- the Housefi logo in 3D (same geometry as the website; measured from the logo file) ----------

const LCX = 639
const LCY = 627
const LU = 574
const lv = (x, y) => new THREE.Vector2((x - LCX) / LU, (LCY - y) / LU)

function roundedPolygon(points) {
  const s = new THREE.Shape()
  const n = points.length
  for (let i = 0; i < n; i++) {
    const [x, y, r] = points[i]
    const p = lv(x, y)
    const prev = lv(...points[(i - 1 + n) % n])
    const next = lv(...points[(i + 1) % n])
    const rr = r / LU
    const a = p.clone().add(prev.clone().sub(p).setLength(Math.min(rr, prev.distanceTo(p) / 2)))
    const b = p.clone().add(next.clone().sub(p).setLength(Math.min(rr, next.distanceTo(p) / 2)))
    i === 0 ? s.moveTo(a.x, a.y) : s.lineTo(a.x, a.y)
    s.quadraticCurveTo(p.x, p.y, b.x, b.y)
  }
  s.closePath()
  return s
}

function paint(geo, colorAt) {
  const pos = geo.getAttribute('position')
  const colors = new Float32Array(pos.count * 3)
  const c = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    colorAt(pos.getX(i), pos.getY(i), c)
    colors.set([c.r, c.g, c.b], i * 3)
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geo
}

/** The Housefi logo as an object, 2 units wide (with its tile), facing +z. */
export function logo(parent, pos = [0, 0, 0], scale = 1, { tile = true } = {}) {
  const g = group(parent, pos, [0, 0, 0], scale)
  const bevel = { bevelEnabled: true, bevelSegments: 4, curveSegments: 24 }
  if (tile) {
    const r = 0.47
    const s = new THREE.Shape()
    s.moveTo(-1 + r, -1)
    s.lineTo(1 - r, -1)
    s.bezierCurveTo(1 - r * 0.2, -1, 1, -1 + r * 0.2, 1, -1 + r)
    s.lineTo(1, 1 - r)
    s.bezierCurveTo(1, 1 - r * 0.2, 1 - r * 0.2, 1, 1 - r, 1)
    s.lineTo(-1 + r, 1)
    s.bezierCurveTo(-1 + r * 0.2, 1, -1, 1 - r * 0.2, -1, 1 - r)
    s.lineTo(-1, -1 + r)
    s.bezierCurveTo(-1, -1 + r * 0.2, -1 + r * 0.2, -1, -1 + r, -1)
    const tileGeo = new THREE.ExtrudeGeometry(s, { ...bevel, depth: 0.14, bevelSize: 0.06, bevelThickness: 0.06 })
    const cyan = albedo('#06BFF8')
    const blue = albedo('#0A45F5')
    const deep = albedo('#0420E8')
    paint(tileGeo, (x, y, out) => {
      out.copy(cyan).lerp(blue, THREE.MathUtils.smoothstep(Math.min(1, Math.hypot(x + 1, y - 1) / 1.6), 0, 1))
      out.lerp(deep, THREE.MathUtils.clamp((x - y) / 2 - 0.2, 0, 1) * 0.6)
    })
    put(g, tileGeo, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.4, specularIntensity: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.2, envMapIntensity: 0.25 }), [0, 0, -0.2])
  }
  const z = tile ? 0 : -0.1
  const opts = { ...bevel, depth: 0.16, bevelSize: 0.025, bevelThickness: 0.03 }
  // Orange arc: a quarter of an elliptical ring (outer 465 × 352 px, inner 297 × 190 px) centred at (488, 980).
  const arcShape = new THREE.Shape()
  for (let i = 0; i <= 48; i++) {
    const t = (Math.PI / 2) * (1 - i / 48)
    const p = lv(488 + 465 * Math.cos(t), 980 - 352 * Math.sin(t))
    i ? arcShape.lineTo(p.x, p.y) : arcShape.moveTo(p.x, p.y)
  }
  for (let i = 0; i <= 48; i++) {
    const t = (Math.PI / 2) * (i / 48)
    const p = lv(488 + 297 * Math.cos(t), 980 - 190 * Math.sin(t))
    arcShape.lineTo(p.x, p.y)
  }
  const arcGeo = new THREE.ExtrudeGeometry(arcShape, { ...bevel, depth: 0.07, bevelSize: 0.015, bevelThickness: 0.02 })
  const centre = lv(488, 980)
  const orange = albedo('#FF8A10')
  const yellow = albedo('#FFD52E')
  const deepOrange = albedo('#FF6A00')
  paint(arcGeo, (x, y, out) => {
    const t = Math.atan2((y - centre.y) / (271 / LU), (x - centre.x) / (381 / LU))
    const u = THREE.MathUtils.clamp(1 - t / (Math.PI / 2), 0, 1)
    out.copy(orange).lerp(yellow, Math.exp(-(((u - 0.38) / 0.2) ** 2)))
    out.lerp(deepOrange, THREE.MathUtils.smoothstep(u, 0.62, 1))
  })
  put(g, arcGeo, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.35, specularIntensity: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.2, envMapIntensity: 0.25, emissive: '#FF8A10', emissiveIntensity: 0.1 }), [0, 0, z + 0.02])
  put(g, new THREE.ExtrudeGeometry(roundedPolygon([[293, 980, 46], [293, 470, 64], [637, 222, 44], [637, 435, 0], [487, 545, 6], [487, 980, 46]]), opts), new THREE.MeshPhysicalMaterial({ color: '#F4F8FF', roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 0.8 }), [0, 0, z])
  const roof = new THREE.MeshPhysicalMaterial({ color: '#DCEDFF', transparent: true, opacity: 0.82, roughness: 0.2, clearcoat: 1, depthWrite: false })
  const leg = new THREE.MeshPhysicalMaterial({ color: '#CFE6FF', transparent: true, opacity: 0.32, roughness: 0.2, clearcoat: 1, depthWrite: false })
  put(g, new THREE.ExtrudeGeometry(roundedPolygon([[637, 222, 44], [981, 470, 64], [981, 660, 0], [783, 541, 4], [637, 435, 0]]), opts), roof, [0, 0, z]).renderOrder = 1
  put(g, new THREE.ExtrudeGeometry(roundedPolygon([[783, 541, 0], [981, 660, 0], [981, 980, 46], [783, 980, 46]]), opts), leg, [0, 0, z]).renderOrder = 1
  return g
}
