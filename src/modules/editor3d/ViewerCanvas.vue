<template>
  <div ref="containerRef" class="viewer-root">
    <canvas ref="canvasRef" class="viewer-canvas"></canvas>
    <div v-if="store.drawing.active" class="drawing-banner">轨道绘制中：点击场景以放置控制点。</div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch, computed } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useSceneStore } from '@/store/sceneStore';

const containerRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);

const store = useSceneStore();

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let controls: OrbitControls;
let animationHandle = 0;
let resizeObserver: ResizeObserver | null = null;
let cranePath: THREE.CurvePath<THREE.Vector3> | null = null;
let cranePathLength = 0;
let craneProgress = 0;

const rackGroup = new THREE.Group();
const trackGroup = new THREE.Group();
const previewGroup = new THREE.Group();
const agvPathGroup = new THREE.Group();
const craneCab = new THREE.Group();
const craneCabBody = new THREE.Mesh(
  new THREE.BoxGeometry(1.2, 0.6, 1.2),
  new THREE.MeshStandardMaterial({ color: 0xffc046, metalness: 0.2, roughness: 0.6 })
);
craneCab.add(craneCabBody);
const craneHook = new THREE.Mesh(
  new THREE.CylinderGeometry(0.08, 0.08, 1.4, 16),
  new THREE.MeshStandardMaterial({ color: 0x37474f, metalness: 0.3, roughness: 0.3 })
);
craneHook.position.set(0, -1.1, 0);
craneCab.add(craneHook);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const drawPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

const pendingPoints = computed(() => store.drawing.pendingPoints.map((point) => new THREE.Vector3(point.x, point.y, point.z)));

onMounted(() => {
  if (!canvasRef.value || !containerRef.value) return;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x060a12);

  camera = new THREE.PerspectiveCamera(52, 1, 0.1, 400);
  camera.position.set(22, 16, 24);

  renderer = new THREE.WebGLRenderer({ canvas: canvasRef.value, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(containerRef.value.clientWidth, containerRef.value.clientHeight);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 4, 0);
  controls.update();

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.65);
  keyLight.position.set(18, 26, 16);
  scene.add(keyLight);

  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x111b2d, roughness: 0.85, metalness: 0.05 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.01;
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(160, 80, 0x334461, 0x1b2a41);
  grid.position.y = 0.002;
  scene.add(grid);

  scene.add(rackGroup);
  scene.add(trackGroup);
  scene.add(previewGroup);
  scene.add(agvPathGroup);
  scene.add(craneCab);

  canvasRef.value.addEventListener('pointerdown', handlePointerDown);

  resizeObserver = new ResizeObserver(() => {
    if (!renderer || !canvasRef.value || !containerRef.value) return;
    const { clientWidth, clientHeight } = containerRef.value;
    renderer.setSize(clientWidth, clientHeight);
    camera.aspect = clientWidth / Math.max(clientHeight, 1);
    camera.updateProjectionMatrix();
  });
  resizeObserver.observe(containerRef.value);

  startAnimationLoop();
  rebuildRacks();
  rebuildTrack();
  rebuildPreview();
  updateDrawPlane();
});

onUnmounted(() => {
  stopAnimationLoop();
  resizeObserver?.disconnect();
  if (canvasRef.value) {
    canvasRef.value.removeEventListener('pointerdown', handlePointerDown);
  }
  renderer?.dispose();
});

watch(
  () => ({ ...store.rackParams }),
  () => {
    rebuildRacks();
    updateDrawPlane();
  },
  { deep: true }
);

watch(
  () => store.crane.segments.map((segment) => JSON.stringify(segment)),
  () => {
    rebuildTrack();
    rebuildPreview();
  }
);

watch(
  () => store.drawing.pendingPoints.map((point) => JSON.stringify(point)),
  () => {
    rebuildPreview();
  }
);

watch(
  () => store.drawing.active,
  (active) => {
    if (controls) {
      controls.enabled = !active;
    }
  }
);

watch(
  () => store.trackPlaneHeight,
  () => {
    updateDrawPlane();
  }
);

function startAnimationLoop() {
  if (!renderer) return;
  const clock = new THREE.Clock();

  const animate = () => {
    animationHandle = requestAnimationFrame(animate);
    const delta = clock.getDelta();
    updateCrane(delta);
    controls?.update();
    renderer?.render(scene, camera);
  };

  animate();
}

function stopAnimationLoop() {
  if (animationHandle) {
    cancelAnimationFrame(animationHandle);
    animationHandle = 0;
  }
}

