// Objects, places, money and states. Status is always shown with the same round badge (kit.badge): check = done,
// cross = failed, clock = waiting, alert = needs attention.
import {
  C, THREE, badge, bankCard, capsule, chrome, coin, cone, cyl, decal, extrude, glow, group, labelTexture, logo, matte, metal, paper, phone, plastic, poly, put, rbox, roundRect, sphere, strokeWithCaps, tinted, torus, woodTexture, canvasTexture,
} from '../kit.js'

// ---------- shared parts ----------

function houseModel(g, { garden = false } = {}) {
  const wall = plastic(C.white, { roughness: 0.45 })
  put(g, rbox(1.2, 0.86, 0.9, 0.08), wall, [0, -0.2, 0])
  const roofMat = plastic(C.cobalt, { roughness: 0.28 })
  for (const side of [-1, 1]) put(g, rbox(0.92, 0.12, 1.08, 0.05), roofMat, [side * 0.34, 0.42, 0], [0, 0, -side * 0.72])
  put(g, cyl(0.07, 0.07, 1.08, 24), roofMat, [0, 0.72, 0], [Math.PI / 2, 0, 0])
  put(g, rbox(0.3, 0.46, 0.06, 0.06), plastic(C.cobalt), [-0.22, -0.4, 0.46])
  put(g, sphere(0.03, 16), plastic(C.amber), [-0.12, -0.4, 0.5])
  put(g, rbox(0.34, 0.3, 0.05, 0.05), tinted('#CDEFFF', 0.9, { emissive: '#BDEBFF', emissiveIntensity: 0.25 }), [0.26, -0.12, 0.46])
  put(g, rbox(0.03, 0.3, 0.06, 0.01), plastic(C.white), [0.26, -0.12, 0.47])
  logo(g, [0, 0.2, 0.465], 0.1)
  put(g, rbox(0.18, 0.36, 0.18, 0.04), plastic(C.deep), [0.36, 0.66, -0.2])
  if (garden) {
    const leaf = plastic(C.leaf, { roughness: 0.55, clearcoat: 0.4 })
    for (const [x, y, z, r] of [[-0.78, -0.42, 0.25, 0.22], [0.78, -0.45, 0.3, 0.18], [-0.66, -0.5, 0.48, 0.14]]) put(g, new THREE.IcosahedronGeometry(r, 3), leaf, [x, y, z], [0, 0, 0], [1, 0.85, 1])
    put(g, cyl(0.04, 0.05, 0.5, 12), new THREE.MeshStandardMaterial({ map: woodTexture() }), [0.82, -0.3, -0.25])
    put(g, new THREE.IcosahedronGeometry(0.3, 3), leaf, [0.82, 0.1, -0.25])
    put(g, rbox(2.0, 0.08, 1.5, 0.04), matte('#DDEFE3'), [0, -0.66, 0.1])
  }
}

function pin(g, pos = [0, 0, 0], color = C.red, s = 1) {
  const p = group(g, pos, [0, 0, 0], s)
  const mat = plastic(color, { roughness: 0.22 })
  put(p, sphere(0.36, 48), mat, [0, 0.3, 0])
  put(p, cone(0.31, 0.62, 48), mat, [0, -0.12, 0], [Math.PI, 0, 0])
  put(p, sphere(0.14, 32), plastic(C.white), [0, 0.32, 0.26], [0, 0, 0], [1, 1, 0.5])
  return p
}

function magnifier(g, pos = [0, 0, 0], rot = [0, 0, -0.6], s = 1) {
  const m = group(g, pos, rot, s)
  put(m, torus(0.36, 0.08, Math.PI * 2, 64), plastic(C.cobalt, { roughness: 0.22 }))
  put(m, cyl(0.34, 0.34, 0.04, 64), tinted('#D9F3FF', 0.45), [0, 0, 0], [Math.PI / 2, 0, 0])
  put(m, capsule(0.08, 0.42, 20), plastic(C.orange), [0, -0.72, 0])
  put(m, cyl(0.1, 0.1, 0.12, 24), metal(), [0, -0.44, 0])
  return m
}

function calendarBox(g, pos = [0, 0, 0], { day = '18', clock = false } = {}) {
  const c = group(g, pos)
  put(c, rbox(1.3, 1.2, 0.22, 0.14), plastic(C.white, { roughness: 0.4 }))
  put(c, rbox(1.3, 0.36, 0.24, 0.1), plastic(C.cobalt, { roughness: 0.28 }), [0, 0.43, 0.005])
  for (const x of [-0.34, 0.34]) put(c, capsule(0.06, 0.22, 16), chrome(), [x, 0.62, 0])
  decal(c, labelTexture(day, { fg: '#1B2340', size: 0.66 }), 0.66, 0.66, [0, -0.12, 0.115])
  if (clock) {
    const k = group(c, [0.56, -0.5, 0.22], [0, 0, 0], 0.62)
    put(k, cyl(0.5, 0.5, 0.18, 64), plastic(C.white), [0, 0, 0], [Math.PI / 2, 0, 0])
    put(k, torus(0.5, 0.09, Math.PI * 2, 64), plastic(C.orange))
    strokeWithCaps(k, [[0, 0.26], [0, 0], [0.2, -0.1]], 0.05, plastic(C.ink), 0.11)
  }
  return c
}

