<template>
  <div class="app-shell">
    <header class="app-header">
      <h1>工厂 3D 建模设计器</h1>
      <p>基于 Vue3 + Three.js 的参数化货架与天车轨道设计工具。</p>
    </header>
    <div class="app-content">
      <Sidebar class="app-sidebar" />
      <ViewerCanvas class="app-viewer" />
    </div>
  </div>
</template>

<script setup lang="ts">
import Sidebar from './ui/Sidebar.vue';
import ViewerCanvas from './modules/editor3d/ViewerCanvas.vue';
</script>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #0b111a;
  color: #f7f9fc;
}

.app-header {
  padding: 16px 24px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  background: linear-gradient(90deg, rgba(24, 32, 48, 0.95), rgba(18, 26, 40, 0.92));
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35);
  z-index: 1;
}

.app-header h1 {
  margin: 0;
  font-size: 24px;
  letter-spacing: 0.04em;
}

.app-header p {
  margin: 6px 0 0;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.68);
}

.app-content {
  flex: 1;
  display: grid;
  grid-template-columns: 360px 1fr;
  min-height: 0;
}

.app-sidebar {
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  overflow-y: auto;
  background: rgba(16, 24, 36, 0.94);
}

.app-viewer {
  position: relative;
  background: #05080f;
}

@media (max-width: 1024px) {
  .app-content {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
  }

  .app-sidebar {
    border-right: none;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
}
</style>
