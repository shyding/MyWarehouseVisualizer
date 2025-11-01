# 工厂 3D 建模设计器（基于 Vue3 + Vite）

本目录提供基于 Vue3 + Vite + TypeScript + Three.js 的工厂/仓储布局设计器 Demo，实现参数化货架与三阶贝塞尔天车轨道的交互式绘制。该实现遵循《需求规格说明书 v2.0/v3.0》中的架构要求，可在纯前端环境运行。

## 功能概览

- **参数化货架**：通过侧栏调整行、列、层与编号可视化（编号渲染将在后续版本补齐）。货架采用程序化三维网格，自动对齐至场景原点。
- **三阶贝塞尔轨道**：支持鼠标直接在 3D 视图中绘制轨道段，自动衔接已有段的终点，实现 C⁰ 连续。绘制时提供拾取预览、撤销/清空控制、轨道段参数列表与长度统计。
- **天车动画**：轨道更新后自动生成 `CurvePath` 与扫掠管道模型，并驱动天车沿弧长匀速循环运动，姿态跟随切线。
- **Vue + Pinia 架构**：三维视图与 UI 面板通过 Pinia 状态同步；Three.js 渲染逻辑封装在 `ViewerCanvas` 组件内，与轨道绘制状态联动。

## 目录结构

```
MyWarehouseVisualizer/
├─ index.html                 # Vite 入口
├─ package.json               # Vite/Vue/Three 依赖与脚本
├─ src/
│  ├─ App.vue                 # 布局框架
│  ├─ main.ts                 # Vue 启动入口
│  ├─ env.d.ts                # Vite 特性声明
│  ├─ store/
│  │  └─ sceneStore.ts        # 货架参数、轨道段、绘制状态 Pinia Store
│  ├─ modules/
│  │  └─ editor3d/
│  │     └─ ViewerCanvas.vue  # Three.js 视图与轨道绘制/动画
│  └─ ui/
│     └─ Sidebar.vue          # 货架参数与轨道管理面板
└─ README.factory-designer.md # 本说明
```

## 快速开始

```bash
npm install
npm run dev
```

打开浏览器访问 `http://localhost:5173/`，即可进入设计器界面。使用说明：

1. 左侧面板调整货架的行、列、层数；场景中的货架会实时更新。
2. 点击“开始绘制轨道”进入绘制模式，在 3D 视图中依次点击放置起点、两个控制点与终点。
3. 每完成一段后可继续点击追加下一段，或使用“撤销”“清空轨道”重新规划。
4. 天车会沿最新轨道循环运行，可观察轨道效果。

> **构建兼容性提示**：由于 `vue-tsc` 在安装时需要对 TypeScript 做正则补丁，目前项目将 TypeScript 版本固定在 `~5.3.3`，以避免构建阶段（尤其是 Vercel 部署）出现 “Search string not found: "/supportedTSExtensions = .*(?=;)/"” 的错误。

## 数据集生成与基准脚本

按照需求规格说明书 §19/§20 的约定，仓储示例数据生成器与基准脚本已经接入：

```bash
npm run seed:small   # 生成 datasets/small 下的场景/拓扑/仓位清单
npm run seed:medium
npm run seed:large
npm run bench        # 汇总三档数据指标到 benchmarks/latest.json
```

生成的数据结构：

```
datasets/
  ├─ small/
  │   ├─ scene.json
  │   ├─ topology.overhead.json
  │   ├─ topology.ground.json
  │   └─ slots.csv
  ├─ medium/
  │   └─ ...
  └─ large/
      └─ ...
```

基准脚本会输出对象数量、货架/轨道段统计、AGV 拓扑规模以及 `scene.json` 的文件体积，结果存于 `benchmarks/latest.json`。

## 后续规划

- 引入 `modules/track` 独立组件，补齐 C¹ 连续性约束、双轨生成与曲率热力图。
- 新增 `modules/rack` 程序化编号、`modules/graph` 路网编辑与校核覆盖层。
- 拓展 `services/seed.ts`、`scripts/bench.ts`，补充参数化开关、性能基准自动化与更丰富的衍生数据导出。