function hourglass(g, pos = [0, 0, 0], s = 1) {
  const h = group(g, pos, [0, 0, 0.15], s)
  const frame = plastic(C.cobalt, { roughness: 0.25 })
  for (const y of [0.62, -0.62]) put(h, rbox(0.86, 0.12, 0.86, 0.05), frame, [0, y, 0])
  for (const [x, z] of [[-0.34, -0.34], [0.34, -0.34], [-0.34, 0.34], [0.34, 0.34]]) put(h, cyl(0.035, 0.035, 1.2, 12), frame, [x, 0, z])
  const glassProfile = [[0.001, -0.56], [0.28, -0.52], [0.3, -0.3], [0.06, -0.02], [0.06, 0.02], [0.3, 0.3], [0.28, 0.52], [0.001, 0.56]].map(([x, y]) => new THREE.Vector2(x, y))
  put(h, new THREE.LatheGeometry(glassProfile, 48), tinted('#E6F6FF', 0.35, { side: THREE.DoubleSide }))
  const sand = plastic(C.amber, { roughness: 0.6, clearcoat: 0.2 })
  put(h, cone(0.24, 0.24, 40), sand, [0, -0.42, 0])
  put(h, cone(0.2, 0.22, 40), sand, [0, 0.22, 0], [Math.PI, 0, 0])
  put(h, cyl(0.015, 0.015, 0.36, 8), sand, [0, -0.12, 0])
  return h
}

function bell(g, pos = [0, 0, 0], s = 1) {
  const b = group(g, pos, [0, 0, 0.18], s)
  const profile = [[0.001, 0.56], [0.12, 0.54], [0.24, 0.42], [0.3, 0.12], [0.36, -0.14], [0.5, -0.3], [0.52, -0.36], [0.001, -0.36]].map(([x, y]) => new THREE.Vector2(x, y))
  put(b, new THREE.LatheGeometry(profile, 64), plastic(C.yellow, { roughness: 0.2, emissive: '#FFB21C', emissiveIntensity: 0.12 }))
  put(b, torus(0.06, 0.025, Math.PI * 2, 24), plastic(C.amber), [0, 0.6, 0])
  put(b, sphere(0.12, 28), plastic(C.orange), [0, -0.44, 0])
  return b
}

function shield(g, pos = [0, 0, 0], s = 1, color = C.cobalt) {
  const sh = group(g, pos, [0, 0, 0], s)
  const shape = new THREE.Shape()
  shape.moveTo(0, 0.68)
  shape.bezierCurveTo(0.22, 0.56, 0.42, 0.52, 0.6, 0.52)
  shape.bezierCurveTo(0.6, 0.0, 0.5, -0.46, 0, -0.74)
  shape.bezierCurveTo(-0.5, -0.46, -0.6, 0.0, -0.6, 0.52)
  shape.bezierCurveTo(-0.42, 0.52, -0.22, 0.56, 0, 0.68)
  put(sh, extrude(shape, 0.22, 0.06), plastic(color, { roughness: 0.22 }))
  return sh
}

function star(g, pos = [0, 0, 0], s = 1, color = C.amber, depth = 0.24) {
  const pts = []
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.26 : 0.62
    const a = Math.PI / 2 + (i / 10) * Math.PI * 2
    pts.push([Math.cos(a) * r, Math.sin(a) * r])
  }
  return put(g, extrude(poly(pts), depth, 0.08), plastic(color, { roughness: 0.2 }), pos, [0, 0, 0], s)
}

function receipt(g, pos = [0, 0, 0], rot = [0, 0, 0], { w = 1.05, h = 1.45 } = {}) {
  const r = group(g, pos, rot)
  const s = new THREE.Shape()
  s.moveTo(-w / 2, -h / 2)
  const teeth = 7
  for (let i = 0; i <= teeth * 2; i++) s.lineTo(-w / 2 + (i / (teeth * 2)) * w, -h / 2 + (i % 2 ? 0.07 : 0))
  s.lineTo(w / 2, h / 2)
  s.lineTo(-w / 2, h / 2)
  s.closePath()
  put(r, extrude(s, 0.04, 0.02), plastic(C.white, { roughness: 0.45 }))
  decal(r, labelTexture('₹', { fg: '#0A45F5', size: 0.66 }), 0.36, 0.36, [-w * 0.27, h * 0.3, 0.05])
  for (let i = 0; i < 4; i++) put(r, rbox(w * (0.62 - (i % 2) * 0.15), 0.06, 0.02, 0.025), plastic(C.mist), [-w * 0.05, h * 0.08 - i * 0.16, 0.035])
  return r
}

function phoneScreen(kind) {
  return canvasTexture(256, 512, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, 512)
    grad.addColorStop(0, '#2F7BFF')
    grad.addColorStop(1, '#0A45F5')
    g.fillStyle = grad
    g.fillRect(0, 0, 256, 512)
    g.fillStyle = 'rgba(255,255,255,0.95)'
    g.beginPath()
    g.roundRect(28, 300, 200, 150, 26)
    g.fill()
    g.fillStyle = 'rgba(255,255,255,0.35)'
    for (let i = 0; i < 3; i++) {
      g.beginPath()
      g.roundRect(28, 70 + i * 52, 200 - i * 40, 26, 13)
      g.fill()
    }
    g.fillStyle = kind === 'offer' ? '#FF8A10' : '#1FBF6A'
    g.beginPath()
    g.roundRect(48, 390, 160, 40, 20)
    g.fill()
  })
}

