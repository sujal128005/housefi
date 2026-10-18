// Short looping 3D animations for the live moments of a booking: finding a technician, technician assigned, on the
// way, at the door, repair in progress, job done, and a job offer ringing. Same models, materials and lights as the
// icons. Each `build(g)` returns `update(t)` with t in [0, 1); frame 0 and the frame after the last are identical,
// so the loop is seamless. render.mjs turns each into a sprite sheet (assets/anim3d/<name>.webp).
import { C, THREE, badge, capsule, chrome, cone, cyl, extrude, glow, group, logo, matte, metal, plastic, put, rbox, sphere, tinted, torus } from './kit.js'
import { magnifier, pin } from './icons/things.js'
import { avatar } from './icons/people.js'

const TAU = Math.PI * 2
const ease = (x) => x * x * (3 - 2 * x)
/** 0 → 1 over [a, b], clamped and eased. */
const span = (t, a, b) => ease(Math.min(1, Math.max(0, (t - a) / (b - a))))
/** A fading ring that grows outward, rebuilt each frame. */
function ripple(g, y, color) {
  const mat = tinted(color, 0.7, { emissive: color, emissiveIntensity: 0.25 })
  const mesh = put(g, torus(0.3, 0.022, TAU, 72), mat, [0, y, 0], [Math.PI / 2, 0, 0])
  mesh.castShadow = false
  return (p) => {
    mesh.geometry.dispose()
    mesh.geometry = torus(0.18 + p * 0.78, 0.022, TAU, 72)
    mat.opacity = 0.75 * (1 - p) ** 1.4
  }
}

/** A swinging bell; the pivot sits at its handle. */
function swingBell(g, pos, s) {
  const pivot = group(g, pos, [0, 0, 0], s)
  const b = group(pivot, [0, -0.6, 0])
  const profile = [[0.001, 0.56], [0.12, 0.54], [0.24, 0.42], [0.3, 0.12], [0.36, -0.14], [0.5, -0.3], [0.52, -0.36], [0.001, -0.36]].map(([x, y]) => new THREE.Vector2(x, y))
  put(b, new THREE.LatheGeometry(profile, 64), plastic(C.yellow, { roughness: 0.2, emissive: '#FFB21C', emissiveIntensity: 0.12 }))
  put(b, torus(0.06, 0.025, TAU, 24), plastic(C.amber), [0, 0.6, 0])
  const clapper = group(b, [0, 0.1, 0])
  put(clapper, sphere(0.12, 28), plastic(C.orange), [0, -0.54, 0])
  return { pivot, clapper }
}

/** Curved "sound" arcs beside a bell; returns a setter for their pulse (0..1). */
function soundArcs(g, pos, side = 1) {
  const arcs = [0.22, 0.36, 0.5].map((r) => {
    const m = tinted(C.orange, 1, { emissive: C.orange, emissiveIntensity: 0.2 })
    const mesh = put(g, torus(r, 0.03, Math.PI / 2.4, 32), m, pos, [0, side > 0 ? 0 : Math.PI, -Math.PI / 4.8])
    mesh.castShadow = false
    return { mesh, m }
  })
  return (p) => arcs.forEach(({ mesh, m }, i) => {
    const k = Math.max(0, Math.sin((p - i * 0.12) * TAU))
    m.opacity = 0.15 + 0.85 * k
    mesh.scale.setScalar(0.92 + 0.08 * k)
  })
}

/** The delivery scooter with spoked wheels (so the spin reads) and the Housefi box. */
function scooter(g) {
  const body = plastic(C.cobalt, { roughness: 0.25 })
  const wheels = []
  for (const x of [-0.55, 0.55]) {
    const w = group(g, [x, -0.42, 0])
    put(w, torus(0.22, 0.09, TAU, 48), matte(C.ink, { roughness: 0.8 }))
    put(w, cyl(0.13, 0.13, 0.1, 32), metal(), [0, 0, 0], [Math.PI / 2, 0, 0])
    for (let i = 0; i < 3; i++) {
      for (const z of [-0.06, 0.06]) put(w, rbox(0.05, 0.27, 0.025, 0.01), plastic(C.orange), [0, 0, z], [0, 0, (i / 3) * Math.PI])
    }
    put(w, cyl(0.045, 0.045, 0.16, 16), chrome(), [0, 0, 0], [Math.PI / 2, 0, 0])
    wheels.push(w)
  }
  const frame = group(g)
  put(frame, rbox(1.1, 0.12, 0.34, 0.06), body, [0, -0.28, 0])
  put(frame, rbox(0.62, 0.36, 0.42, 0.16), body, [-0.42, -0.12, 0])
  put(frame, rbox(0.5, 0.12, 0.34, 0.06), matte(C.ink), [-0.4, 0.1, 0])
  put(frame, rbox(0.14, 0.7, 0.3, 0.06), body, [0.5, 0.0, 0], [0, 0, -0.25])
  put(frame, cyl(0.03, 0.03, 0.6, 12), metal(), [0.6, 0.36, 0], [Math.PI / 2, 0, 0])
  put(frame, sphere(0.08, 20), glow(C.amber, 1.4), [0.66, 0.16, 0], [0, 0, 0], [0.6, 1, 1])
  const box = group(frame, [-0.6, 0.38, 0])
  put(box, rbox(0.46, 0.4, 0.42, 0.06), plastic(C.white))
  logo(box, [0, 0.0, 0.22], 0.13)
  return { wheels, frame }
}

