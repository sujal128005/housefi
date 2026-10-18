// People: one friendly avatar bust in the same soft-toy style as the objects. Technicians wear the Housefi cobalt cap
// and uniform with the logo; customers wear everyday colours. Status icons (verified, pending, needs a fix) put the
// technician's ID card in front with the shared status badge.
import { C, THREE, badge, canvasTexture, capsule, cyl, decal, group, logo, matte, metal, plastic, put, rbox, skin, sphere, torus } from '../kit.js'

/**
 * A head-and-shoulders avatar. Faces +z; about 1.5 units tall.
 * @param {{ female?: boolean, tech?: boolean, top?: string, tone?: string, hair?: string, smile?: 'open'|'soft' }} o
 */
export function avatar(g, { female = false, tech = true, top = C.cobalt, tone = C.skin, hair = C.hair, smile = 'open' } = {}) {
  const a = group(g)
  const sk = skin(tone)
  const shirt = plastic(top, { roughness: 0.45, clearcoat: 0.3 })

  // Shoulders and chest
  const torso = [[0.001, -0.62], [0.68, -0.62], [0.7, -0.5], [0.66, -0.28], [0.52, -0.08], [0.3, 0.02], [0.14, 0.04], [0.001, 0.04]].map(([x, y]) => new THREE.Vector2(x, y))
  put(a, new THREE.LatheGeometry(torso, 64), shirt, [0, 0, 0], [0, 0, 0], [1, 1, 0.62])
  if (tech) {
    put(a, torus(0.17, 0.05, Math.PI * 2, 48), plastic(C.orange), [0, 0.03, 0], [Math.PI / 2, 0, 0], [1, 1, 0.8])
    logo(a, [0.3, -0.3, 0.36], 0.09)
    put(a, rbox(0.04, 0.3, 0.02, 0.01), plastic(C.orange), [0.05, -0.32, 0.4])
  } else {
    put(a, torus(0.16, 0.04, Math.PI * 2, 48), plastic(C.white), [0, 0.03, 0], [Math.PI / 2, 0, 0], [1, 1, 0.8])
  }

  // Neck and head
  put(a, cyl(0.13, 0.15, 0.2, 32), sk, [0, 0.12, 0])
  const head = group(a, [0, 0.52, 0.02])
  put(head, sphere(0.38, 64), sk, [0, 0, 0], [0, 0, 0], [1, 1.06, 0.96])
  for (const s of [-1, 1]) put(head, sphere(0.08, 24), sk, [s * 0.37, -0.02, -0.02], [0, 0, 0], [0.6, 1, 1])
  put(head, sphere(0.05, 24), sk, [0, -0.03, 0.37])

  // Face
  const ink = plastic('#1A1416', { roughness: 0.2 })
  const shine = plastic('#FFFFFF', { emissive: '#FFFFFF', emissiveIntensity: 0.6 })
  for (const s of [-1, 1]) {
    put(head, sphere(0.055, 24), ink, [s * 0.13, 0.05, 0.33], [0, 0, 0], [0.85, 1.15, 0.6])
    put(head, sphere(0.016, 12), shine, [s * 0.13 + 0.02, 0.075, 0.37])
    put(head, capsule(0.018, 0.07, 8), plastic(hair, { roughness: 0.5 }), [s * 0.13, 0.15, 0.335], [0, 0, Math.PI / 2 + s * 0.15])
    put(head, sphere(0.06, 20), new THREE.MeshPhysicalMaterial({ color: '#FF8E8E', transparent: true, opacity: 0.35, roughness: 0.6 }), [s * 0.22, -0.08, 0.3], [0, 0, 0], [1, 0.7, 0.4])
  }
  if (smile === 'open') {
    const mouth = new THREE.Shape()
    mouth.absarc(0, 0, 0.1, Math.PI, Math.PI * 2, false)
    mouth.closePath()
    const m = put(head, new THREE.ShapeGeometry(mouth, 24), matte('#7A2632'), [0, -0.12, 0.355], [-0.18, 0, 0])
    m.castShadow = false
    put(head, new THREE.ShapeGeometry((() => { const s = new THREE.Shape(); s.absarc(0, 0, 0.085, Math.PI * 1.08, Math.PI * 1.92, false); s.lineTo(0.085 * Math.cos(Math.PI * 1.08), 0.085 * Math.sin(Math.PI * 1.08)); return s })(), 16), matte('#FFFFFF'), [0, -0.122, 0.358], [-0.18, 0, 0])
  } else {
    put(head, torus(0.08, 0.018, Math.PI, 32), matte('#7A2632'), [0, -0.1, 0.345], [0.2, 0, Math.PI])
  }

  // Hair
  const hairMat = plastic(hair, { roughness: 0.45, clearcoat: 0.4 })
  put(head, new THREE.SphereGeometry(0.4, 64, 32, 0, Math.PI * 2, 0, Math.PI * 0.42), hairMat, [0, 0.03, -0.01], [-0.22, 0, 0], [1.02, 1.08, 1.0])
  if (female) {
    put(head, capsule(0.3, 0.42, 32), hairMat, [0, -0.28, -0.16], [0.12, 0, 0], [1.25, 1, 0.7])
    for (const s of [-1, 1]) put(head, capsule(0.1, 0.42, 24), hairMat, [s * 0.34, -0.2, 0.0], [0, 0, s * 0.08])
  } else {
    for (const s of [-1, 1]) put(head, capsule(0.05, 0.1, 12), hairMat, [s * 0.36, 0.1, 0.02])
  }

  // Housefi cap
  if (tech) {
    const cap = plastic(C.cobalt, { roughness: 0.3 })
    put(head, new THREE.SphereGeometry(0.42, 64, 32, 0, Math.PI * 2, 0, Math.PI * 0.46), cap, [0, 0.06, -0.02], [-0.12, 0, 0], [1.02, 1.0, 1.02])
    put(head, cyl(0.3, 0.3, 0.04, 48, 1, false), cap, [0, 0.18, 0.3], [0.18, 0, 0], [1, 1, 0.7])
    put(head, sphere(0.05, 16), plastic(C.orange), [0, 0.47, 0.0])
    logo(head, [0, 0.3, 0.37], 0.08)
    if (female) put(head, capsule(0.1, 0.26, 24), hairMat, [0, -0.12, -0.42], [0.5, 0, 0])
  }
  return a
}

