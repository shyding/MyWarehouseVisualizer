# My Warehouse Visualizer
 Visualize Physical Warehouse Layouts And Their Associated Data
 
 ![Screen Shot of My Warehouse Visualizer](https://github.com/MarioDelgadoSr/MyWarehouseVisualizerDoc/blob/master/img/MyWarehouseVisualizerDamagedAnalysis.png)
 
## Installation

Download zip of code, unzip to a folder and launch index.html from a web server with a [WebGL enabled browser](https://get.webgl.org/). 

## Demonstration

* [My Warehouse Visualizer Demo](https://mariodelgadosr.github.io/MyWarehouseVisualizer/)

## Factory 3D Designer

The repository now also包含一个独立的数字工厂建模原型工具，位于 `factoryDesigner.html`。通过现代浏览器打开该页面即可获得一个可交互的三维场景，支持：

* 动态调整仓库货架的行、列与层数，并实时更新仓位编号。
* 可视化天车与轨道，拖动滑块即可移动天车位置。
* 预置库区分区颜色块，快速划分收货、暂存与发货区域。
* 带有 AGV 与叉车的路径规划演示，可调节速度并控制路径显示/隐藏。
* 一键重置视角，快速回到默认观察角度。

该设计器基于 Three.js 渲染，与主应用共用现有依赖，无需额外安装即可体验。

## Documentation

* [My Warehouse Visualizer Documentation](https://github.com/MarioDelgadoSr/MyWarehouseVisualizerDoc#my-warehouse-visualizer-documentation)

## Built With

The following frameworks and applications were used to build ***My Data/Warehouse Visualizer***:

* [DataVisual](https://github.com/MarioDelgadoSr/DataVisual)
* [D3.js](https://d3js.org/) - D3 framework
* [Three.js](https://threejs.org/) - Three.js framework
* [glTF](https://www.khronos.org/gltf/) - Khronos' graphic library Transmission Format
* [GLTFLoader](https://threejs.org/docs/index.html#examples/loaders/GLTFLoader) - A loader for glTF 2.0 resources
* [Blender](https://www.blender.org/) - For building a 3D visual and [exporting](https://docs.blender.org/manual/en/dev/addons/io_gltf2.html) it to a glTF file.
* [w2ui UI Library](http://w2ui.com/web/) 

## Creator

* **Mario Delgado** Github: [MarioDelgadoSr](https://github.com/MarioDelgadoSr)
* LinkedIn: [Mario Delgado](https://www.linkedin.com/in/mario-delgado-5b6195155/)
* Contact: [MyDataVisualizer(at)gmail.com](mailto:MyDataVisualizer@gmail.com). 

## License

* [***My Data/Warehouse Visualizer***](https://mariodelgadosr.github.io/MyWarehouseVisualizer/) is free for all non-profit entities.  
* Businesses and commercial enterprises are granted a full-use license as long as they make their application freely available to non-profits.  