function rebuildRacks() {
  disposeGroup(rackGroup);

  const params = store.rackParams;
  const binGeo = new THREE.BoxGeometry(params.binWidth, params.layerHeight * 0.8, params.binDepth);
  const material = new THREE.MeshStandardMaterial({ color: 0x1e88e5, metalness: 0.15, roughness: 0.6 });

  const totalWidth = (params.columns - 1) * params.bayWidth + params.binWidth;
  const totalDepth = (params.rows - 1) * params.aisleWidth + params.binDepth;
  const offsetX = -totalWidth / 2;
  const offsetZ = -totalDepth / 2;

  for (let row = 0; row < params.rows; row += 1) {
    for (let col = 0; col < params.columns; col += 1) {
      for (let level = 0; level < params.levels; level += 1) {
        const mesh = new THREE.Mesh(binGeo.clone(), material.clone());
        mesh.position.set(
          offsetX + col * params.bayWidth,
          params.layerHeight * level + params.layerHeight * 0.5,
          offsetZ + row * params.aisleWidth
        );
        rackGroup.add(mesh);
      }
    }
  }

  binGeo.dispose();
  material.dispose();
}

function rebuildTrack() {
  disposeGroup(trackGroup);
  cranePath = null;
  cranePathLength = 0;
  craneProgress = 0;

  const segments = store.crane.segments;
  if (!segments.length) {
    craneCab.visible = false;
    return;
  }

  craneCab.visible = true;
  cranePath = new THREE.CurvePath<THREE.Vector3>();

  segments.forEach((segment) => {
    const curve = new THREE.CubicBezierCurve3(
      new THREE.Vector3(segment.p0.x, segment.p0.y, segment.p0.z),
      new THREE.Vector3(segment.p1.x, segment.p1.y, segment.p1.z),
      new THREE.Vector3(segment.p2.x, segment.p2.y, segment.p2.z),
      new THREE.Vector3(segment.p3.x, segment.p3.y, segment.p3.z)
    );
    cranePath?.add(curve);

    const geometry = new THREE.TubeGeometry(curve, 48, 0.12, 12, false);
    const material = new THREE.MeshStandardMaterial({ color: 0xff7043, metalness: 0.25, roughness: 0.4 });
    const mesh = new THREE.Mesh(geometry, material);
    trackGroup.add(mesh);

    const guideMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 });
    const lineGeometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(40));
    const line = new THREE.Line(lineGeometry, guideMaterial);
    trackGroup.add(line);
  });

  const lengths = cranePath.getCurveLengths();
  cranePathLength = lengths[lengths.length - 1] || 0;
}

function rebuildPreview() {
  disposeGroup(previewGroup);

  const points = pendingPoints.value;
  if (!points.length) return;

  const markerGeometry = new THREE.SphereGeometry(0.16, 18, 18);
  points.forEach((point, index) => {
    const color = index === 0 ? 0x26c6da : 0xffb74d;
    const marker = new THREE.Mesh(markerGeometry, new THREE.MeshBasicMaterial({ color }));
    marker.position.copy(point);
    previewGroup.add(marker);
  });

  if (points.length >= 2) {
    const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
    const dashed = new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.6, gapSize: 0.25, opacity: 0.85, transparent: true });
    const line = new THREE.Line(lineGeometry, dashed);
    line.computeLineDistances();
    previewGroup.add(line);
  }
}

function updateCrane(delta: number) {
  if (!cranePath || cranePathLength <= 0) return;

  craneProgress += (store.crane.speed * delta) / cranePathLength;
  craneProgress %= 1;

  const point = cranePath.getPointAt(craneProgress);
  const tangent = cranePath.getTangentAt(craneProgress).normalize();
  craneCab.position.copy(point);

  const lookTarget = point.clone().add(tangent);
  craneCab.lookAt(lookTarget);
}

function handlePointerDown(event: PointerEvent) {
  if (!store.drawing.active || event.button !== 0) return;
  if (!renderer || !canvasRef.value) return;

  const rect = canvasRef.value.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  const intersection = new THREE.Vector3();
  const hit = raycaster.ray.intersectPlane(drawPlane, intersection);
  if (!hit) return;

  store.addTrackPoint(intersection.clone());
}

function updateDrawPlane() {
  drawPlane.set(new THREE.Vector3(0, 1, 0), -store.trackPlaneHeight);
}

function disposeGroup(group: THREE.Group) {
  group.children.forEach((child) => {
    if ((child as THREE.Mesh).geometry) {
      (child as THREE.Mesh).geometry.dispose();
    }
    if ((child as THREE.Mesh).material) {
      const material = (child as THREE.Mesh).material;
      if (Array.isArray(material)) {
        material.forEach((mat) => mat.dispose());
      } else if (material && 'dispose' in material) {
        material.dispose();
      }
    }
  });
  group.clear();
}
</script>

<style scoped>
.viewer-root {
  position: relative;
  width: 100%;
  height: 100%;
}

.viewer-canvas {
  width: 100%;
  height: 100%;
  display: block;
}

.drawing-banner {
  position: absolute;
  top: 16px;
  left: 16px;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(38, 198, 218, 0.16);
  color: #a5f2ff;
  font-size: 12px;
  letter-spacing: 0.02em;
  backdrop-filter: blur(6px);
}
</style>
