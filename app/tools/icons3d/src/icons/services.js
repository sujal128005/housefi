// Service categories and individual services. The six category objects are the same models as the Housefi
// website's 3D story (tap, bulb and switch, AC, washer, spray and sponge, saw and hammer), so app and site match.
import {
  C, THREE, badge, bubbleMat, capsule, chrome, cone, cyl, extrude, glow, group, matte, metal, plastic, poly, put, rbox, sphere, tinted, torus, woodTexture,
} from '../kit.js'

// ---------- shared parts ----------

function faucet(g, { flow = 1 } = {}) {
  const steel = chrome()
  put(g, cyl(0.2, 0.24, 0.08), steel, [0, -0.46, 0])
  put(g, cyl(0.09, 0.11, 0.5, 32), steel, [0, -0.18, 0])
  const spout = new THREE.CatmullRomCurve3([[0, 0.02, 0], [0, 0.3, 0.02], [0.12, 0.42, 0.04], [0.36, 0.36, 0.05], [0.46, 0.18, 0.05]].map((p) => new THREE.Vector3(...p)))
  put(g, new THREE.TubeGeometry(spout, 48, 0.06, 20, false), steel)
  put(g, cyl(0.065, 0.065, 0.06, 24), steel, [0.46, 0.16, 0.05])
  put(g, sphere(0.06, 24), steel, [0, 0.02, 0])
  put(g, rbox(0.44, 0.08, 0.12, 0.035), plastic(C.cobalt), [-0.18, 0.12, 0], [0, 0, 0.55])
  put(g, cyl(0.1, 0.1, 0.1, 28), steel, [0, 0.06, 0])
  if (flow > 0) {
    const water = tinted(C.aqua, 0.82, { emissive: '#48D9F5', emissiveIntensity: 0.3 })
    put(g, cyl(0.038, 0.05, 0.42 * flow, 24), water, [0.46, 0.13 - 0.21 * flow, 0.05])
    put(g, sphere(0.06, 20), water, [0.46, -0.18 * flow - 0.02, 0.05], [0, 0, 0], [1, 1.3, 1])
  }
}

function basin(g, pos = [0, -0.62, 0.05]) {
  const profile = [[0, -0.18], [0.38, -0.18], [0.6, 0.0], [0.66, 0.08], [0.62, 0.1], [0.5, -0.02], [0, -0.06]].map(([x, y]) => new THREE.Vector2(x, y))
  put(g, new THREE.LatheGeometry(profile, 64), plastic(C.white, { roughness: 0.3, side: THREE.DoubleSide }), pos, [0, 0, 0], [1, 1, 0.7])
}

function bulb(g, { on = 1 } = {}) {
  const profile = [[0, 0.62], [0.12, 0.6], [0.22, 0.54], [0.28, 0.44], [0.29, 0.34], [0.25, 0.22], [0.17, 0.1], [0.13, 0], [0.12, -0.04]].map(([x, y]) => new THREE.Vector2(x, y))
  put(g, new THREE.LatheGeometry(profile, 48), new THREE.MeshPhysicalMaterial({ color: '#FFF4D6', transmission: 0.6, roughness: 0.15, thickness: 0.05, ior: 1.4, emissive: '#FFC857', emissiveIntensity: 0.55 * on, clearcoat: 1 }))
  put(g, sphere(0.17, 32), glow('#FFD777', 0.9 * on), [0, 0.36, 0])
  put(g, new THREE.TorusKnotGeometry(0.06, 0.012, 64, 8, 2, 5), glow('#FFB13D', 3 * on), [0, 0.34, 0])
  const screw = []
  for (let i = 0; i <= 12; i++) screw.push(new THREE.Vector2(0.13 + (i % 2 ? 0.016 : 0), -0.04 - i * 0.02))
  screw.push(new THREE.Vector2(0.06, -0.3), new THREE.Vector2(0, -0.31))
  put(g, new THREE.LatheGeometry(screw, 40), chrome({ color: '#D9DEE8', roughness: 0.22 }))
}