/** The Housefi ID card held in front of the chest (photo, name lines, logo). */
function idCard(g, pos, rot = [0, 0, 0], scale = 1) {
  const c = group(g, pos, rot, scale)
  put(c, rbox(1.0, 1.3, 0.06, 0.1), plastic(C.white, { roughness: 0.4 }))
  put(c, rbox(1.0, 0.3, 0.065, 0.06), plastic(C.cobalt), [0, 0.5, 0.002])
  logo(c, [-0.32, 0.5, 0.05], 0.08)
  put(c, rbox(0.34, 0.06, 0.02, 0.025), plastic(C.white), [0.12, 0.5, 0.045])
  const photo = canvasTexture(256, 256, (g2) => {
    g2.fillStyle = '#DCE8FF'
    g2.beginPath()
    g2.arc(128, 128, 126, 0, Math.PI * 2)
    g2.fill()
    g2.fillStyle = '#0A45F5'
    g2.beginPath()
    g2.arc(128, 108, 50, 0, Math.PI * 2)
    g2.fill()
    g2.beginPath()
    g2.ellipse(128, 236, 92, 70, 0, Math.PI, 0)
    g2.fill()
  })
  decal(c, photo, 0.46, 0.46, [0, 0.07, 0.035])
  put(c, rbox(0.62, 0.07, 0.02, 0.03), plastic(C.ink), [0, -0.3, 0.035])
  put(c, rbox(0.44, 0.06, 0.02, 0.03), plastic(C.mist), [0, -0.44, 0.035])
  put(c, torus(0.08, 0.02, Math.PI * 2, 24), metal(), [0, 0.72, 0])
  return c
}