function robotHead(g) {
  const shell = plastic(C.white, { roughness: 0.3 })
  put(g, rbox(1.2, 0.96, 0.9, 0.34), shell)
  put(g, rbox(0.98, 0.56, 0.1, 0.24), plastic('#0B1748', { roughness: 0.2 }), [0, 0.02, 0.43])
  for (const x of [-0.22, 0.22]) put(g, capsule(0.075, 0.08, 16), glow(C.aqua, 1.6), [x, 0.06, 0.49])
  put(g, torus(0.14, 0.03, Math.PI, 32), glow(C.aqua, 1.4), [0, -0.12, 0.49], [0, 0, Math.PI])
  for (const x of [-0.66, 0.66]) put(g, cyl(0.16, 0.16, 0.14, 32), plastic(C.cobalt), [x, 0, 0], [0, 0, Math.PI / 2])
  put(g, cyl(0.03, 0.03, 0.26, 12), metal(), [0, 0.6, 0])
  put(g, sphere(0.09, 24), plastic(C.orange, { emissive: '#FF8A10', emissiveIntensity: 0.3 }), [0, 0.76, 0])
}

function handFist(g, pos = [0, 0, 0], rot = [0, 0, 0], s = 1) {
  const h = group(g, pos, rot, s)
  const sk = plastic('#FFC9A3', { roughness: 0.5, clearcoat: 0.3 })
  put(h, rbox(0.62, 0.66, 0.5, 0.2), sk)
  for (let i = 0; i < 4; i++) put(h, capsule(0.1, 0.24, 16), sk, [0.3, 0.2 - i * 0.15, 0.06], [0, 0, Math.PI / 2])
  put(h, capsule(0.11, 0.38, 16), sk, [-0.1, 0.5, 0.06], [0, 0, 0.2])
  put(h, rbox(0.66, 0.24, 0.56, 0.08), plastic(C.cobalt), [-0.02, -0.42, 0])
  return h
}

// ---------- icons ----------