function wallSwitch(g, pos, { on = true } = {}) {
  const s = group(g, pos)
  put(s, rbox(0.4, 0.56, 0.08, 0.07), plastic(C.white, { roughness: 0.4 }))
  put(s, rbox(0.16, 0.26, 0.08, 0.04), plastic(C.cobalt), [0, 0, 0.05], [on ? -0.28 : 0.28, 0, 0])
  return s
}

function airConditioner(g, { air = true } = {}) {
  put(g, rbox(1.2, 0.38, 0.32, 0.12), plastic(C.white, { roughness: 0.32 }), [0, 0.22, 0])
  put(g, rbox(1.02, 0.07, 0.05, 0.02), matte('#C9D2E6'), [0, 0.09, 0.15])
  put(g, rbox(1.0, 0.035, 0.09, 0.014), plastic('#E8EEFA'), [0, 0.05, 0.17], [0.55, 0, 0])
  put(g, sphere(0.022, 12), glow(C.aqua, 1.4), [0.46, 0.28, 0.16])
  put(g, rbox(0.3, 0.035, 0.02, 0.012), plastic(C.cobalt), [-0.34, 0.3, 0.16])
  if (air) {
    const ribbon = tinted(C.aqua, 0.75, { emissive: '#48D9F5', emissiveIntensity: 0.35, side: THREE.DoubleSide })
    ;[-0.3, 0, 0.3].forEach((x) => {
      const curve = new THREE.CatmullRomCurve3([[x, 0.04, 0.2], [x + 0.05, -0.1, 0.36], [x - 0.05, -0.24, 0.46], [x + 0.03, -0.36, 0.52]].map((p) => new THREE.Vector3(...p)))
      put(g, new THREE.TubeGeometry(curve, 40, 0.032, 12, false), ribbon, [0, 0, 0], [0, 0, 0], [1.3, 1, 1])
    })
    for (const [x, y, z] of [[-0.42, -0.3, 0.5], [0.42, -0.26, 0.46]]) put(g, new THREE.OctahedronGeometry(0.06, 0), plastic(C.white, { emissive: '#BDEFFF', emissiveIntensity: 0.4 }), [x, y, z], [0.4, 0.4, 0])
  }
}

function washer(g) {
  put(g, rbox(0.86, 0.98, 0.8, 0.12), plastic(C.white, { roughness: 0.32 }))
  put(g, rbox(0.76, 0.15, 0.04, 0.03), plastic('#EEF2FB'), [0, 0.36, 0.4])
  put(g, cyl(0.055, 0.055, 0.05, 24), plastic(C.cobalt), [0.26, 0.36, 0.43], [Math.PI / 2, 0, 0])
  put(g, rbox(0.18, 0.05, 0.02, 0.02), glow(C.aqua, 0.8), [-0.16, 0.36, 0.425])
  put(g, torus(0.28, 0.06, Math.PI * 2, 64), plastic(C.cobalt, { roughness: 0.22 }), [0, -0.06, 0.4])
  put(g, new THREE.CircleGeometry(0.26, 48), matte('#1B2B6B'), [0, -0.06, 0.32])
  const drum = group(g, [0, -0.06, 0.34], [0, 0, 0.6])
  ;[C.orange, C.aqua, C.amber, C.white].forEach((c, i) => {
    const a = (i / 4) * Math.PI * 2
    put(drum, sphere(0.085, 20), plastic(c, { roughness: 0.6, clearcoat: 0.2 }), [Math.cos(a) * 0.13, Math.sin(a) * 0.13, 0], [0, 0, a], [1.3, 0.8, 0.6])
  })
  put(g, new THREE.SphereGeometry(0.27, 40, 20, 0, Math.PI * 2, 0, Math.PI / 4), tinted('#DDF5FF', 0.32), [0, -0.06, 0.25], [Math.PI / 2, 0, 0])
}