function wrench(g, pos, rot, scale = 1) {
  const w = group(g, pos, rot, scale)
  put(w, rbox(0.16, 1.1, 0.09, 0.05), metal('#C9D1E0'), [0, 0, 0])
  put(w, torus(0.17, 0.07, Math.PI * 1.5, 32), metal('#C9D1E0'), [0, 0.64, 0], [0, 0, -Math.PI * 0.25])
  put(w, rbox(0.2, 0.42, 0.11, 0.06), plastic(C.orange), [0, -0.4, 0.005])
  return w
}

function wavingHand(g, pos, rot, scale = 1, tone = C.skin) {
  const h = group(g, pos, rot, scale)
  const sk = skin(tone)
  put(h, rbox(0.44, 0.46, 0.18, 0.14), sk)
  ;[-0.15, -0.05, 0.05, 0.15].forEach((x, i) => put(h, capsule(0.055, 0.18 + (i === 1 || i === 2 ? 0.05 : 0), 12), sk, [x, 0.34 + (i === 1 || i === 2 ? 0.03 : 0), 0], [0, 0, -x * 0.6]))
  put(h, capsule(0.06, 0.16, 12), sk, [-0.28, 0.04, 0.02], [0, 0, 0.9])
  put(h, capsule(0.14, 0.42, 20), plastic(C.orange, { roughness: 0.45 }), [0.02, -0.46, -0.02])
  return h
}

export const PEOPLE_ICONS = {
  tech_man: { build: (g) => avatar(g, { tech: true }), view: { yaw: 14, pitch: 6, fill: 0.86 } },
  tech_woman: { build: (g) => avatar(g, { tech: true, female: true, tone: '#E9B08A' }), view: { yaw: 14, pitch: 6, fill: 0.86 } },
  tech_hero: {
    build: (g) => {
      avatar(g, { tech: true })
      wrench(g, [0.62, 0.42, -0.25], [0, 0, -0.55], 0.8)
    },
    view: { yaw: 12, pitch: 6, fill: 0.86 },
  },
  tech_done: { build: (g) => { avatar(g, { tech: true }); badge(g, 'check', [0.6, -0.3, 0.45], 0.5) }, view: { yaw: 12, pitch: 6, fill: 0.86 } },
  customer: { build: (g) => avatar(g, { tech: false, female: true, top: C.orange, tone: '#E9B08A' }), view: { yaw: 14, pitch: 6, fill: 0.86 } },
  woman: { build: (g) => { avatar(g, { tech: false, female: true, top: '#2FB8E8', tone: '#D99A72' }); badge(g, 'star', [0.6, -0.32, 0.45], 0.42) }, view: { yaw: 12, pitch: 6, fill: 0.86 } },
  wave: {
    build: (g) => {
      avatar(g, { tech: false, top: C.amber, tone: '#E2A47E' })
      wavingHand(g, [0.72, 0.42, 0.18], [0, -0.2, -0.3], 0.85)
    },
    view: { yaw: 10, pitch: 6, fill: 0.86 },
  },
  verify_ok: { build: (g) => { idCard(g, [0, 0, 0], [0, -0.18, 0.05]); badge(g, 'check', [0.42, -0.5, 0.25], 0.5) } },
  verify_pending: { build: (g) => { idCard(g, [0, 0, 0], [0, -0.18, 0.05]); badge(g, 'clock', [0.42, -0.5, 0.25], 0.5) } },
  verify_fix: { build: (g) => { idCard(g, [0, 0, 0], [0, -0.18, 0.05]); badge(g, 'alert', [0.42, -0.5, 0.25], 0.5) } },
}
