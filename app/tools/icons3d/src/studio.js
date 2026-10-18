// Renders one icon at a time on a transparent background, with the same camera, lights and shadow for every icon.
// The render script calls window.renderIcon(name) (and startAnim / animFrame for animations); opening
// studio.html#name in a browser shows that icon or plays that animation.
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { THREE } from './kit.js'
import { ICONS } from './icons/index.js'
import { ANIMS } from './anims.js'

const SIZE = 1024
const canvas = document.getElementById('c')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true })
renderer.setPixelRatio(1)
renderer.setSize(SIZE, SIZE, false)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.NeutralToneMapping
renderer.toneMappingExposure = 1.02
renderer.setClearColor(0x000000, 0)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.VSMShadowMap

const pmrem = new THREE.PMREMGenerator(renderer)
const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture

function makeScene() {
  const scene = new THREE.Scene()
  scene.environment = env
  scene.environmentIntensity = 0.6
  scene.add(new THREE.HemisphereLight('#EEF2FF', '#C7D1F2', 0.55))
  const key = new THREE.DirectionalLight('#FFF5EA', 1.6)
  key.position.set(-3.5, 7, 6)
  scene.add(key)
  // A soft light from almost straight above casts the contact shadow, so it stays under the object.
  const top = new THREE.DirectionalLight('#FFFFFF', 0.25)
  top.position.set(0.6, 10, 1.2)
  top.castShadow = true
  top.shadow.mapSize.set(2048, 2048)
  top.shadow.radius = 14
  top.shadow.blurSamples = 24
  top.shadow.bias = -0.0005
  top.shadow.normalBias = 0.02
  Object.assign(top.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 30 })
  scene.add(top)
  const fill = new THREE.DirectionalLight('#C9D8FF', 0.7)
  fill.position.set(6, 2, 4)
  scene.add(fill)
  const rim = new THREE.DirectionalLight('#FFFFFF', 0.7)
  rim.position.set(0, 4, -6)
  scene.add(rim)
  return scene
}

const DEFAULT_VIEW = { yaw: 24, pitch: 16, fill: 0.84, shadow: true }

/** Soft contact shadow on an invisible floor just under `box`. */
function addFloor(scene, box) {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.2 }))
  floor.rotation.x = -Math.PI / 2
  floor.position.y = box.min.y - 0.005
  floor.receiveShadow = true
  scene.add(floor)
}

/** A fixed three-quarter view; distance and aim adjusted until `box` fills `view.fill` of the frame. */
function frameCamera(box, view) {
  const camera = new THREE.PerspectiveCamera(24, 1, 0.05, 200)
  const dir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - view.pitch), THREE.MathUtils.degToRad(view.yaw))
  const radius = box.getBoundingSphere(new THREE.Sphere()).radius
  let dist = radius / Math.sin(THREE.MathUtils.degToRad(12)) * 1.05
  const target = new THREE.Vector3()
  const corners = []
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z))
  for (let i = 0; i < 6; i++) {
    camera.position.copy(target).addScaledVector(dir, dist)
    camera.lookAt(target)
    camera.updateMatrixWorld(true)
    const ndc = corners.map((c) => c.clone().project(camera))
    const minX = Math.min(...ndc.map((p) => p.x))
    const maxX = Math.max(...ndc.map((p) => p.x))
    const minY = Math.min(...ndc.map((p) => p.y))
    const maxY = Math.max(...ndc.map((p) => p.y))
    const extent = Math.max(maxX - minX, maxY - minY) / 2
    // Re-aim at the middle of the projected box, then scale the distance to the wanted size.
    const mid = new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, ndc[0].z).unproject(camera)
    target.add(mid.sub(target).projectOnPlane(dir))
    dist *= extent / view.fill
  }
  camera.position.copy(target).addScaledVector(dir, dist)
  camera.lookAt(target)
  return camera
}

function dispose(scene) {
  scene.traverse((o) => {
    o.geometry?.dispose?.()
    for (const m of [o.material].flat().filter(Boolean)) {
      for (const v of Object.values(m)) if (v?.isTexture) v.dispose()
      m.dispose()
    }
  })
}

/** Builds, centres and frames an icon, then renders it; returns a PNG data URL. */
async function renderIcon(name) {
  const spec = ICONS[name]
  if (!spec) throw new Error(`Unknown icon ${name}`)
  const view = { ...DEFAULT_VIEW, ...(spec.view ?? {}) }
  const scene = makeScene()
  const root = new THREE.Group()
  await spec.build(root)
  scene.add(root)

  // Centre the object on the origin.
  root.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(root)
  const centre = box.getCenter(new THREE.Vector3())
  root.position.sub(centre)
  root.updateMatrixWorld(true)
  box.setFromObject(root)
  if (view.shadow) addFloor(scene, box)
  renderer.render(scene, frameCamera(box, view))
  const url = canvas.toDataURL('image/png')
  dispose(scene)
  return url
}

// Animations: startAnim(name) builds the scene once and frames the camera on the whole motion (every frame fits);
// animFrame(i) renders frame i; endAnim() frees it.
let anim = null

async function startAnim(name) {
  const spec = ANIMS[name]
  if (!spec) throw new Error(`Unknown animation ${name}`)
  const view = { ...DEFAULT_VIEW, ...(spec.view ?? {}) }
  const scene = makeScene()
  const root = new THREE.Group()
  const update = await spec.build(root)
  scene.add(root)
  const box = new THREE.Box3()
  for (let i = 0; i < spec.frames; i++) {
    update(i / spec.frames)
    root.updateMatrixWorld(true)
    box.union(new THREE.Box3().setFromObject(root))
  }
  const centre = box.getCenter(new THREE.Vector3())
  root.position.sub(centre)
  box.translate(centre.negate())
  if (view.shadow) addFloor(scene, box)
  anim = { spec, scene, root, update, camera: frameCamera(box, view) }
  return { frames: spec.frames, fps: spec.fps }
}

function animFrame(i) {
  anim.update(i / anim.spec.frames)
  anim.root.updateMatrixWorld(true)
  renderer.render(anim.scene, anim.camera)
  return canvas.toDataURL('image/png')
}

function endAnim() {
  if (anim) dispose(anim.scene)
  anim = null
}

window.ICON_NAMES = Object.keys(ICONS)
window.renderIcon = renderIcon
window.ANIM_NAMES = Object.keys(ANIMS)
window.ANIM_META = (n) => ({ frames: ANIMS[n].frames, fps: ANIMS[n].fps })
Object.assign(window, { startAnim, animFrame, endAnim })
await document.fonts.load('800 40px "Anek Latin"')
await document.fonts.load('600 40px "Anek Latin"')
await document.fonts.load('800 40px "Anek Telugu"', 'అ')
window.studioReady = true
if (location.hash) {
  const name = decodeURIComponent(location.hash.slice(1))
  if (ANIMS[name]) {
    // Preview: play the loop in the page.
    const { frames, fps } = await startAnim(name)
    let i = 0
    setInterval(() => animFrame(i++ % frames), 1000 / fps)
  } else renderIcon(name)
}
