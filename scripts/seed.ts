#!/usr/bin/env ts-node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const CTRL_FACTOR = 0.5522847498307936;

const PROFILE_CONFIG = {
  small: {
    rackGrid: { rows: 5, cols: 8 },
    rackSpec: { rows: 2, columns: 4, levels: 3, bayWidth: 1.2, aisleWidth: 2.4, layerHeight: 1.2, binWidth: 1.1, binDepth: 1.2 },
    rackSpacing: { x: 5.5, z: 7 },
    zoneGrid: { rows: 2, cols: 2 },
    track: { loops: 2, height: 7.5, spacing: 3.5, dualOffset: 0.3 },
    agvGrid: { rows: 12, cols: 16, spacingX: 4.5, spacingZ: 4.5, speedLimit: 2.2 },
    agvCount: 5,
    craneCount: 1
  },
  medium: {
    rackGrid: { rows: 16, cols: 24 },
    rackSpec: { rows: 3, columns: 5, levels: 4, bayWidth: 1.25, aisleWidth: 2.6, layerHeight: 1.25, binWidth: 1.15, binDepth: 1.3 },
    rackSpacing: { x: 6.2, z: 8.4 },
    zoneGrid: { rows: 3, cols: 3 },
    track: { loops: 3, height: 8.2, spacing: 4.5, dualOffset: 0.32 },
    agvGrid: { rows: 28, cols: 36, spacingX: 4.8, spacingZ: 4.8, speedLimit: 1.9 },
    agvCount: 16,
    craneCount: 3
  },
  large: {
    rackGrid: { rows: 36, cols: 36 },
    rackSpec: { rows: 4, columns: 6, levels: 5, bayWidth: 1.3, aisleWidth: 2.8, layerHeight: 1.35, binWidth: 1.2, binDepth: 1.35 },
    rackSpacing: { x: 7.2, z: 9.6 },
    zoneGrid: { rows: 4, cols: 4 },
    track: { loops: 4, height: 9.5, spacing: 5.5, dualOffset: 0.35 },
    agvGrid: { rows: 52, cols: 60, spacingX: 5.2, spacingZ: 5.2, speedLimit: 1.6 },
    agvCount: 40,
    craneCount: 8
  }
} as const;

type Profile = keyof typeof PROFILE_CONFIG;
type ProfileConfig = (typeof PROFILE_CONFIG)[Profile];

type Vec3 = [number, number, number];

interface SceneObject {
  type: string;
  [key: string]: unknown;
}

interface Scene {
  sceneId: string;
  name: string;
  units: { length: string };
  objects: SceneObject[];
  graphs: { overhead: Graph; ground: Graph };
  meta: { createdAt: string; updatedAt: string; version: string };
}

interface GraphNode {
  id: string;
  pos: Vec3;
}

interface GraphEdge {
  id: string;
  from: string;
  to: string;
  geom: unknown;
  limits: { speed: number };
  length: number;
}

interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface GenerationResult {
  scene: Scene;
  slotsCsv: string;
}

interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function assertProfile(value: string): value is Profile {
  return value === 'small' || value === 'medium' || value === 'large';
}

function createRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function interpolate(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function generateScene(profile: Profile, seed: number): GenerationResult {
  const config = PROFILE_CONFIG[profile];
  const rng = createRng(seed);
  const now = new Date().toISOString();
  const bounds: Bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  const sceneObjects: SceneObject[] = [];

  const rackEntries = generateRacks(config, rng, bounds);
  sceneObjects.push(...rackEntries.objects);

  const zones = generateZones(config, bounds);
  sceneObjects.push(...zones);

  const tracks = generateTracks(config, bounds);
  sceneObjects.push(...tracks.objects);

  const overheadGraph = buildOverheadGraph(tracks.segments);
  const groundGraph = buildGroundGraph(config, bounds, rng);

  const vehicles = generateVehicles(config, bounds, rng);
  sceneObjects.push(...vehicles);

  const scene: Scene = {
    sceneId: `scene-${profile}-${seed}`,
    name: `${capitalize(profile)} Profile ${seed}`,
    units: { length: 'm' },
    objects: sceneObjects,
    graphs: {
      overhead: overheadGraph,
      ground: groundGraph
    },
    meta: {
      createdAt: now,
      updatedAt: now,
      version: '1.0'
    }
  };

  const slotsCsv = buildSlotsCsv(rackEntries.objects);

  return { scene, slotsCsv };
}

function generateRacks(config: ProfileConfig, rng: () => number, bounds: Bounds) {
  const { rackGrid, rackSpec, rackSpacing, zoneGrid } = config;
  const racks: SceneObject[] = [];
  const width = rackSpec.binWidth + (rackSpec.columns - 1) * rackSpec.bayWidth;
  const depth = rackSpec.binDepth + (rackSpec.rows - 1) * rackSpec.aisleWidth;
  const height = rackSpec.levels * rackSpec.layerHeight;
  const pitchX = width + rackSpacing.x;
  const pitchZ = depth + rackSpacing.z;
  const originX = -((rackGrid.cols - 1) * pitchX) / 2;
  const originZ = -((rackGrid.rows - 1) * pitchZ) / 2;

  for (let row = 0; row < rackGrid.rows; row += 1) {
    for (let col = 0; col < rackGrid.cols; col += 1) {
      const id = `rack-${row}-${col}`;
      const jitterX = (rng() - 0.5) * 0.25;
      const jitterZ = (rng() - 0.5) * 0.25;
      const x = originX + col * pitchX + jitterX;
      const z = originZ + row * pitchZ + jitterZ;
      const zoneRow = Math.floor((row / rackGrid.rows) * zoneGrid.rows);
      const zoneCol = Math.floor((col / rackGrid.cols) * zoneGrid.cols);
      const zoneId = `zone-${zoneRow}-${zoneCol}`;

      bounds.minX = Math.min(bounds.minX, x - width / 2 - 2);
      bounds.maxX = Math.max(bounds.maxX, x + width / 2 + 2);
      bounds.minZ = Math.min(bounds.minZ, z - depth / 2 - 2);
      bounds.maxZ = Math.max(bounds.maxZ, z + depth / 2 + 2);

      racks.push({
        type: 'rack',
        id,
        position: [Number(x.toFixed(3)), 0, Number(z.toFixed(3))],
        rotation: [0, 0, 0],
        params: {
          ...rackSpec,
          size: { x: Number(width.toFixed(3)), y: Number(height.toFixed(3)), z: Number(depth.toFixed(3)) },
          numbering: {
            template: `${zoneId}-${id}-R{row:02}-C{col:02}-L{layer}`,
            order: { row: 'L2R', col: 'L2R', layer: 'B2T' }
          }
        },
        zoneId
      });
    }
  }

  return { objects: racks };
}

function generateZones(config: ProfileConfig, bounds: Bounds): SceneObject[] {
  const { zoneGrid } = config;
  const zones: SceneObject[] = [];
  const width = bounds.maxX - bounds.minX;
  const depth = bounds.maxZ - bounds.minZ;

  for (let row = 0; row < zoneGrid.rows; row += 1) {
    for (let col = 0; col < zoneGrid.cols; col += 1) {
      const id = `zone-${row}-${col}`;
      const minX = bounds.minX + (width / zoneGrid.cols) * col;
      const maxX = bounds.minX + (width / zoneGrid.cols) * (col + 1);
      const minZ = bounds.minZ + (depth / zoneGrid.rows) * row;
      const maxZ = bounds.minZ + (depth / zoneGrid.rows) * (row + 1);
      zones.push({
        type: 'zone',
        id,
        name: `Zone ${String.fromCharCode(65 + row * zoneGrid.cols + col)}`,
        polygon: [
          [round3(minX), 0, round3(minZ)],
          [round3(maxX), 0, round3(minZ)],
          [round3(maxX), 0, round3(maxZ)],
          [round3(minX), 0, round3(maxZ)]
        ],
        policies: {
          agv: (row + col) % 2 === 0 ? 'normal' : 'limit',
          speedLimit: round3(interpolate(1.2, 2.2, (row + col) / (zoneGrid.rows + zoneGrid.cols))),
          priority: zoneGrid.rows * zoneGrid.cols - (row * zoneGrid.cols + col)
        }
      });
    }
  }

  return zones;
}

function generateTracks(config: ProfileConfig, bounds: Bounds) {
  const { track } = config;
  const tracks: TrackBuildResult = { objects: [], segments: [] };
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  const halfWidth = (bounds.maxX - bounds.minX) / 2 + 6;
  const halfDepth = (bounds.maxZ - bounds.minZ) / 2 + 6;

  let segmentIndex = 0;
  for (let loopIndex = 0; loopIndex < track.loops; loopIndex += 1) {
    const offset = loopIndex * track.spacing;
    const radiusX = halfWidth + offset;
    const radiusZ = halfDepth + offset * 0.85;
    const segments: TrackSegmentDefinition[] = [];
    for (let quarter = 0; quarter < 4; quarter += 1) {
      const startAngle = (Math.PI / 2) * quarter;
      const endAngle = startAngle + Math.PI / 2;
      const p0 = pointOnEllipse(centerX, centerZ, radiusX, radiusZ, startAngle, track.height);
      const p3 = pointOnEllipse(centerX, centerZ, radiusX, radiusZ, endAngle, track.height);
      const p1 = controlPointForArc(p0, startAngle, radiusX, radiusZ, true, track.height);
      const p2 = controlPointForArc(p3, endAngle, radiusX, radiusZ, false, track.height);
      const segment: TrackSegmentDefinition = {
        id: `seg-${loopIndex}-${quarter}`,
        kind: 'cubic-bezier-3d',
        p0,
        p1,
        p2,
        p3,
        constraints: { c1Locked: true, height: track.height }
      };
      segments.push(segment);
      tracks.segments.push({ trackId: `track-${loopIndex}`, segment });
      segmentIndex += 1;
    }
    tracks.objects.push({
      type: 'track',
      id: `track-${loopIndex}`,
      layer: 'overhead-rail',
      segments,
      dualRail: { offset: track.dualOffset },
      nodes: [],
      materialId: 'steel-rail'
    });
  }

  return tracks;
}

interface TrackSegmentDefinition {
  id: string;
  kind: string;
  p0: Vec3;
  p1: Vec3;
  p2: Vec3;
  p3: Vec3;
  constraints: { c1Locked: boolean; height: number };
}

interface TrackSegment {
  trackId: string;
  segment: TrackSegmentDefinition;
}

interface TrackBuildResult {
  objects: SceneObject[];
  segments: TrackSegment[];
}

function buildOverheadGraph(segments: TrackSegment[]) {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  let edgeIndex = 0;

  for (const { trackId, segment } of segments) {
    const startId = `${trackId}-n-${segment.id}-start`;
    const endId = `${trackId}-n-${segment.id}-end`;
    if (!nodes.has(startId)) {
      nodes.set(startId, { id: startId, pos: segment.p0 });
    }
    if (!nodes.has(endId)) {
      nodes.set(endId, { id: endId, pos: segment.p3 });
    }
    const nextSegment = findNextSegment(segments, trackId, segment.id);
    const nextStartId = `${nextSegment.trackId}-n-${nextSegment.segment.id}-start`;
    edges.push({
      id: `overhead-edge-${edgeIndex++}`,
      from: startId,
      to: endId,
      geom: {
        type: 'cubic-bezier-3d',
        p0: segment.p0,
        p1: segment.p1,
        p2: segment.p2,
        p3: segment.p3
      },
      limits: { speed: 2.5 },
      length: arcLengthApprox(segment.p0, segment.p1, segment.p2, segment.p3)
    });
    if (endId !== nextStartId) {
      const nextStartPos = nextSegment.segment.p0;
      edges.push({
        id: `overhead-edge-${edgeIndex++}`,
        from: endId,
        to: nextStartId,
        geom: { type: 'link' },
        limits: { speed: 2.5 },
        length: round3(distance(segment.p3, nextStartPos))
      });
    }
  }

  return { nodes: Array.from(nodes.values()), edges };
}

function findNextSegment(segments: TrackSegment[], trackId: string, segmentId: string) {
  const belonging = segments.filter((entry) => entry.trackId === trackId);
  const index = belonging.findIndex((entry) => entry.segment.id === segmentId);
  if (index < 0) {
    return belonging[0];
  }
  return belonging[(index + 1) % belonging.length];
}

function buildGroundGraph(config: ProfileConfig, bounds: Bounds, rng: () => number): Graph {
  const { agvGrid } = config;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  let nodeIndex = 0;
  let edgeIndex = 0;
  const startX = bounds.minX - agvGrid.spacingX * 1.5;
  const startZ = bounds.minZ - agvGrid.spacingZ * 1.5;

  for (let row = 0; row < agvGrid.rows; row += 1) {
    for (let col = 0; col < agvGrid.cols; col += 1) {
      const id = `g-n-${nodeIndex++}`;
      nodes.push({ id, pos: [round3(startX + col * agvGrid.spacingX), 0, round3(startZ + row * agvGrid.spacingZ)] });
    }
  }

  const indexAt = (row: number, col: number) => row * agvGrid.cols + col;

  for (let row = 0; row < agvGrid.rows; row += 1) {
    for (let col = 0; col < agvGrid.cols; col += 1) {
      const current = nodes[indexAt(row, col)];
      if (!current) continue;
      if (col + 1 < agvGrid.cols) {
        const next = nodes[indexAt(row, col + 1)];
        edges.push(makeEdge(`g-e-${edgeIndex++}`, current, next, agvGrid.speedLimit, rng));
      }
      if (row + 1 < agvGrid.rows) {
        const next = nodes[indexAt(row + 1, col)];
        edges.push(makeEdge(`g-e-${edgeIndex++}`, current, next, agvGrid.speedLimit, rng));
      }
    }
  }

  return { nodes, edges };
}

function makeEdge(id: string, from: GraphNode, to: GraphNode, speedLimit: number, rng: () => number): GraphEdge {
  const length = distance(from.pos, to.pos);
  const jitter = 0.8 + rng() * 0.4;
  return {
    id,
    from: from.id,
    to: to.id,
    geom: { type: 'line', points: [from.pos, to.pos] },
    limits: { speed: round3(speedLimit * jitter) },
    length: round3(length)
  };
}

function generateVehicles(config: ProfileConfig, bounds: Bounds, rng: () => number): SceneObject[] {
  const vehicles: SceneObject[] = [];
  const { agvCount, craneCount, track } = config;
  const width = bounds.maxX - bounds.minX;
  const depth = bounds.maxZ - bounds.minZ;

  for (let i = 0; i < agvCount; i += 1) {
    const x = interpolate(bounds.minX, bounds.maxX, rng());
    const z = interpolate(bounds.minZ, bounds.maxZ, rng());
    vehicles.push({
      type: 'vehicle',
      id: `agv-${i + 1}`,
      vehicleType: 'AGV',
      dims: { l: 1.4, w: 0.95, h: 0.8, turnRadius: 1.6 },
      speed: { max: round3(1.4 + rng() * 0.6) },
      routeGraph: 'ground',
      startNode: `g-n-${Math.floor(rng() * config.agvGrid.rows * config.agvGrid.cols)}`,
      pose: [round3(x), 0, round3(z)]
    });
  }

  for (let i = 0; i < craneCount; i += 1) {
    const angle = (2 * Math.PI * i) / craneCount;
    const radius = Math.min(width, depth) / 6;
    vehicles.push({
      type: 'vehicle',
      id: `crane-${i + 1}`,
      vehicleType: 'Crane',
      dims: { l: 4.5, w: 3.6, h: 3.2, turnRadius: 0 },
      speed: { max: 2.5 },
      routeGraph: 'overhead',
      startNode: `track-0-n-seg-0-0-start`,
      pose: [
        round3((bounds.minX + bounds.maxX) / 2 + radius * Math.cos(angle)),
        track.height,
        round3((bounds.minZ + bounds.maxZ) / 2 + radius * Math.sin(angle))
      ]
    });
  }

  return vehicles;
}

function buildSlotsCsv(racks: SceneObject[]): string {
  const lines = ['code,rackId,row,col,layer,x,y,z,zone'];
  for (const rack of racks) {
    if (rack.type !== 'rack') continue;
    const params = rack.params as Record<string, number>;
    const rackId = rack.id as string;
    const zoneId = (rack.zoneId as string) ?? '';
    const width = params.binWidth + (params.columns - 1) * params.bayWidth;
    const depth = params.binDepth + (params.rows - 1) * params.aisleWidth;
    for (let row = 0; row < params.rows; row += 1) {
      for (let col = 0; col < params.columns; col += 1) {
        for (let layer = 0; layer < params.levels; layer += 1) {
          const localX = -width / 2 + col * params.bayWidth + params.binWidth / 2;
          const localZ = -depth / 2 + row * params.aisleWidth + params.binDepth / 2;
          const x = (rack.position as Vec3)[0] + localX;
          const y = layer * params.layerHeight + params.layerHeight / 2;
          const z = (rack.position as Vec3)[2] + localZ;
          const code = `${zoneId}-${rackId}-R${String(row + 1).padStart(2, '0')}-C${String(col + 1).padStart(2, '0')}-L${layer + 1}`;
          lines.push([code, rackId, row + 1, col + 1, layer + 1, round3(x), round3(y), round3(z), zoneId].join(','));
        }
      }
    }
  }
  return lines.join('\n');
}

function pointOnEllipse(centerX: number, centerZ: number, radiusX: number, radiusZ: number, angle: number, height: number): Vec3 {
  return [round3(centerX + radiusX * Math.cos(angle)), round3(height), round3(centerZ + radiusZ * Math.sin(angle))];
}

function controlPointForArc(point: Vec3, angle: number, radiusX: number, radiusZ: number, leading: boolean, height: number): Vec3 {
  const tangentX = -Math.sin(angle) * radiusX;
  const tangentZ = Math.cos(angle) * radiusZ;
  const scale = CTRL_FACTOR;
  const direction = leading ? 1 : -1;
  return [round3(point[0] + tangentX * scale * direction), round3(height), round3(point[2] + tangentZ * scale * direction)];
}

function arcLengthApprox(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3): number {
  const steps = 32;
  let length = 0;
  let prev = p0;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const point = cubicBezierPoint(p0, p1, p2, p3, t);
    length += distance(prev, point);
    prev = point;
  }
  return round3(length);
}