export const THING_ICONS = {
  house: { build: (g) => houseModel(g) },
  house_garden: { build: (g) => houseModel(g, { garden: true }) },
  pin: { build: (g) => pin(g), view: { pitch: 10 } },
  world_map: {
    build: (g) => {
      const colors = [C.aqua, C.mint, C.aqua, C.mint]
      colors.forEach((c, i) => put(g, rbox(0.42, 1.0, 0.05, 0.02), plastic(c, { roughness: 0.4 }), [-0.63 + i * 0.42, 0, i % 2 ? 0.08 : 0], [0, i % 2 ? -0.35 : 0.35, 0]))
      const road = plastic(C.white)
      put(g, rbox(1.6, 0.06, 0.06, 0.02), road, [0, -0.1, 0.12], [0, 0, 0.2])
      pin(g, [0.12, 0.42, 0.3], C.orange, 0.5)
    },
    view: { pitch: 30 },
  },
  finding: {
    build: (g) => {
      put(g, cyl(0.9, 0.9, 0.06, 64), plastic('#DDEBFF', { roughness: 0.5 }), [0, -0.4, 0])
      for (const r of [0.5, 0.75]) put(g, torus(r, 0.02, Math.PI * 2, 64), plastic(C.sky), [0, -0.36, 0], [Math.PI / 2, 0, 0])
      pin(g, [0, 0.12, 0], C.cobalt, 0.75)
      magnifier(g, [0.55, 0.0, 0.35], [0, 0, -0.7], 0.6)
    },
    view: { pitch: 26 },
  },
  magnifier: { build: (g) => magnifier(g) },
  no_results: { build: (g) => { magnifier(g); badge(g, 'cross', [0.42, -0.42, 0.25], 0.5) } },
  inspecting: {
    build: (g) => {
      put(g, cyl(0.12, 0.12, 1.5, 32), chrome({ roughness: 0.2 }), [0, -0.2, -0.1], [0, 0, Math.PI / 2])
      for (const x of [-0.45, 0.45]) put(g, cyl(0.17, 0.17, 0.14, 32), plastic(C.cobalt), [x, -0.2, -0.1], [0, 0, Math.PI / 2])
      magnifier(g, [0.05, 0.25, 0.3], [0, 0, -0.5], 0.72)
    },
  },
  hourglass: { build: (g) => hourglass(g) },
  alarm: {
    build: (g) => {
      put(g, cyl(0.6, 0.6, 0.34, 64), plastic(C.orange, { roughness: 0.25 }), [0, 0, 0], [Math.PI / 2, 0, 0])
      put(g, cyl(0.5, 0.5, 0.36, 64), plastic(C.white), [0, 0, 0.02], [Math.PI / 2, 0, 0])
      strokeWithCaps(g, [[0, 0.3], [0, 0], [0.22, -0.12]], 0.05, plastic(C.ink), 0.21)
      for (const s of [-1, 1]) {
        put(g, new THREE.SphereGeometry(0.22, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), plastic(C.amber), [s * 0.42, 0.56, 0], [0, 0, -s * 0.5])
        put(g, cyl(0.04, 0.04, 0.3, 12), plastic(C.ink), [s * 0.36, -0.6, 0], [0, 0, s * 0.5])
      }
    },
  },
  calendar: { build: (g) => calendarBox(g) },
  spiral_calendar: { build: (g) => calendarBox(g, [0, 0, 0], { clock: true }) },
  bell: { build: (g) => bell(g) },
  camera: {
    build: (g) => {
      put(g, rbox(1.4, 0.92, 0.5, 0.2), plastic(C.cobalt, { roughness: 0.28 }))
      put(g, rbox(0.42, 0.2, 0.4, 0.08), plastic(C.cobalt), [-0.3, 0.52, 0])
      put(g, cyl(0.36, 0.38, 0.22, 64), plastic(C.white), [0.06, -0.02, 0.3], [Math.PI / 2, 0, 0])
      put(g, cyl(0.26, 0.26, 0.24, 64), plastic('#0B1748', { roughness: 0.1 }), [0.06, -0.02, 0.33], [Math.PI / 2, 0, 0])
      put(g, sphere(0.08, 20), plastic(C.white, { emissive: '#FFFFFF', emissiveIntensity: 0.5 }), [-0.02, 0.07, 0.45], [0, 0, 0], [1, 1, 0.4])
      put(g, cyl(0.07, 0.07, 0.06, 24), plastic(C.orange), [0.5, 0.48, 0])
      put(g, rbox(0.2, 0.1, 0.05, 0.03), glow(C.aqua, 0.8), [-0.5, 0.3, 0.26])
    },
  },
  card: { build: (g) => bankCard(g, [0, 0, 0], [0, 0, 0.12]) },
  card_failed: { build: (g) => { bankCard(g, [0, 0, 0], [0, 0, 0.12], '#5A6A9A'); badge(g, 'cross', [0.62, -0.45, 0.12], 0.5) } },
  cash: {
    build: (g) => {
      for (let i = 0; i < 3; i++) {
        const n = group(g, [i * 0.06, i * 0.1, -i * 0.08], [0, 0, -0.18 + i * 0.12])
        put(n, rbox(1.4, 0.72, 0.04, 0.05), plastic('#3FC37C', { roughness: 0.45 }))
        put(n, cyl(0.2, 0.2, 0.05, 40), plastic('#E5FBEF'), [0, 0, 0.005], [Math.PI / 2, 0, 0])
        decal(n, labelTexture('₹', { fg: '#16884A', size: 0.6 }), 0.36, 0.36, [0, 0, 0.03])
      }
      put(g, rbox(0.3, 0.8, 0.06, 0.02), plastic(C.amber), [0.1, 0.1, 0.03], [0, 0, -0.06])
    },
  },
  money: {
    build: (g) => {
      put(g, rbox(1.4, 0.95, 0.42, 0.18), plastic(C.cobalt, { roughness: 0.3 }), [0, -0.1, 0])
      put(g, rbox(0.5, 0.36, 0.48, 0.12), plastic('#2F6BFF'), [0.5, -0.08, 0.01])
      put(g, sphere(0.06, 20), plastic(C.amber), [0.62, -0.08, 0.26])
      coin(g, [-0.3, 0.42, 0.1], [0.1, 0.3, 0])
      coin(g, [0.12, 0.5, -0.06], [0.2, -0.3, 0], 0.36)
    },
  },
  refund: {
    build: (g) => {
      coin(g, [0, 0, 0], [0, 0, 0], 0.55)
      const arc = new THREE.TorusGeometry(0.82, 0.08, 20, 64, Math.PI * 1.45)
      put(g, arc, plastic(C.cobalt), [0, 0, 0], [0, 0, 0.6])
      put(g, cone(0.18, 0.3, 32), plastic(C.cobalt), [0.62, -0.62, 0], [0, 0, -0.6])
    },
  },
  earnings: {
    build: (g) => {
      ;[0.45, 0.75, 1.1].forEach((h, i) => put(g, rbox(0.34, h, 0.34, 0.06), plastic(i === 2 ? C.cobalt : '#5A8BFF'), [-0.5 + i * 0.46, -0.5 + h / 2, 0]))
      strokeWithCaps(g, [[-0.62, 0.05], [-0.1, 0.32], [0.18, 0.2], [0.62, 0.72]], 0.055, plastic(C.orange), 0.3)
      put(g, cone(0.13, 0.24, 24), plastic(C.orange), [0.66, 0.78, 0.3], [0, 0, -0.8])
      coin(g, [-0.55, 0.62, 0.15], [0.15, 0.4, 0], 0.32)
    },
  },
  pay_due: { build: (g) => { receipt(g, [0, 0, 0], [0, 0.15, 0.06]); badge(g, 'clock', [0.45, -0.52, 0.2], 0.5) } },
  pay_pending: { build: (g) => { coin(g, [-0.15, 0.05, 0], [0, 0.3, 0], 0.55); hourglass(g, [0.5, -0.12, 0.3], 0.5) } },
  pay_success: {
    build: (g) => {
      phone(g, [0, 0, 0], [0, -0.2, 0.06], { screen: phoneScreen('success') })
      badge(g, 'check', [0.42, -0.5, 0.25], 0.55)
      coin(g, [-0.55, 0.45, 0.1], [0.1, 0.4, 0.2], 0.3)
    },
  },
  receipt: { build: (g) => receipt(g, [0, 0, 0], [0, 0.15, 0.06]) },
  clipboard: {
    build: (g) => {
      put(g, rbox(1.2, 1.55, 0.1, 0.12), plastic(C.cobalt, { roughness: 0.3 }))
      paper(g, [0, -0.06, 0.07], [0, 0, 0], { w: 0.98, h: 1.3 })
      put(g, rbox(0.5, 0.18, 0.12, 0.06), metal('#C9D1E0'), [0, 0.74, 0.08])
      badge(g, 'rupee', [0.45, -0.55, 0.2], 0.42)
    },
  },
  memo: {
    build: (g) => {
      paper(g, [0, 0, 0], [0, 0.15, 0.04], { accent: C.orange })
      const pencil = group(g, [0.42, -0.1, 0.2], [0, 0, -0.75])
      put(pencil, cyl(0.07, 0.07, 0.9, 6), plastic(C.amber), [0, 0, 0])
      put(pencil, cone(0.07, 0.18, 6), plastic('#F3D7B0'), [0, -0.54, 0], [Math.PI, 0, 0])
      put(pencil, cyl(0.072, 0.072, 0.1, 16), plastic(C.pink), [0, 0.5, 0])
    },
  },
  package: {
    build: (g) => {
      put(g, rbox(1.2, 0.9, 1.0, 0.06), matte('#D9A774', { roughness: 0.7 }))
      put(g, rbox(0.24, 0.92, 1.02, 0.02), matte('#C48A52'), [0, 0, 0])
      put(g, rbox(0.5, 0.3, 0.02, 0.03), plastic(C.white), [0.3, -0.18, 0.51])
      logo(g, [0.3, -0.18, 0.53], 0.1)
    },
  },
  party: {
    build: (g) => {
      const c = group(g, [-0.25, -0.25, 0], [0, 0, -0.65])
      put(c, cone(0.36, 1.1, 48), plastic(C.cobalt, { roughness: 0.25 }), [0, 0, 0], [Math.PI, 0, 0])
      for (const y of [-0.15, 0.15]) put(c, torus(0.25 + y * 0.35, 0.03, Math.PI * 2, 48), plastic(C.amber), [0, y, 0], [Math.PI / 2, 0, 0])
      const bits = [[0.3, 0.55, C.orange], [0.62, 0.3, C.aqua], [0.5, 0.72, C.amber], [0.1, 0.78, C.pink], [0.72, 0.6, C.cobalt]]
      bits.forEach(([x, y, col], i) => put(g, i % 2 ? sphere(0.07, 20) : rbox(0.14, 0.07, 0.04, 0.02), plastic(col), [x, y, 0.1], [0, 0, i]))
      strokeWithCaps(g, [[0.15, 0.25], [0.35, 0.45], [0.3, 0.6]], 0.03, plastic(C.orange), 0.05)
    },
  },
  rocket: {
    build: (g) => {
      const r = group(g, [0, 0, 0], [0, 0, -0.7])
      const body = [[0.001, 0.8], [0.12, 0.7], [0.24, 0.45], [0.28, 0.1], [0.26, -0.3], [0.2, -0.45], [0.001, -0.45]].map(([x, y]) => new THREE.Vector2(x, y))
      put(r, new THREE.LatheGeometry(body, 64), plastic(C.white, { roughness: 0.25 }))
      put(r, cyl(0.1, 0.1, 0.06, 32), plastic(C.aqua, { emissive: '#48D9F5', emissiveIntensity: 0.3 }), [0, 0.2, 0.25], [Math.PI / 2, 0, 0])
      put(r, torus(0.1, 0.03, Math.PI * 2, 32), plastic(C.cobalt), [0, 0.2, 0.27])
      for (let i = 0; i < 3; i++) {
        const f = group(r, [0, -0.3, 0], [0, (i / 3) * Math.PI * 2, 0])
        put(f, extrude(poly([[0, 0], [0.32, -0.22], [0.3, 0.12], [0, 0.32]]), 0.05, 0.02), plastic(C.cobalt), [0.2, 0, 0])
      }
      put(r, cone(0.16, 0.36, 32), plastic(C.orange, { emissive: '#FF8A10', emissiveIntensity: 0.7 }), [0, -0.62, 0], [Math.PI, 0, 0])
      put(r, cone(0.09, 0.26, 32), glow(C.yellow, 1.2), [0, -0.66, 0], [Math.PI, 0, 0])
    },
  },
  scooter: {
    build: (g) => {
      const body = plastic(C.cobalt, { roughness: 0.25 })
      for (const x of [-0.55, 0.55]) {
        put(g, torus(0.22, 0.09, Math.PI * 2, 48), matte(C.ink, { roughness: 0.8 }), [x, -0.42, 0])
        put(g, cyl(0.12, 0.12, 0.1, 32), metal(), [x, -0.42, 0], [Math.PI / 2, 0, 0])
      }
      put(g, rbox(1.1, 0.12, 0.34, 0.06), body, [0, -0.28, 0])
      put(g, rbox(0.62, 0.36, 0.42, 0.16), body, [-0.42, -0.12, 0])
      put(g, rbox(0.5, 0.12, 0.34, 0.06), matte(C.ink), [-0.4, 0.1, 0])
      put(g, rbox(0.14, 0.7, 0.3, 0.06), body, [0.5, 0.0, 0], [0, 0, -0.25])
      put(g, cyl(0.03, 0.03, 0.6, 12), metal(), [0.6, 0.36, 0], [Math.PI / 2, 0, 0])
      put(g, sphere(0.08, 20), glow(C.amber, 1.2), [0.66, 0.16, 0], [0, 0, 0], [0.6, 1, 1])
      const box = group(g, [-0.6, 0.38, 0])
      put(box, rbox(0.46, 0.4, 0.42, 0.06), plastic(C.white))
      logo(box, [0, 0.0, 0.22], 0.13)
    },
    view: { yaw: 30 },
  },
  key: {
    build: (g) => {
      const k = group(g, [0, 0, 0], [0, 0, 0.6])
      put(k, torus(0.3, 0.12, Math.PI * 2, 64), plastic(C.amber, { roughness: 0.22, metalness: 0.2 }), [0, 0.5, 0])
      put(k, rbox(0.16, 1.0, 0.12, 0.04), plastic(C.amber, { roughness: 0.22, metalness: 0.2 }), [0, -0.2, 0])
      for (const [y, w] of [[-0.45, 0.24], [-0.62, 0.18]]) put(k, rbox(w, 0.1, 0.12, 0.03), plastic(C.amber, { roughness: 0.22, metalness: 0.2 }), [0.12 + w / 2 - 0.08, y, 0])
      put(k, cyl(0.1, 0.1, 0.16, 32), plastic(C.cobalt), [0, 0.5, 0], [Math.PI / 2, 0, 0])
    },
  },
  shield: { build: (g) => { shield(g); badge(g, 'check', [0, 0.02, 0.16], 0.62) } },
  sos: {
    build: (g) => {
      put(g, cyl(0.62, 0.66, 0.18, 64), plastic(C.ink), [0, -0.5, 0])
      const dome = new THREE.SphereGeometry(0.52, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2)
      put(g, dome, tinted(C.red, 0.85, { emissive: '#F0474D', emissiveIntensity: 0.55 }), [0, -0.42, 0], [0, 0, 0], [1, 1.4, 1])
      put(g, sphere(0.2, 32), glow('#FFD1D1', 1.2), [0, -0.1, 0])
      for (const a of [-0.9, -0.45, 0.45, 0.9]) put(g, capsule(0.04, 0.18, 12), glow(C.red, 1), [Math.sin(a) * 0.86, 0.1 + Math.cos(a) * 0.5, 0], [0, 0, -a])
    },
  },
  sparkles: {
    build: (g) => {
      const s4 = (pos, sc, color) => {
        const pts = []
        for (let i = 0; i < 8; i++) {
          const r = i % 2 ? 0.16 : 0.62
          const a = Math.PI / 2 + (i / 8) * Math.PI * 2
          pts.push([Math.cos(a) * r, Math.sin(a) * r])
        }
        put(g, extrude(poly(pts), 0.16, 0.05), plastic(color, { roughness: 0.2 }), pos, [0, 0, 0], sc)
      }
      s4([0, 0, 0], 1, C.amber)
      s4([0.62, 0.55, 0.1], 0.45, C.cobalt)
      s4([-0.55, -0.5, 0.1], 0.36, C.aqua)
    },
  },
  star: { build: (g) => star(g) },
  trophy: {
    build: (g) => {
      const gold = plastic(C.gold, { roughness: 0.2, metalness: 0.35 })
      const cup = [[0.001, -0.05], [0.18, -0.08], [0.4, 0.1], [0.46, 0.5], [0.48, 0.62], [0.001, 0.62]].map(([x, y]) => new THREE.Vector2(x, y))
      put(g, new THREE.LatheGeometry(cup, 64), gold)
      for (const s of [-1, 1]) put(g, torus(0.18, 0.05, Math.PI * 1.2, 32), gold, [s * 0.5, 0.36, 0], [0, 0, s > 0 ? -Math.PI / 2 : Math.PI * 1.5])
      put(g, cyl(0.08, 0.1, 0.3, 32), gold, [0, -0.22, 0])
      put(g, rbox(0.6, 0.18, 0.4, 0.06), plastic(C.cobalt), [0, -0.44, 0])
      star(g, [0, 0.3, 0.42], 0.22, C.white, 0.12)
    },
  },
  thumbs_up: { build: (g) => handFist(g, [0, 0, 0], [0, -0.3, 0]) },
  globe: {
    build: (g) => {
      // Continents painted on the sphere (an equirectangular canvas), so they sit flush with the ocean.
      const earth = canvasTexture(1024, 512, (c) => {
        c.fillStyle = '#2FB8E8'
        c.fillRect(0, 0, 1024, 512)
        c.fillStyle = '#3BBF7A'
        for (const [x, y, rx, ry, rot] of [[300, 170, 120, 80, 0.3], [380, 330, 70, 110, -0.2], [560, 150, 150, 70, 0.1], [610, 300, 80, 90, 0.4], [820, 210, 110, 70, -0.3], [860, 370, 60, 40, 0], [120, 260, 60, 90, 0.2]]) {
          c.beginPath()
          c.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2)
          c.fill()
        }
      })
      put(g, sphere(0.62, 64), new THREE.MeshPhysicalMaterial({ map: earth, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.2 }), [0, 0, 0], [0.3, -1.2, 0])
      const bubble = group(g, [0.58, 0.55, 0.3])
      put(bubble, rbox(0.62, 0.46, 0.14, 0.14), plastic(C.cobalt))
      decal(bubble, labelTexture('అ', { fg: '#FFFFFF', size: 0.7 }), 0.4, 0.4, [0, 0, 0.08])
      const b2 = group(g, [-0.6, 0.62, 0.25])
      put(b2, rbox(0.5, 0.4, 0.12, 0.12), plastic(C.orange))
      decal(b2, labelTexture('A', { fg: '#FFFFFF', size: 0.7 }), 0.34, 0.34, [0, 0, 0.07])
    },
  },
  mic: {
    build: (g) => {
      put(g, capsule(0.3, 0.5, 48), plastic(C.cobalt, { roughness: 0.25 }), [0, 0.3, 0])
      for (let i = 0; i < 3; i++) put(g, torus(0.305, 0.02, Math.PI * 2, 48), plastic('#2F6BFF'), [0, 0.42 + i * 0.12, 0], [Math.PI / 2, 0, 0])
      put(g, torus(0.42, 0.05, Math.PI, 48), metal(), [0, 0.18, 0], [0, 0, Math.PI])
      put(g, cyl(0.05, 0.05, 0.3, 16), metal(), [0, -0.38, 0])
      put(g, cyl(0.3, 0.34, 0.08, 40), plastic(C.white), [0, -0.56, 0])
      for (const s of [-1, 1]) put(g, torus(0.62, 0.035, Math.PI / 3, 32), plastic(C.orange), [0, 0.3, 0], [0, 0, s > 0 ? -Math.PI / 6 : Math.PI - Math.PI / 6])
    },
  },
  moon: {
    build: (g) => {
      // Crescent: the part of a circle outside a second, offset circle.
      const R = 0.62
      const inner = { x: 0.3, y: 0.24, r: 0.52 }
      const inside = (x, y) => (x - inner.x) ** 2 + (y - inner.y) ** 2 < inner.r ** 2
      const pts = []
      for (let i = 0; i <= 240; i++) {
        const a = (i / 240) * Math.PI * 2 + Math.atan2(inner.y, inner.x) + 0.0001
        const x = Math.cos(a) * R
        const y = Math.sin(a) * R
        if (!inside(x, y)) pts.push([x, y])
      }
      for (let i = 240; i >= 0; i--) {
        const a = (i / 240) * Math.PI * 2
        const x = inner.x + Math.cos(a) * inner.r
        const y = inner.y + Math.sin(a) * inner.r
        if (x * x + y * y < R * R) pts.push([x, y])
      }
      // Order the inner-arc points so they run from the end of the outer arc back to its start.
      const outerCount = pts.findIndex((p, i) => i > 0 && Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.1)
      const outer = outerCount > 0 ? pts.slice(0, outerCount) : pts
      const arc = outerCount > 0 ? pts.slice(outerCount) : []
      const end = outer[outer.length - 1]
      if (arc.length && Math.hypot(arc[0][0] - end[0], arc[0][1] - end[1]) > Math.hypot(arc[arc.length - 1][0] - end[0], arc[arc.length - 1][1] - end[1])) arc.reverse()
      put(g, extrude(poly([...outer, ...arc]), 0.3, 0.1), plastic('#FFD95A', { roughness: 0.3, emissive: '#FFC83A', emissiveIntensity: 0.15 }), [0, 0, 0], [0, 0, -0.35])
      star(g, [0.42, 0.52, 0], 0.22, C.cobalt, 0.12)
      star(g, [0.62, -0.02, 0], 0.13, C.aqua, 0.1)
    },
    view: { yaw: 14, pitch: 8 },
  },
  sun: {
    build: (g) => {
      put(g, sphere(0.42, 64), plastic(C.yellow, { emissive: '#FFC83A', emissiveIntensity: 0.25 }))
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2
        put(g, capsule(0.07, 0.18, 16), plastic(C.orange), [Math.cos(a) * 0.66, Math.sin(a) * 0.66, 0], [0, 0, a - Math.PI / 2])
      }
    },
    view: { pitch: 6 },
  },
  sun_cloud: {
    build: (g) => {
      put(g, sphere(0.36, 48), plastic(C.yellow, { emissive: '#FFC83A', emissiveIntensity: 0.25 }), [0.32, 0.3, -0.2])
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3
        put(g, capsule(0.055, 0.12, 12), plastic(C.orange), [0.32 + Math.cos(a) * 0.54, 0.3 + Math.sin(a) * 0.54, -0.2], [0, 0, a - Math.PI / 2])
      }
      const cloud = plastic(C.white, { roughness: 0.35 })
      for (const [x, y, r] of [[-0.3, -0.12, 0.32], [0.05, -0.02, 0.4], [0.38, -0.16, 0.28], [-0.55, -0.22, 0.22]]) put(g, sphere(r, 40), cloud, [x, y, 0.15])
      put(g, capsule(0.24, 0.9, 32), cloud, [-0.05, -0.24, 0.15], [0, 0, Math.PI / 2])
    },
    view: { pitch: 6 },
  },
  plug: {
    build: (g) => {
      put(g, rbox(0.62, 0.7, 0.5, 0.18), plastic(C.white, { roughness: 0.32 }))
      for (const x of [-0.14, 0.14]) put(g, cyl(0.045, 0.045, 0.36, 16), chrome(), [x, 0.5, 0])
      const cable = new THREE.CatmullRomCurve3([[0, -0.35, 0], [0, -0.6, 0.1], [0.4, -0.75, 0.2], [0.75, -0.6, 0]].map((p) => new THREE.Vector3(...p)))
      put(g, new THREE.TubeGeometry(cable, 60, 0.07, 16, false), plastic(C.cobalt))
      put(g, extrude(poly([[0.04, 0.24], [-0.1, 0], [0, 0], [-0.06, -0.22], [0.12, 0.05], [0.02, 0.05], [0.08, 0.24]]), 0.06, 0.02), plastic(C.amber), [0, 0, 0.27])
    },
  },
  start_code: {
    build: (g) => {
      put(g, rbox(1.5, 0.62, 0.14, 0.14), plastic(C.cobalt, { roughness: 0.28 }))
      ;['7', '8', '0', '9'].forEach((d, i) => {
        put(g, rbox(0.3, 0.42, 0.08, 0.07), plastic(C.white), [-0.51 + i * 0.34, 0, 0.09])
        decal(g, labelTexture(d, { fg: '#0A45F5', size: 0.72 }), 0.3, 0.3, [-0.51 + i * 0.34, 0, 0.135])
      })
      badge(g, 'check', [0.62, -0.38, 0.2], 0.45)
    },
    view: { yaw: 14 },
  },
  job_offer: {
    build: (g) => {
      phone(g, [0, 0, 0], [0, -0.2, 0.06], { screen: phoneScreen('offer') })
      bell(g, [0.5, 0.5, 0.25], 0.42)
    },
  },
  robot: { build: (g) => robotHead(g) },
  call: {
    build: (g) => {
      const handset = group(g, [0, 0, 0], [0, 0, 0.75])
      const curve = new THREE.CatmullRomCurve3([[-0.5, 0.2, 0], [-0.25, -0.05, 0], [0.25, -0.05, 0], [0.5, 0.2, 0]].map((p) => new THREE.Vector3(...p)))
      put(handset, new THREE.TubeGeometry(curve, 40, 0.13, 24, false), plastic(C.green, { roughness: 0.25 }))
      for (const x of [-0.5, 0.5]) put(handset, capsule(0.17, 0.14, 24), plastic(C.green), [x, 0.22, 0], [0, 0, Math.PI / 2])
      for (const r of [0.3, 0.48]) put(g, torus(r, 0.04, Math.PI / 2, 32), plastic(C.cobalt), [0.25, 0.25, 0], [0, 0, 0])
    },
  },
  check: { build: (g) => badge(g, 'check', [0, 0, 0], 1.3), view: { yaw: 18, pitch: 8 } },
  handshake: {
    build: (g) => {
      put(g, rbox(1.0, 1.6, 0.12, 0.06), plastic(C.cobalt, { roughness: 0.3 }))
      put(g, rbox(1.2, 0.1, 0.3, 0.03), plastic(C.white), [0, 0.85, 0])
      put(g, sphere(0.05, 16), plastic(C.amber), [0.32, -0.05, 0.1])
      logo(g, [0, 0.45, 0.08], 0.14)
      put(g, rbox(1.3, 0.06, 0.5, 0.03), matte('#E7C9A4'), [0, -0.84, 0.25])
      bell(g, [0.62, 0.35, 0.2], 0.32)
      for (const r of [0.22, 0.34]) put(g, torus(r, 0.025, Math.PI / 2.2, 32), plastic(C.orange), [0.62, 0.42, 0.2], [0, 0, 0.6])
      badge(g, 'check', [0.5, -0.45, 0.25], 0.42)
    },
  },
  toolbox: {
    build: (g) => {
      const shell = plastic(C.cobalt, { roughness: 0.26 })
      put(g, rbox(1.6, 0.68, 0.82, 0.12), shell, [0, -0.1, 0])
      put(g, rbox(1.64, 0.07, 0.86, 0.03), plastic(C.deep), [0, 0.22, 0])
      put(g, rbox(1.6, 0.24, 0.82, 0.1), shell, [0, 0.36, 0])
      put(g, torus(0.3, 0.055, Math.PI, 48), plastic(C.orange), [0, 0.48, 0])
      for (const x of [-0.52, 0.52]) put(g, rbox(0.16, 0.2, 0.06, 0.025), plastic(C.amber), [x, 0.2, 0.43])
      logo(g, [0, -0.1, 0.44], 0.17)
    },
  },
  tools: {
    build: (g) => {
      const w = group(g, [0, 0, 0], [0, 0, 0.7])
      put(w, rbox(0.16, 1.2, 0.1, 0.05), metal('#C9D1E0'), [0, -0.1, 0])
      const jaw = new THREE.Shape()
      jaw.absarc(0, 0, 0.26, 0, Math.PI * 2, false)
      const cut = new THREE.Path()
      cut.moveTo(-0.09, 0.3)
      cut.lineTo(-0.09, 0.02)
      cut.lineTo(0.09, 0.02)
      cut.lineTo(0.09, 0.3)
      cut.closePath()
      jaw.holes.push(cut)
      put(w, extrude(jaw, 0.1, 0.02), metal('#C9D1E0'), [0, 0.56, 0])
      put(w, rbox(0.2, 0.5, 0.12, 0.06), plastic(C.cobalt), [0, -0.5, 0.01])
      const s = group(g, [0, 0, 0.12], [0, 0, -0.7])
      put(s, capsule(0.12, 0.38, 24), plastic(C.orange), [0, -0.42, 0])
      put(s, cyl(0.035, 0.035, 0.7, 16), chrome(), [0, 0.18, 0])
      put(s, rbox(0.1, 0.12, 0.03, 0.01), chrome(), [0, 0.56, 0])
    },
  },
  toilet: {
    build: (g) => {
      put(g, rbox(0.62, 0.62, 0.22, 0.1), plastic(C.white, { roughness: 0.3 }), [0, 0.3, -0.32])
      const bowl = [[0, -0.42], [0.22, -0.42], [0.25, -0.2], [0.42, -0.05], [0.44, 0.02], [0, 0.02]].map(([x, y]) => new THREE.Vector2(x, y))
      put(g, new THREE.LatheGeometry(bowl, 64), plastic(C.white, { roughness: 0.3 }), [0, 0, 0.02], [0, 0, 0], [0.95, 1, 1.15])
      put(g, cyl(0.42, 0.42, 0.06, 64), plastic(C.cobalt), [0, 0.06, 0.02], [0, 0, 0], [0.95, 1, 1.15])
    },
  },
}

export { houseModel, pin, magnifier, calendarBox, hourglass, bell, shield, star, receipt }
