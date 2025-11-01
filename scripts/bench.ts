#!/usr/bin/env ts-node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const PROFILES = ['small', 'medium', 'large'] as const;

type Profile = (typeof PROFILES)[number];

interface BenchmarkEntry {
  profile: Profile;
  objects: number;
  racks: number;
  trackSegments: number;
  agvNodes: number;
  agvEdges: number;
  vehicles: number;
  slotCount: number;
  sceneSizeKB: number;
}

async function main() {
  const baseDir = process.cwd();
  const entries: BenchmarkEntry[] = [];

  for (const profile of PROFILES) {
    const datasetDir = path.join(baseDir, 'datasets', profile);
    const scenePath = path.join(datasetDir, 'scene.json');
    try {
      const sceneRaw = await fs.readFile(scenePath, 'utf-8');
      const scene = JSON.parse(sceneRaw);
      const slotCsv = await readSlotCsv(datasetDir);
      const entry: BenchmarkEntry = {
        profile,
        objects: Array.isArray(scene.objects) ? scene.objects.length : 0,
        racks: countByType(scene.objects, 'rack'),
        trackSegments: sumTrackSegments(scene.objects),
        agvNodes: scene.graphs?.ground?.nodes?.length ?? 0,
        agvEdges: scene.graphs?.ground?.edges?.length ?? 0,
        vehicles: countByType(scene.objects, 'vehicle'),
        slotCount: Math.max(slotCsv.length - 1, 0),
        sceneSizeKB: Math.round((sceneRaw.length / 1024) * 100) / 100
      };
      entries.push(entry);
      reportEntry(entry);
    } catch (error) {
      console.warn(`⚠️  无法读取 ${profile} 数据集：${(error as Error).message}`);
    }
  }

  if (entries.length === 0) {
    console.error('未能加载任何数据集，请先运行 npm run seed:* 命令生成数据。');
    process.exit(1);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    entries
  };

  const outDir = path.join(baseDir, 'benchmarks');
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, 'latest.json'), JSON.stringify(report, null, 2));
  console.log(`\n✅ 已输出 benchmarks/latest.json`);
}

async function readSlotCsv(datasetDir: string): Promise<string[]> {
  try {
    const csvPath = path.join(datasetDir, 'slots.csv');
    const raw = await fs.readFile(csvPath, 'utf-8');
    return raw.trim().split(/\r?\n/);
  } catch {
    return [];
  }
}

function countByType(objects: unknown[], type: string): number {
  if (!Array.isArray(objects)) return 0;
  return objects.filter((obj) => typeof obj === 'object' && obj !== null && (obj as { type?: string }).type === type).length;
}

function sumTrackSegments(objects: unknown[]): number {
  if (!Array.isArray(objects)) return 0;
  return objects
    .filter((obj) => typeof obj === 'object' && obj !== null && (obj as { type?: string }).type === 'track')
    .reduce((total, obj) => {
      const segments = (obj as { segments?: unknown[] }).segments;
      return total + (Array.isArray(segments) ? segments.length : 0);
    }, 0);
}

function reportEntry(entry: BenchmarkEntry) {
  console.log(`\n📊 ${entry.profile.toUpperCase()} 数据集统计`);
  console.log(`  对象数: ${entry.objects}`);
  console.log(`  货架: ${entry.racks}`);
  console.log(`  轨道段: ${entry.trackSegments}`);
  console.log(`  AGV 图节点/边: ${entry.agvNodes}/${entry.agvEdges}`);
  console.log(`  车辆: ${entry.vehicles}`);
  console.log(`  仓位总数: ${entry.slotCount}`);
  console.log(`  scene.json 大小: ${entry.sceneSizeKB} KB`);
}

void main();
