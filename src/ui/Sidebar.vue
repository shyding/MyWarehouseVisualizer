<template>
  <div class="sidebar">
    <section class="panel">
      <h2 class="panel-title">货架设置</h2>
      <el-form label-width="120px" size="small" label-position="top" class="panel-form">
        <el-form-item label="仓库行数">
          <el-input-number v-model="rack.rows" :min="1" :max="40" @change="onRackRowsChange" />
        </el-form-item>
        <el-form-item label="仓库列数">
          <el-input-number v-model="rack.columns" :min="1" :max="40" @change="onRackColumnsChange" />
        </el-form-item>
        <el-form-item label="货架层数">
          <el-input-number v-model="rack.levels" :min="1" :max="12" @change="onRackLevelsChange" />
        </el-form-item>
        <el-form-item label="显示仓位编号">
          <el-switch v-model="rack.showLabels" @change="onShowLabelsChange" />
        </el-form-item>
      </el-form>
    </section>

    <section class="panel">
      <h2 class="panel-title">天车轨道</h2>
      <div class="panel-actions">
        <el-button type="primary" :disabled="store.drawing.active" @click="store.startTrackDrawing">
          开始绘制轨道
        </el-button>
        <el-button type="success" :disabled="!store.drawing.active" @click="store.finishTrackDrawing">
          完成绘制
        </el-button>
      </div>
      <div class="panel-actions">
        <el-button :disabled="!store.canUndo" @click="store.undoTrackPoint">撤销</el-button>
        <el-button type="danger" :disabled="!store.canClear" @click="store.clearTrack">清空轨道</el-button>
      </div>
      <p class="panel-status">{{ statusMessage }}</p>
      <div class="track-summary" v-if="segmentSummaries.length">
        <div class="track-segment" v-for="summary in segmentSummaries" :key="summary.id">
          <header>
            <span>贝塞尔段 {{ summary.index }}</span>
            <span class="segment-length">{{ formatLength(summary.length) }}</span>
          </header>
          <dl>
            <dt>起点</dt>
            <dd>{{ formatPoint(summary.segment.p0) }}</dd>
            <dt>控制点 1</dt>
            <dd>{{ formatPoint(summary.segment.p1) }}</dd>
            <dt>控制点 2</dt>
            <dd>{{ formatPoint(summary.segment.p2) }}</dd>
            <dt>终点</dt>
            <dd>{{ formatPoint(summary.segment.p3) }}</dd>
          </dl>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import * as THREE from 'three';
import { computed, reactive } from 'vue';
import { storeToRefs } from 'pinia';
import { useSceneStore } from '@/store/sceneStore';

const store = useSceneStore();
const { rackParams, crane } = storeToRefs(store);

const rack = reactive({
  get rows() {
    return rackParams.value.rows;
  },
  set rows(value: number) {
    store.setRackRows(value);
  },
  get columns() {
    return rackParams.value.columns;
  },
  set columns(value: number) {
    store.setRackColumns(value);
  },
  get levels() {
    return rackParams.value.levels;
  },
  set levels(value: number) {
    store.setRackLevels(value);
  },
  get showLabels() {
    return rackParams.value.showLabels;
  },
  set showLabels(value: boolean) {
    store.setShowLabels(value);
  }
});

const segments = computed(() => crane.value.segments);

const segmentSummaries = computed(() =>
  segments.value.map((segment, index) => {
    const curve = new THREE.CubicBezierCurve3(
      new THREE.Vector3(segment.p0.x, segment.p0.y, segment.p0.z),
      new THREE.Vector3(segment.p1.x, segment.p1.y, segment.p1.z),
      new THREE.Vector3(segment.p2.x, segment.p2.y, segment.p2.z),
      new THREE.Vector3(segment.p3.x, segment.p3.y, segment.p3.z)
    );
    return {
      id: segment.id,
      index: index + 1,
      length: curve.getLength(),
      segment
    };
  })
);

const statusMessage = computed(() => store.lastStatus || store.trackStatusMessage);

function onRackRowsChange(value: number | undefined) {
  if (typeof value === 'number') rack.rows = value;
}

function onRackColumnsChange(value: number | undefined) {
  if (typeof value === 'number') rack.columns = value;
}

function onRackLevelsChange(value: number | undefined) {
  if (typeof value === 'number') rack.levels = value;
}

function onShowLabelsChange(value: boolean) {
  rack.showLabels = value;
}

function formatPoint(point: { x: number; y: number; z: number }): string {
  return `(${point.x.toFixed(2)}, ${point.y.toFixed(2)}, ${point.z.toFixed(2)})`;
}

function formatLength(length: number): string {
  return `${length.toFixed(2)}m`;
}
</script>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 24px 24px 48px;
  font-size: 13px;
}

.panel-title {
  margin: 0 0 16px;
  font-size: 16px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
}

.panel {
  background: rgba(8, 14, 24, 0.65);
  border-radius: 12px;
  padding: 20px 18px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 12px 24px rgba(0, 0, 0, 0.35);
}

.panel-form :deep(.el-form-item) {
  margin-bottom: 14px;
}

.panel-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.panel-status {
  margin: 0 0 12px;
  color: rgba(255, 255, 255, 0.72);
  line-height: 1.5;
}

.track-summary {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.track-segment {
  background: rgba(18, 24, 36, 0.86);
  border-radius: 10px;
  padding: 12px 14px;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.track-segment header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
}

.track-segment dl {
  display: grid;
  grid-template-columns: 80px 1fr;
  row-gap: 6px;
  column-gap: 12px;
  margin: 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.75);
}

.track-segment dt {
  color: rgba(255, 255, 255, 0.6);
}

.segment-length {
  color: rgba(143, 215, 255, 0.85);
}
</style>