function sprayBottle(g, pos = [-0.18, 0, 0]) {
  const s = group(g, pos)
  const profile = [[0, -0.5], [0.17, -0.5], [0.2, -0.46], [0.2, 0.06], [0.16, 0.14], [0.08, 0.2], [0.075, 0.26], [0, 0.26]].map(([x, y]) => new THREE.Vector2(x, y))
  put(s, new THREE.LatheGeometry(profile, 48), plastic(C.orange, { roughness: 0.22 }))
  put(s, new THREE.CylinderGeometry(0.205, 0.205, 0.22, 48, 1, true, -Math.PI / 2.2, Math.PI / 1.1), plastic(C.white, { roughness: 0.5 }), [0, -0.2, 0])
  put(s, rbox(0.2, 0.14, 0.34, 0.05), plastic(C.cobalt), [0, 0.32, 0.06])
  put(s, cyl(0.03, 0.04, 0.08, 16), plastic(C.cobalt), [0, 0.32, 0.26], [Math.PI / 2, 0, 0])
  put(s, rbox(0.06, 0.2, 0.06, 0.025), plastic(C.cobalt), [0, 0.18, 0.2], [0.35, 0, 0])
  return s
}

function sponge(g, pos = [0.3, -0.42, 0.05], rotY = -0.4) {
  put(g, rbox(0.44, 0.18, 0.3, 0.06), matte(C.amber, { roughness: 0.95 }), pos, [0, rotY, 0])
  put(g, rbox(0.44, 0.06, 0.3, 0.03), matte(C.leaf, { roughness: 0.9 }), [pos[0], pos[1] + 0.12, pos[2]], [0, rotY, 0])
}

function bubbles(g, list) {
  const film = bubbleMat()
  for (const [x, y, z, r] of list) put(g, sphere(r, 32), film, [x, y, z])
}

function saw(g, pos = [-0.22, -0.12, 0.08], rotZ = 0.25) {
  const s = group(g, pos, [0, 0, rotZ])
  const blade = new THREE.Shape()
  blade.moveTo(0, 0)
  for (let i = 0; i <= 16; i++) blade.lineTo((i / 16) * 0.8, -0.025 * (1 - i / 16) - (i % 2 ? 0.04 : 0))
  blade.lineTo(0.82, 0)
  blade.lineTo(0.78, 0.13)
  blade.lineTo(0, 0.21)
  blade.closePath()
  put(s, new THREE.ExtrudeGeometry(blade, { depth: 0.016, bevelEnabled: false }), chrome({ roughness: 0.18 }))
  const h = new THREE.Shape()
  h.moveTo(0, -0.02)
  h.lineTo(-0.25, -0.07)
  h.quadraticCurveTo(-0.36, 0.1, -0.25, 0.3)
  h.lineTo(0.05, 0.25)
  h.closePath()
  const hole = new THREE.Path()
  hole.moveTo(-0.08, 0.05)
  hole.lineTo(-0.2, 0.03)
  hole.quadraticCurveTo(-0.27, 0.11, -0.2, 0.19)
  hole.lineTo(-0.06, 0.17)
  hole.closePath()
  h.holes.push(hole)
  put(s, new THREE.ExtrudeGeometry(h, { depth: 0.08, bevelEnabled: true, bevelSize: 0.016, bevelThickness: 0.016, bevelSegments: 2 }), plastic(C.cobalt), [0, 0, -0.035])
  put(s, rbox(0.06, 0.17, 0.1, 0.02), plastic(C.orange), [-0.27, 0.11, 0.008], [0, 0, -0.4])
  return s
}

function hammer(g, pos = [0.36, 0.08, -0.08], rotZ = -0.5) {
  const h = group(g, pos, [0, 0, rotZ])
  put(h, cyl(0.04, 0.045, 0.64, 16), new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.6 }))
  put(h, rbox(0.32, 0.1, 0.1, 0.03), metal('#B9C2D3'), [0, 0.31, 0])
  put(h, rbox(0.08, 0.12, 0.11, 0.02), plastic(C.orange), [0, -0.22, 0])
  return h
}

function plank(g, pos = [0, -0.42, 0], rotY = 0.2, size = [1.0, 0.12, 0.36]) {
  put(g, rbox(...size, 0.03), new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.7 }), pos, [0, rotY, 0])
}

function pipe(g, points, r = 0.09, mat = chrome({ roughness: 0.2 })) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, 'catmullrom', 0.1)
  put(g, new THREE.TubeGeometry(curve, 80, r, 24, false), mat)
  for (const p of [points[0], points[points.length - 1]]) put(g, cyl(r * 1.35, r * 1.35, r * 0.9, 28), chrome({ roughness: 0.25 }), p, [0, 0, Math.PI / 2])
}

