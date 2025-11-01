import { defineStore } from 'pinia';
import type { Vector3 } from 'three';

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export interface TrackSegment {
  id: string;
  p0: Vector3Like;
  p1: Vector3Like;
  p2: Vector3Like;
  p3: Vector3Like;
}

export interface RackParams {
  rows: number;
  columns: number;
  levels: number;
  bayWidth: number;
  aisleWidth: number;
  layerHeight: number;
  binWidth: number;
  binDepth: number;
  showLabels: boolean;
}

export const useSceneStore = defineStore('scene', {
  state: () => ({
    rackParams: {
      rows: 3,
      columns: 5,
      levels: 3,
      bayWidth: 1.8,
      aisleWidth: 3.0,
      layerHeight: 1.2,
      binWidth: 1.2,
      binDepth: 1.1,
      showLabels: true
    } as RackParams,
    crane: {
      progress: 0,
      speed: 0.2,
      heightOffset: 0.6,
      segments: [] as TrackSegment[]
    },
    agv: {
      speed: 0.6
    },
    drawing: {
      active: false,
      pendingPoints: [] as Vector3Like[]
    },
    lastStatus: ''
  }),
  getters: {
    hasTrackSegments: (state) => state.crane.segments.length > 0,
    trackStatusMessage(state): string {
      if (state.drawing.active) {
        const remaining = Math.max(4 - state.drawing.pendingPoints.length, 0);
        if (remaining > 0) {
          return `绘制中：本段还需放置 ${remaining} 个点。`;
        }
        return '绘制中：该段已完成，可继续点击以开始下一段。';
      }
      if (state.crane.segments.length > 0) {
        return `当前共有 ${state.crane.segments.length} 段轨道，可继续绘制或清空重新规划。`;
      }
      return '点击“开始绘制轨道”后，在视图中依次放置起点、两个控制点与终点即可生成轨道。';
    },
    trackPlaneHeight(state): number {
      return state.rackParams.levels * state.rackParams.layerHeight + state.crane.heightOffset;
    },
    canFinishTrack(state): boolean {
      if (!state.drawing.active) return false;
      const minimum = state.crane.segments.length > 0 ? 1 : 0;
      return state.drawing.pendingPoints.length === 0 || state.drawing.pendingPoints.length >= minimum;
    },
    canUndo(state): boolean {
      if (state.drawing.active) {
        const baseAnchor = state.crane.segments.length > 0 ? 1 : 0;
        return state.drawing.pendingPoints.length > baseAnchor || state.crane.segments.length > 0;
      }
      return state.crane.segments.length > 0;
    },
    canClear(state): boolean {
      return state.drawing.pendingPoints.length > 0 || state.crane.segments.length > 0;
    }
  },
  actions: {
    setRackRows(rows: number) {
      this.rackParams.rows = clampInt(rows, 1, 40, this.rackParams.rows);
    },
    setRackColumns(columns: number) {
      this.rackParams.columns = clampInt(columns, 1, 40, this.rackParams.columns);
    },
    setRackLevels(levels: number) {
      this.rackParams.levels = clampInt(levels, 1, 12, this.rackParams.levels);
    },
    setShowLabels(show: boolean) {
      this.rackParams.showLabels = show;
    },
    setCraneProgress(progress: number) {
      this.crane.progress = Math.max(0, Math.min(progress, 1));
    },
    setAgvSpeed(speed: number) {
      this.agv.speed = Math.max(0.05, Math.min(speed, 3));
    },
    startTrackDrawing() {
      if (this.drawing.active) return;
      this.drawing.active = true;
      if (this.crane.segments.length > 0) {
        const last = this.crane.segments[this.crane.segments.length - 1];
        this.drawing.pendingPoints = [clonePoint(last.p3)];
      } else {
        this.drawing.pendingPoints = [];
      }
    },
    finishTrackDrawing() {
      if (!this.drawing.active) return;
      const minimum = this.crane.segments.length > 0 ? 1 : 0;
      if (this.drawing.pendingPoints.length > minimum && this.drawing.pendingPoints.length < 4) {
        this.lastStatus = '当前段未完成，继续点击以补齐剩余点。';
        return;
      }
      this.drawing.active = false;
      this.drawing.pendingPoints = [];
    },
    addTrackPoint(point: Vector3Like | Vector3) {
      const target = isVector3(point)
        ? { x: point.x, y: point.y, z: point.z }
        : { x: point.x, y: point.y, z: point.z };
      this.drawing.pendingPoints.push(target);
      if (this.drawing.pendingPoints.length >= 4) {
        const [p0, p1, p2, p3] = this.drawing.pendingPoints.slice(0, 4);
        this.crane.segments.push({
          id: generateId(),
          p0: clonePoint(p0),
          p1: clonePoint(p1),
          p2: clonePoint(p2),
          p3: clonePoint(p3)
        });
        this.drawing.pendingPoints = [clonePoint(p3)];
        this.lastStatus = `完成第 ${this.crane.segments.length} 段，继续点击即可追加下一段。`;
      } else {
        this.lastStatus = '';
      }
    },
    undoTrackPoint() {
      if (this.drawing.active) {
        const base = this.crane.segments.length > 0 ? 1 : 0;
        if (this.drawing.pendingPoints.length > base) {
          this.drawing.pendingPoints.pop();
          return;
        }
      }
      if (this.crane.segments.length > 0) {
        this.crane.segments.pop();
        if (this.drawing.active) {
          if (this.crane.segments.length > 0) {
            const last = this.crane.segments[this.crane.segments.length - 1];
            this.drawing.pendingPoints = [clonePoint(last.p3)];
          } else {
            this.drawing.pendingPoints = [];
          }
        }
      }
    },
    clearTrack() {
      this.crane.segments = [];
      this.drawing.pendingPoints = [];
      this.drawing.active = false;
      this.lastStatus = '';
    }
  }
});

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(Math.round(value), max));
}

function clonePoint(point: Vector3Like): Vector3Like {
  return { x: point.x, y: point.y, z: point.z };
}

function isVector3(value: Vector3Like | Vector3): value is Vector3 {
  return typeof (value as Vector3).isVector3 === 'boolean';
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `seg-${Math.random().toString(16).slice(2, 10)}`;
}
