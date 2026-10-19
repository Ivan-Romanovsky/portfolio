/**
 * The 3D character on the first screen (three.js).
 *
 * Model: assets/character/3d/model.glb (Tripo, 588k triangles, no skeleton), optimized with
 * gltf-transform (weld, simplify to ~82k, texture 2048 WebP, meshopt) into public/character3d/model.glb.
 *
 * Head without a skeleton: the vertex shader rotates everything above the neck around a pivot in the
 * neck, with a smooth blend zone between shoulders and chin (like skin stretching), so the head turns
 * on its own and there is no seam. The body follows a little, the character breathes and looks around
 * when the cursor is still. Rendering pauses while the hero is off screen.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

// measured on the model (fraction of its height from the feet): narrowest point of the neck
const NECK = { from: 0.495, to: 0.56, pivot: 0.525 };
const FACING = -Math.PI / 2;         // the Tripo export faces +X; turn it to the camera
const LOOK = { yaw: 0.62, pitch: 0.3, bodyYaw: 0.14 }; // radians at full cursor deflection
const STIFF = 60;                    // spring of the gaze: higher = snappier

export async function mountCharacter3D(root: HTMLElement) {
  const canvas = root.querySelector<HTMLCanvasElement>('canvas')!;
  const hero = root.closest<HTMLElement>('.hero');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = matchMedia('(pointer: coarse)').matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(22, 1, 0.1, 50);

  // studio light: warm key from the front-left, cool rim from behind, soft sky/ground fill
  scene.add(new THREE.HemisphereLight(0xffffff, 0xe3ddd2, 1.1));
  const key = new THREE.DirectionalLight(0xfff1e2, 2.4);
  key.position.set(-1.2, 4.2, 2.6);   // high, so the shadow stays short under the feet
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.radius = 6;
  key.shadow.bias = -0.0004;
  Object.assign(key.shadow.camera, { left: -1, right: 1, top: 1.5, bottom: -0.2, near: 0.1, far: 8 });
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xdfeeff, 1.6);
  rim.position.set(1.8, 1.6, -2.2);
  scene.add(rim);

  // shadow catcher: only the shadow is drawn, the page background shows through
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.ShadowMaterial({ opacity: 0.12 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // ---- model ----
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(root.dataset.model!);
  const model = gltf.scene;
  const body = new THREE.Group();   // body yaw lives here, the head rotation in the shader
  body.add(model);
  scene.add(body);

  // normalize: feet on the floor, height 1, centred, facing the camera
  model.rotation.y = FACING;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const s = 1 / size.y;
  model.scale.setScalar(s);
  model.updateMatrixWorld(true);
  box.setFromObject(model);
  model.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  model.updateMatrixWorld(true);

  const uniforms = {
    uHead: { value: new THREE.Matrix3() },
    uPivot: { value: new THREE.Vector3() },
    uNeck: { value: new THREE.Vector2() },
  };
  const mesh = model.getObjectByProperty('type', 'Mesh') as THREE.Mesh;
  mesh.castShadow = true;
  // neck numbers in the mesh's own space (positions are quantized and scaled inside the GLB)
  mesh.geometry.computeBoundingBox();
  const gb = mesh.geometry.boundingBox!;
  const gh = gb.max.y - gb.min.y;
  uniforms.uNeck.value.set(gb.min.y + NECK.from * gh, gb.min.y + NECK.to * gh);
  uniforms.uPivot.value.set((gb.min.x + gb.max.x) / 2, gb.min.y + NECK.pivot * gh, (gb.min.z + gb.max.z) / 2);

  const softNeck = (shader: THREE.WebGLProgramParametersWithUniforms, normals: boolean) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = 'uniform mat3 uHead;\nuniform vec3 uPivot;\nuniform vec2 uNeck;\n' + shader.vertexShader;
    const weight = 'float headW = smoothstep(uNeck.x, uNeck.y, position.y);\n';
    if (normals) {
      shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>',
        weight + 'vec3 objectNormal = normalize(mix(vec3(normal), uHead * vec3(normal), headW));\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3(tangent.xyz);\n#endif');
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
        'vec3 transformed = mix(vec3(position), uHead * (vec3(position) - uPivot) + uPivot, headW);');
    } else {
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
        weight + 'vec3 transformed = mix(vec3(position), uHead * (vec3(position) - uPivot) + uPivot, headW);');
    }
  };
  // camera-space rotation -> mesh-local rotation (body is still at identity here)
  const fromLocal = new THREE.Matrix4().extractRotation(mesh.matrixWorld);
  const toLocal = fromLocal.clone().transpose();
  const mat = mesh.material as THREE.MeshStandardMaterial;
  mat.onBeforeCompile = (sh) => softNeck(sh, true);
  // the shadow must turn its head too
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (sh) => softNeck(sh, false);
  mesh.customDepthMaterial = depth;

  // ---- framing ----
  const frame = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // fit the full figure into ~78% of the height, a little above centre
    const fill = h > w ? 0.66 : 0.84;
    const dist = (1 / fill) / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    camera.position.set(0, 0.56, dist);
    camera.lookAt(0, 0.5, 0);
    camera.updateProjectionMatrix();
  };
  frame();
  new ResizeObserver(frame).observe(canvas);

  // ---- input ----
  let px = innerWidth / 2, py = innerHeight * 0.4, moved = false, lookUntil = 0;
  addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch') { px = e.clientX; py = e.clientY; moved = true; } }, { passive: true });
  addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') { px = e.clientX; py = e.clientY; lookUntil = performance.now() + 1800; } }, { passive: true });
  // phone: tilt (where it needs no permission prompt, i.e. not iOS) and scrolling
  let tilt: { x: number; y: number } | null = null;
  if (coarse && !(DeviceOrientationEvent as any).requestPermission) {
    addEventListener('deviceorientation', (e) => {
      if (e.gamma == null || e.beta == null) return;
      tilt = { x: Math.max(-1, Math.min(1, e.gamma / 25)), y: Math.max(-1, Math.min(1, (e.beta - 45) / 30)) };
    }, { passive: true });
  }
  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(root);

  // head position on screen, for aiming
  const headWorld = new THREE.Vector3(0, 0.78, 0);
  const headScreen = () => {
    const v = headWorld.clone().project(camera), r = canvas.getBoundingClientRect();
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
  };

  // ---- motion ----
  const S = { x: 0, y: 0, vx: 0, vy: 0 };
  const w0 = Math.sqrt(STIFF);
  let idle = { x: 0, y: 0 }, nextIdle = 0, prev = performance.now();
  const e = new THREE.Euler(), q = new THREE.Quaternion(), m4 = new THREE.Matrix4();

  const target = (now: number) => {
    const idleNow = coarse ? now > lookUntil : !moved;
    if (idleNow && coarse && scrollY > 24) return { x: 0, y: 0.8 };   // looks down at what you scroll to
    if (idleNow && tilt) return tilt;
    if (idleNow) {
      if (now > nextIdle) {
        idle = Math.random() < 0.35 ? { x: 0, y: 0 } : { x: (Math.random() * 2 - 1) * 0.7, y: (Math.random() * 2 - 1) * 0.4 };
        nextIdle = now + 2400 + Math.random() * 2600;
      }
      return idle;
    }
    const h = headScreen();
    const x = (px - h.x) / (innerWidth * 0.5), y = (py - h.y) / (innerHeight * 0.5);
    return { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
  };

  const tick = (now: number) => {
    requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
    if (!visible) return;
    const t = reduce ? { x: 0, y: 0 } : target(now);
    S.vx += (w0 * w0 * (t.x - S.x) - 2 * w0 * S.vx) * dt; S.x += S.vx * dt;
    S.vy += (w0 * w0 * (t.y - S.y) - 2 * w0 * S.vy) * dt; S.y += S.vy * dt;

    // head: yaw toward the cursor, pitch down when the cursor is below
    e.set(S.y * LOOK.pitch, S.x * LOOK.yaw, -S.x * 0.06, 'YXZ');
    q.setFromEuler(e);
    // the shader works in the mesh's own space (turned by FACING and the GLB's node transform)
    m4.makeRotationFromQuaternion(q).premultiply(toLocal).multiply(fromLocal);
    uniforms.uHead.value.setFromMatrix4(m4);

    // body: a little of the turn, plus slow breathing
    body.rotation.y = S.x * LOOK.bodyYaw;
    const breath = reduce ? 0 : Math.sin(now / 1000 * 1.6) * 0.004;
    body.scale.set(1 + breath * 0.5, 1 + breath, 1 + breath * 0.5);

    // the mint disc drifts the other way a little: depth without a second render
    hero?.style.setProperty('--dx', `${(-S.x * 14).toFixed(2)}px`);
    hero?.style.setProperty('--dy', `${(-S.y * 8).toFixed(2)}px`);

    renderer.render(scene, camera);
  };
  canvas.classList.add('on');
  requestAnimationFrame(tick);
}