/** A little four-point sparkle. */
function sparkle(g, pos, s, color = C.amber) {
  const sp = group(g, pos, [0, 0, 0], s)
  const m = glow(color, 0.9)
  put(sp, cone(0.08, 0.5, 4), m, [0, 0.25, 0])
  put(sp, cone(0.08, 0.5, 4), m, [0, -0.25, 0], [Math.PI, 0, 0])
  put(sp, cone(0.08, 0.5, 4), m, [0.25, 0, 0], [0, 0, -Math.PI / 2])
  put(sp, cone(0.08, 0.5, 4), m, [-0.25, 0, 0], [0, 0, Math.PI / 2])
  return sp
}

export const ANIMS = {
  /** Looking for a technician: radar ripples spread over the map while the magnifier circles the pin. */
  anim_finding: {
    frames: 40,
    fps: 24,
    view: { pitch: 26, fill: 0.8 },
    build: (g) => {
      put(g, cyl(0.98, 0.98, 0.06, 72), plastic('#DDEBFF', { roughness: 0.5 }), [0, -0.4, 0])
      put(g, torus(0.98, 0.03, TAU, 96), plastic(C.sky), [0, -0.37, 0], [Math.PI / 2, 0, 0])
      const rings = [ripple(g, -0.355, C.cobalt), ripple(g, -0.355, C.cobalt)]
      const p = pin(g, [0, 0.12, 0], C.cobalt, 0.75)
      const lens = group(g)
      magnifier(lens, [0, 0, 0], [0, 0, -0.7], 0.6)
      return (t) => {
        rings[0]((t * 2) % 1)
        rings[1]((t * 2 + 0.5) % 1)
        p.position.y = 0.12 + 0.05 * Math.abs(Math.sin(t * TAU * 2))
        const a = t * TAU
        lens.position.set(Math.cos(a) * 0.52, 0.02 + 0.04 * Math.sin(a * 2), Math.sin(a) * 0.45 + 0.1)
        lens.rotation.y = -0.25 * Math.cos(a)
      }
    },
  },

  /** Technician assigned: a friendly nod and the check badge flips like a coin. */
  anim_assigned: {
    frames: 48,
    fps: 24,
    view: { yaw: 12, pitch: 6, fill: 0.86 },
    build: (g) => {
      const who = group(g)
      avatar(who, { tech: true })
      const head = who.children[0].children.find((c) => c.isGroup && c.position.y > 0.4)
      const b = group(g, [0.6, -0.3, 0.45])
      badge(b, 'check', [0, 0, 0], 0.5)
      const sparks = [sparkle(g, [-0.62, 0.62, 0.2], 0.32), sparkle(g, [0.7, 0.35, 0.3], 0.22, C.aqua)]
      return (t) => {
        who.rotation.y = 0.16 * Math.sin(t * TAU)
        if (head) head.rotation.x = -0.07 * Math.max(0, Math.sin(t * TAU * 2))
        b.rotation.y = TAU * span(t, 0.5, 0.85)
        b.position.y = -0.3 + 0.05 * Math.sin(span(t, 0.5, 0.85) * Math.PI)
        sparks.forEach((s, i) => {
          const k = Math.max(0, Math.sin((t + i * 0.45) * TAU))
          s.scale.setScalar((i ? 0.22 : 0.32) * (0.25 + 0.75 * k))
          s.rotation.z = t * Math.PI
        })
      }
    },
  },

  /** On the way: wheels turn, the scooter rocks over the road and speed lines stream past. */
  anim_travel: {
    frames: 24,
    fps: 24,
    view: { yaw: 30, pitch: 14, fill: 0.88 },
    build: (g) => {
      const { wheels, frame } = scooter(g)
      const lines = [[-1.0, 0.1, 0.32], [-1.15, -0.12, 0.2], [-0.95, 0.32, 0.12]].map(([x, y, w]) => {
        const m = tinted(C.sky, 0.8, { emissive: C.sky, emissiveIntensity: 0.3 })
        const mesh = put(g, capsule(0.035, w, 12), m, [x, y, 0.05], [0, 0, Math.PI / 2])
        mesh.castShadow = false
        return { mesh, m, x }
      })
      return (t) => {
        wheels.forEach((w) => { w.rotation.z = -TAU * t * 2 })
        frame.position.y = 0.018 * Math.sin(t * TAU * 2)
        frame.rotation.z = 0.02 * Math.sin(t * TAU * 2 + 1)
        lines.forEach(({ mesh, m, x }, i) => {
          const p = (t + i / 3) % 1
          mesh.position.x = x + 0.25 - p * 0.55
          m.opacity = 0.85 * Math.sin(p * Math.PI)
        })
      }
    },
  },

  /** At your door: the bell swings and rings. */
  anim_arrived: {
    frames: 36,
    fps: 24,
    view: { yaw: 22, pitch: 12 },
    build: (g) => {
      put(g, rbox(1.0, 1.6, 0.12, 0.06), plastic(C.cobalt, { roughness: 0.3 }))
      put(g, rbox(1.2, 0.1, 0.3, 0.03), plastic(C.white), [0, 0.85, 0])
      put(g, sphere(0.05, 16), plastic(C.amber), [0.32, -0.05, 0.1])
      logo(g, [0, 0.45, 0.08], 0.14)
      put(g, rbox(1.3, 0.06, 0.5, 0.03), matte('#E7C9A4'), [0, -0.84, 0.25])
      const { pivot, clapper } = swingBell(g, [0.62, 0.62, 0.2], 0.32)
      const arcs = soundArcs(g, [0.62, 0.42, 0.2])
      badge(g, 'check', [0.5, -0.45, 0.25], 0.42)
      return (t) => {
        // Two quick rings, then a pause.
        const ring = t < 0.6 ? Math.sin((t / 0.6) * TAU * 2) * (1 - t / 0.6) ** 0.6 : 0
        pivot.rotation.z = 0.42 * ring
        clapper.rotation.z = -0.5 * ring
        arcs(t < 0.6 ? (t / 0.6) * 2 % 1 : 0.75)
      }
    },
  },

  /** Repair in progress: a spanner tightens the nut on a pipe fitting, a few sparkles. */
  anim_working: {
    frames: 36,
    fps: 24,
    view: { yaw: 14, pitch: 10, fill: 0.82 },
    build: (g) => {
      // A wall plate with the fitting; the nut faces the camera so the turn reads clearly.
      put(g, rbox(1.3, 1.3, 0.12, 0.2), plastic(C.white, { roughness: 0.4 }), [0, 0, -0.2])
      put(g, cyl(0.12, 0.12, 1.3, 32), chrome({ roughness: 0.2 }), [0, -0.5, -0.05])
      put(g, cyl(0.2, 0.2, 0.12, 32), plastic(C.cobalt), [0, -0.66, -0.05])
      put(g, cyl(0.3, 0.3, 0.14, 48), plastic(C.cobalt), [0, 0, -0.08], [Math.PI / 2, 0, 0])
      const nut = group(g, [0, 0, 0.04])
      put(nut, cyl(0.2, 0.2, 0.14, 6), metal('#E3B04B', { roughness: 0.3 }), [0, 0, 0], [Math.PI / 2, 0, 0])
      put(nut, cyl(0.07, 0.07, 0.16, 24), chrome(), [0, 0, 0.02], [Math.PI / 2, 0, 0])
      // Spanner: open jaw around the nut, handle out to the right.
      const sp = group(g, [0, 0, 0.13])
      // C-shaped head: round outside, a slot that fits the nut (open on +y before rotation).
      const jaw = new THREE.Shape()
      const top = Math.sqrt(0.32 ** 2 - 0.19 ** 2)
      jaw.moveTo(0.19, top)
      jaw.absarc(0, 0, 0.32, Math.atan2(top, 0.19), Math.atan2(top, -0.19), true)
      jaw.lineTo(-0.19, -0.17)
      jaw.lineTo(0.19, -0.17)
      jaw.closePath()
      const steel = metal('#C9D1E0')
      // The jaw's open side faces away from the handle; the nut sits in the slot.
      put(sp, extrude(jaw, 0.08, 0.02), steel, [0, 0, -0.04], [0, 0, Math.PI / 2])
      put(sp, rbox(1.0, 0.18, 0.09, 0.05), steel, [0.72, 0, 0])
      put(sp, rbox(0.46, 0.24, 0.13, 0.08), plastic(C.orange), [1.0, 0, 0.01])
      const drops = [0, 1, 2].map((i) => {
        const m = tinted(C.aqua, 0.9, { emissive: C.aqua, emissiveIntensity: 0.25 })
        const d = put(g, sphere(0.05, 20), m, [0.05 * (i - 1), -0.74, 0.1], [0, 0, 0], [1, 1.3, 1])
        d.castShadow = false
        return { d, m }
      })
      const sparks = [sparkle(g, [-0.5, 0.45, 0.2], 0.3), sparkle(g, [0.55, 0.5, 0.1], 0.22, C.aqua)]
      return (t) => {
        // Pull up (slow, the nut turns with it), then swing back (quick): a ratchet.
        const pull = t < 0.62 ? span(t, 0, 0.62) : 1 - span(t, 0.62, 0.95)
        sp.rotation.z = -0.35 + 0.8 * pull
        nut.rotation.z = (Math.PI / 3) * span(t, 0, 0.62)
        drops.forEach(({ d, m }, i) => {
          const p = (t + i / 3) % 1
          d.position.y = -0.74 - p * 0.3
          m.opacity = 0.9 * (1 - p) * Math.min(1, p * 6)
        })
        sparks.forEach((s, i) => {
          const k = Math.max(0, Math.sin((t + i * 0.5) * TAU))
          s.scale.setScalar((i ? 0.22 : 0.3) * (0.2 + 0.8 * k))
          s.rotation.z = t * Math.PI
        })
      }
    },
  },

  /** Job done: the check badge pops and confetti bursts from the popper. */
  anim_done: {
    frames: 48,
    fps: 24,
    view: { yaw: 16, pitch: 10, fill: 0.86 },
    build: (g) => {
      const c = group(g, [-0.42, -0.42, 0], [0, 0, -0.7])
      put(c, cone(0.42, 1.25, 48), plastic(C.cobalt, { roughness: 0.25 }), [0, 0, 0], [Math.PI, 0, 0])
      for (const y of [-0.18, 0.18]) put(c, torus(0.28 + y * 0.4, 0.035, TAU, 48), plastic(C.amber), [0, y, 0], [Math.PI / 2, 0, 0])
      const ok = group(g, [0.45, -0.38, 0.2])
      badge(ok, 'check', [0, 0, 0], 0.62)
      const colors = [C.orange, C.aqua, C.amber, C.pink, C.cobalt, C.mint, C.yellow, C.sky]
      const bits = Array.from({ length: 16 }, (_, i) => {
        const m = plastic(colors[i % colors.length], { transparent: true })
        const mesh = put(g, i % 3 === 0 ? sphere(0.06, 18) : rbox(0.14, 0.065, 0.03, 0.015), m, [0, 0, 0])
        mesh.castShadow = false
        const a = 0.35 + (i / 16) * 1.0
        return { mesh, m, vx: Math.cos(a) * (0.75 + (i % 4) * 0.12), vy: Math.sin(a) * (1.25 + (i % 3) * 0.15), z: ((i % 5) - 2) * 0.1, spin: (i % 2 ? 1 : -1) * (3 + (i % 4)), phase: (i % 4) * 0.035 }
      })
      const origin = new THREE.Vector3(-0.05, 0.12, 0)
      return (t) => {
        c.rotation.z = -0.7 + 0.1 * Math.max(0, Math.sin(Math.min(1, t * 5) * Math.PI))
        const pop = span(t, 0, 0.18)
        ok.scale.setScalar(t < 0.18 ? 0.5 + 0.62 * pop : 1 + 0.06 * Math.sin(span(t, 0.18, 0.4) * Math.PI))
        bits.forEach((b) => {
          const p = Math.max(0, t - b.phase) * 1.1
          b.mesh.position.set(origin.x + b.vx * p, origin.y + b.vy * p - 1.9 * p * p, b.z)
          b.mesh.rotation.set(p * b.spin, p * b.spin * 0.7, p * b.spin * 1.3)
          b.m.opacity = (1 - span(p, 0.6, 0.95)) * Math.min(1, p * 12)
          b.mesh.visible = b.m.opacity > 0.01
        })
      }
    },
  },

  /** A new job offer for the technician: the bell rings non-stop. */
  anim_ring: {
    frames: 30,
    fps: 24,
    view: { yaw: 16, pitch: 10, fill: 0.8 },
    build: (g) => {
      const { pivot, clapper } = swingBell(g, [0, 0.62, 0], 1)
      put(g, torus(0.07, 0.03, TAU, 24), plastic(C.amber), [0, 0.66, 0])
      const left = soundArcs(g, [-0.15, 0.1, 0], -1)
      const right = soundArcs(g, [0.15, 0.1, 0], 1)
      const b = badge(g, 'plus', [0.48, -0.42, 0.3], 0.4)
      return (t) => {
        const s = Math.sin(t * TAU * 2)
        pivot.rotation.z = 0.32 * s
        clapper.rotation.z = -0.45 * Math.sin(t * TAU * 2 - 0.6)
        left(t * 2 % 1)
        right((t * 2 + 0.5) % 1)
        b.scale.setScalar(0.4 * (1 + 0.06 * Math.max(0, Math.sin(t * TAU * 2))))
      }
    },
  },
}