function cubicBezierPoint(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;
  const x = uuu * p0[0] + 3 * uu * t * p1[0] + 3 * u * tt * p2[0] + ttt * p3[0];
  const y = uuu * p0[1] + 3 * uu * t * p1[1] + 3 * u * tt * p2[1] + ttt * p3[1];
  const z = uuu * p0[2] + 3 * uu * t * p1[2] + 3 * u * tt * p2[2] + ttt * p3[2];
  return [round3(x), round3(y), round3(z)];
}

function distance(a: Vec3, b: Vec3): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

async function main() {
  const profileArg = process.argv[2];
  if (!profileArg || !assertProfile(profileArg)) {
    console.error('请提供要生成的数据集档位：small | medium | large');
    process.exit(1);
  }

  const seedArg = process.argv[3];
  const seed = Number.isFinite(Number(seedArg)) ? Number(seedArg) : 2024;
  const { scene, slotsCsv } = generateScene(profileArg, seed);
  const outDir = path.join(process.cwd(), 'datasets', profileArg);
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, 'scene.json'), JSON.stringify(scene, null, 2));
  await fs.writeFile(path.join(outDir, 'topology.overhead.json'), JSON.stringify(scene.graphs.overhead, null, 2));
  await fs.writeFile(path.join(outDir, 'topology.ground.json'), JSON.stringify(scene.graphs.ground, null, 2));
  await fs.writeFile(path.join(outDir, 'slots.csv'), slotsCsv);
  console.log(`✅ 已生成 ${profileArg} 数据集（seed=${seed}）`);
  console.log(`  objects: ${scene.objects.length}`);
  console.log(`  racks: ${scene.objects.filter((obj) => obj.type === 'rack').length}`);
  console.log(`  track segments: ${scene.objects.filter((obj) => obj.type === 'track').reduce((sum, obj) => sum + (obj.segments as unknown[]).length, 0)}`);
  console.log(`  agv nodes: ${scene.graphs.ground.nodes.length}`);
}

void main();