function droplet(g, pos, s = 1) {
  const d = group(g, pos, [0, 0, 0], s)
  put(d, sphere(0.1, 28), tinted(C.aqua, 0.9, { emissive: '#48D9F5', emissiveIntensity: 0.35 }), [0, 0, 0], [0, 0, 0], [1, 1, 1])
  put(d, cone(0.085, 0.16, 28), tinted(C.aqua, 0.9, { emissive: '#48D9F5', emissiveIntensity: 0.35 }), [0, 0.12, 0])
}

// ---------- categories ----------

export const SERVICE_ICONS = {
  // Plumbing
  tap: { build: (g) => { faucet(g); basin(g, [0.2, -0.6, 0.05]) } },
  // Electrical
  bulb: { build: (g) => { bulb(g); wallSwitch(g, [0.46, -0.12, -0.08]) } },
  // AC repair
  snowflake: { build: (g) => airConditioner(g), view: { pitch: 10 } },
  // Appliances
  tv: { build: (g) => washer(g) },
  // Cleaning
  sponge: { build: (g) => { sprayBottle(g); sponge(g); bubbles(g, [[0.32, 0.12, 0.1, 0.11], [0.5, 0.36, -0.05, 0.08], [0.18, 0.42, 0.12, 0.06]]) } },
  // Carpentry
  saw: { build: (g) => { plank(g); saw(g); hammer(g) } },

  // ---------- individual services ----------
  svc_tap: { build: (g) => { faucet(g); basin(g, [0.2, -0.6, 0.05]) } },
  svc_leak: {
    build: (g) => {
      pipe(g, [[-0.8, 0.2, 0], [-0.2, 0.2, 0], [0.1, 0.2, 0], [0.3, 0.05, 0], [0.3, -0.4, 0]], 0.12)
      put(g, cyl(0.2, 0.2, 0.16, 32), plastic(C.cobalt), [-0.15, 0.2, 0], [0, 0, Math.PI / 2])
      droplet(g, [0.12, -0.05, 0.16], 1.2)
      droplet(g, [0.2, -0.45, 0.12], 0.9)
      put(g, cyl(0.42, 0.42, 0.03, 48), tinted(C.aqua, 0.55), [0.25, -0.72, 0.05], [0, 0, 0], [1, 1, 0.55])
    },
  },
  svc_drain: {
    build: (g) => {
      basin(g, [0, -0.3, 0])
      put(g, cyl(0.1, 0.1, 0.03, 32), chrome(), [0, -0.46, 0])
      const plunger = group(g, [0.22, 0.05, 0.05], [0, 0, -0.35])
      put(plunger, cyl(0.045, 0.045, 0.9, 20), new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.6 }), [0, 0.3, 0])
      put(plunger, new THREE.SphereGeometry(0.26, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), plastic(C.orange, { side: THREE.DoubleSide }), [0, -0.18, 0], [Math.PI, 0, 0], [1, 0.8, 1])
    },
  },
  svc_tank: {
    build: (g) => {
      const profile = [[0, -0.55], [0.48, -0.55], [0.52, -0.5], [0.52, 0.32], [0.46, 0.42], [0.2, 0.5], [0, 0.5]].map(([x, y]) => new THREE.Vector2(x, y))
      put(g, new THREE.LatheGeometry(profile, 64), plastic(C.white, { roughness: 0.35 }))
      for (const y of [-0.3, 0.0, 0.25]) put(g, torus(0.525, 0.025, Math.PI * 2, 64), plastic(C.cobalt), [0, y, 0], [Math.PI / 2, 0, 0])
      put(g, cyl(0.16, 0.16, 0.1, 32), plastic(C.cobalt), [0, 0.53, 0])
      const pump = group(g, [0.62, -0.38, 0.32])
      put(pump, rbox(0.42, 0.3, 0.3, 0.08), plastic(C.cobalt), [0, 0, 0])
      put(pump, cyl(0.14, 0.14, 0.12, 32), metal(), [0.26, 0, 0], [0, 0, Math.PI / 2])
      pipe(g, [[0.4, -0.38, 0.32], [0.3, -0.38, 0.2], [0.3, -0.2, 0.2]], 0.05)
    },
  },
  svc_fan: {
    build: (g) => {
      // A pedestal fan, front-facing: guard ring, three blades, motor, stand.
      const head = group(g, [0, 0.32, 0])
      put(head, torus(0.56, 0.035, Math.PI * 2, 64), plastic(C.white, { roughness: 0.3 }))
      for (let i = 0; i < 8; i++) put(head, cyl(0.012, 0.012, 1.1, 8), plastic(C.white), [0, 0, 0.02], [0, 0, (i / 8) * Math.PI])
      for (let i = 0; i < 3; i++) {
        const b = group(head, [0, 0, 0.04], [0, 0, (i / 3) * Math.PI * 2 + 0.4])
        put(b, sphere(0.26, 32), plastic(C.cobalt, { roughness: 0.25 }), [0.24, 0, 0], [0, 0.35, 0], [1, 0.55, 0.12])
      }
      put(head, cyl(0.11, 0.11, 0.08, 32), plastic(C.orange), [0, 0, 0.08], [Math.PI / 2, 0, 0])
      put(head, capsule(0.16, 0.12, 24), plastic(C.white), [0, 0, -0.16], [Math.PI / 2, 0, 0])
      put(g, cyl(0.04, 0.05, 0.6, 16), metal('#D6DCE8'), [0, -0.2, -0.16])
      put(g, cyl(0.34, 0.38, 0.08, 48), plastic(C.white), [0, -0.52, -0.16])
      put(g, rbox(0.14, 0.03, 0.04, 0.01), glow(C.aqua, 1), [0, -0.47, 0.08])
    },
    view: { yaw: 18, pitch: 8 },
  },
  svc_switch: {
    build: (g) => {
      put(g, rbox(1.3, 0.75, 0.1, 0.1), plastic(C.white, { roughness: 0.38 }))
      ;[-0.36, 0].forEach((x, i) => {
        put(g, rbox(0.26, 0.46, 0.06, 0.05), plastic('#EEF2FB'), [x, 0, 0.06])
        put(g, rbox(0.16, 0.24, 0.06, 0.035), plastic(i ? C.cobalt : C.white), [x, 0, 0.1], [i ? -0.3 : 0.3, 0, 0])
      })
      const socket = group(g, [0.38, 0, 0.06])
      put(socket, rbox(0.38, 0.46, 0.06, 0.06), plastic('#EEF2FB'))
      for (const [x, y] of [[-0.07, 0.07], [0.07, 0.07], [0, -0.09]]) put(socket, cyl(0.03, 0.03, 0.04, 16), matte(C.ink), [x, y, 0.03], [Math.PI / 2, 0, 0])
      put(g, sphere(0.03, 16), glow(C.orange, 1.6), [-0.36, 0.3, 0.1])
    },
    view: { yaw: 16, pitch: 10 },
  },
  svc_wiring: {
    build: (g) => {
      const cable = new THREE.CatmullRomCurve3([[-0.7, -0.4, 0], [-0.4, 0.2, 0.1], [0, -0.1, 0.2], [0.3, 0.3, 0], [0.5, 0.0, -0.1]].map((p) => new THREE.Vector3(...p)))
      put(g, new THREE.TubeGeometry(cable, 120, 0.06, 20, false), plastic(C.orange, { roughness: 0.35 }))
      const plug = group(g, [0.62, -0.06, -0.12], [0, 0, -0.5])
      put(plug, rbox(0.3, 0.36, 0.24, 0.08), plastic(C.white, { roughness: 0.35 }))
      for (const x of [-0.06, 0.06]) put(plug, cyl(0.025, 0.025, 0.18, 12), chrome(), [x, -0.24, 0])
      const bolt = poly([[0.04, 0.42], [-0.16, 0.0], [-0.02, 0.0], [-0.1, -0.36], [0.16, 0.08], [0.0, 0.08], [0.1, 0.42]])
      put(g, extrude(bolt, 0.12, 0.03), plastic(C.amber, { emissive: '#FFB21C', emissiveIntensity: 0.25 }), [-0.32, 0.18, 0.3], [0, 0.2, 0], 1.1)
    },
  },
  svc_light: {
    build: (g) => {
      put(g, cyl(0.02, 0.02, 0.5, 12), matte(C.ink), [0, 0.62, 0])
      put(g, cyl(0.1, 0.12, 0.08, 32), plastic(C.cobalt), [0, 0.36, 0])
      const shade = [[0.08, 0.32], [0.16, 0.28], [0.34, 0.08], [0.52, -0.12], [0.54, -0.16], [0.5, -0.15], [0.32, 0.04], [0.14, 0.24], [0.06, 0.28]].map(([x, y]) => new THREE.Vector2(x, y))
      put(g, new THREE.LatheGeometry(shade, 64), plastic(C.cobalt, { roughness: 0.25, side: THREE.DoubleSide }))
      put(g, sphere(0.17, 32), glow('#FFE6A3', 1.4), [0, -0.12, 0])
      put(g, new THREE.ConeGeometry(0.62, 0.7, 64, 1, true), tinted('#FFE7A8', 0.28, { emissive: '#FFD27A', emissiveIntensity: 0.6, side: THREE.DoubleSide }), [0, -0.5, 0])
    },
    view: { pitch: 12 },
  },
  svc_ac: { build: (g) => airConditioner(g), view: { pitch: 10 } },
  svc_ac_repair: {
    build: (g) => {
      put(g, rbox(1.1, 0.78, 0.46, 0.08), plastic(C.white, { roughness: 0.35 }))
      put(g, cyl(0.3, 0.3, 0.05, 48), matte('#3A4566'), [-0.18, 0, 0.23], [Math.PI / 2, 0, 0])
      for (let i = 0; i < 4; i++) {
        const b = group(g, [-0.18, 0, 0.26], [0, 0, (i / 4) * Math.PI * 2 + 0.3])
        put(b, rbox(0.22, 0.09, 0.02, 0.03), plastic(C.cobalt), [0.13, 0, 0])
      }
      put(g, torus(0.31, 0.03, Math.PI * 2, 48), metal(), [-0.18, 0, 0.25])
      for (let i = 0; i < 5; i++) put(g, rbox(0.26, 0.03, 0.02, 0.01), matte(C.steel), [0.34, 0.2 - i * 0.1, 0.235])
      const w = group(g, [0.42, 0.42, 0.2], [0, 0, -0.7])
      put(w, rbox(0.1, 0.5, 0.06, 0.03), metal('#C9D1E0'), [0, 0, 0])
      put(w, torus(0.1, 0.035, Math.PI * 1.4, 24), metal('#C9D1E0'), [0, 0.3, 0], [0, 0, -0.7])
      badge(g, 'check', [0.5, -0.38, 0.32], 0.36)
    },
  },
  svc_fridge: {
    build: (g) => {
      put(g, rbox(0.82, 1.5, 0.72, 0.12), plastic(C.white, { roughness: 0.32 }))
      put(g, rbox(0.8, 0.02, 0.02, 0.01), matte('#C9D2E6'), [0, 0.22, 0.36])
      for (const [y, h] of [[0.5, 0.3], [-0.25, 0.5]]) put(g, rbox(0.05, h, 0.06, 0.025), plastic(C.cobalt), [-0.3, y, 0.39])
      put(g, rbox(0.2, 0.08, 0.02, 0.03), glow(C.aqua, 0.7), [0.18, 0.55, 0.365])
      put(g, sphere(0.06, 16), plastic(C.aqua), [0.18, 0.38, 0.38], [0, 0, 0], [1, 1, 0.3])
    },
  },
  svc_washer: { build: (g) => washer(g) },
  svc_ro: {
    build: (g) => {
      put(g, rbox(0.8, 1.2, 0.5, 0.12), plastic(C.white, { roughness: 0.32 }))
      put(g, rbox(0.62, 0.5, 0.06, 0.08), tinted('#BFEFFF', 0.6), [0, 0.2, 0.25])
      put(g, cyl(0.12, 0.12, 0.42, 32), tinted(C.aqua, 0.7, { emissive: '#48D9F5', emissiveIntensity: 0.25 }), [0, 0.2, 0.18])
      put(g, rbox(0.62, 0.14, 0.04, 0.04), plastic(C.cobalt), [0, -0.22, 0.26])
      put(g, rbox(0.12, 0.05, 0.02, 0.02), glow(C.mint, 1), [0.18, -0.22, 0.285])
      const tap = group(g, [0, -0.36, 0.32])
      put(tap, cyl(0.04, 0.04, 0.16, 16), chrome(), [0, 0, 0.04], [Math.PI / 2, 0, 0])
      put(tap, cyl(0.035, 0.03, 0.1, 16), chrome(), [0, -0.06, 0.1])
      droplet(g, [0, -0.6, 0.42], 0.7)
    },
  },
  svc_geyser: {
    build: (g) => {
      put(g, capsule(0.42, 0.62, 48), plastic(C.white, { roughness: 0.3 }))
      put(g, cyl(0.43, 0.43, 0.08, 64), plastic(C.cobalt), [0, -0.1, 0])
      const dial = group(g, [0, 0.22, 0.4])
      put(dial, cyl(0.15, 0.15, 0.05, 40), plastic('#EEF2FB'), [0, 0, 0], [Math.PI / 2, 0, 0])
      put(dial, rbox(0.03, 0.12, 0.02, 0.01), plastic(C.red), [0.03, 0.03, 0.03], [0, 0, -0.6])
      put(g, sphere(0.04, 16), glow(C.orange, 1.6), [0.22, -0.3, 0.37])
      for (const x of [-0.14, 0.14]) put(g, cyl(0.045, 0.045, 0.3, 16), chrome(), [x, -0.82, 0])
      put(g, cyl(0.045, 0.045, 0.06, 16), plastic(C.red), [-0.14, -0.7, 0])
      put(g, cyl(0.045, 0.045, 0.06, 16), plastic(C.cobalt), [0.14, -0.7, 0])
    },
  },
  svc_kitchen: {
    build: (g) => {
      put(g, rbox(1.5, 0.12, 0.8, 0.04), plastic('#EEF2FB', { roughness: 0.4 }), [0, -0.3, 0])
      put(g, rbox(1.46, 0.5, 0.74, 0.06), plastic(C.cobalt, { roughness: 0.35 }), [0, -0.62, 0])
      for (const x of [-0.36, 0.36]) put(g, rbox(0.6, 0.38, 0.02, 0.03), plastic('#2A5BFF'), [x, -0.62, 0.375])
      put(g, rbox(0.62, 0.06, 0.44, 0.06), matte('#C3CCE0'), [0.25, -0.24, 0.02])
      const f = group(g, [0.25, -0.24, -0.26], [0, 0, 0], 0.7)
      faucet(f, { flow: 0.8 })
      sprayBottle(g, [-0.45, 0.04, 0.05]).scale.setScalar(0.62)
    },
  },
  svc_bath: {
    build: (g) => {
      put(g, rbox(0.62, 0.62, 0.22, 0.1), plastic(C.white, { roughness: 0.3 }), [0, 0.18, -0.32])
      put(g, rbox(0.2, 0.05, 0.05, 0.02), metal('#D6DCE8'), [0.12, 0.42, -0.2])
      const bowl = [[0, -0.42], [0.22, -0.42], [0.25, -0.2], [0.42, -0.05], [0.44, 0.02], [0, 0.02]].map(([x, y]) => new THREE.Vector2(x, y))
      put(g, new THREE.LatheGeometry(bowl, 64), plastic(C.white, { roughness: 0.3 }), [0, 0, 0.02], [0, 0, 0], [0.95, 1, 1.15])
      put(g, cyl(0.42, 0.42, 0.06, 64), plastic('#EEF2FB'), [0, 0.06, 0.02], [0, 0, 0], [0.95, 1, 1.15])
      bubbles(g, [[0.38, 0.32, 0.3, 0.1], [0.52, 0.12, 0.38, 0.07], [0.3, 0.52, 0.18, 0.06]])
      const brush = group(g, [-0.5, -0.05, 0.3], [0, 0, 0.35])
      put(brush, cyl(0.03, 0.03, 0.6, 16), plastic(C.cobalt), [0, 0.2, 0])
      put(brush, sphere(0.1, 20), matte(C.aqua), [0, -0.12, 0], [0, 0, 0], [1, 0.8, 1])
    },
  },
  svc_sofa: {
    build: (g) => {
      const fabric = plastic(C.cobalt, { roughness: 0.55, clearcoat: 0.2, sheen: 0.6, sheenColor: new THREE.Color('#8FB2FF') })
      put(g, rbox(1.5, 0.3, 0.7, 0.12), fabric, [0, -0.2, 0])
      put(g, rbox(1.5, 0.55, 0.22, 0.1), fabric, [0, 0.12, -0.26])
      for (const x of [-0.82, 0.82]) put(g, rbox(0.2, 0.46, 0.72, 0.09), fabric, [x, -0.06, 0])
      for (const x of [-0.36, 0.36]) put(g, rbox(0.68, 0.14, 0.56, 0.07), plastic('#2F6BFF', { roughness: 0.5, clearcoat: 0.2 }), [x, -0.0, 0.06])
      put(g, rbox(0.34, 0.3, 0.12, 0.08), plastic(C.amber, { roughness: 0.6, clearcoat: 0.1 }), [-0.42, 0.18, -0.08], [0.2, 0.3, 0.1])
      for (const x of [-0.7, 0.7]) put(g, cyl(0.04, 0.03, 0.14, 12), new THREE.MeshStandardMaterial({ map: woodTexture() }), [x, -0.42, 0.25])
      bubbles(g, [[0.5, 0.42, 0.2, 0.08], [0.66, 0.26, 0.32, 0.06]])
    },
  },
  svc_door: {
    build: (g) => {
      put(g, rbox(0.92, 1.56, 0.14, 0.05), new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.55 }))
      for (const y of [0.36, -0.36]) put(g, rbox(0.62, 0.56, 0.05, 0.04), new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.5, color: '#E8C9A8' }), [0, y, 0.07])
      const lock = group(g, [0.32, -0.02, 0.1])
      put(lock, rbox(0.1, 0.3, 0.04, 0.03), chrome(), [0, 0, 0])
      put(lock, rbox(0.22, 0.05, 0.06, 0.025), chrome(), [-0.08, 0.06, 0.04])
      put(lock, cyl(0.025, 0.025, 0.04, 16), matte(C.ink), [0, -0.08, 0.03], [Math.PI / 2, 0, 0])
      put(g, rbox(1.06, 0.08, 0.2, 0.03), plastic(C.cobalt), [0, 0.82, 0])
      for (const x of [-0.5, 0.5]) put(g, rbox(0.08, 1.7, 0.2, 0.03), plastic(C.cobalt), [x, 0, 0])
    },
    view: { yaw: 30 },
  },
  svc_furniture: {
    build: (g) => {
      const wood = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.55 })
      put(g, rbox(1.0, 1.1, 0.5, 0.05), wood)
      put(g, rbox(0.9, 0.04, 0.44, 0.01), new THREE.MeshStandardMaterial({ color: '#8A5428', roughness: 0.7 }), [0, 0.05, 0.03])
      put(g, rbox(0.86, 0.42, 0.04, 0.02), new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.5, color: '#F0D2B0' }), [0, -0.25, 0.26])
      put(g, rbox(0.24, 0.05, 0.05, 0.02), plastic(C.cobalt), [0, -0.2, 0.3])
      for (const x of [-0.4, 0.4]) put(g, cyl(0.04, 0.03, 0.14, 12), plastic(C.cobalt), [x, -0.62, 0.15])
      const sd = group(g, [0.42, 0.4, 0.38], [0, 0, -0.9])
      put(sd, cyl(0.07, 0.07, 0.26, 20), plastic(C.orange), [0, -0.15, 0])
      put(sd, cyl(0.022, 0.022, 0.3, 12), chrome(), [0, 0.12, 0])
      put(g, rbox(0.3, 0.2, 0.2, 0.05), plastic(C.amber), [-0.25, 0.2, 0.05])
    },
  },
  svc_carpentry: { build: (g) => { plank(g); saw(g); hammer(g) } },
}

// helpers reused by other icon groups
export { airConditioner, basin, bubbles, bulb, droplet, faucet, hammer, pipe, plank, saw, sponge, sprayBottle, wallSwitch, washer }
