(function () {
    const canvas = document.getElementById('designer');
    if (!canvas) {
        console.error('Factory designer canvas not found.');
        return;
    }

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b111a);

    const DEFAULT_CAMERA_POSITION = new THREE.Vector3(18, 14, 20);
    const DEFAULT_TARGET = new THREE.Vector3(0, 4, 0);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
    camera.position.copy(DEFAULT_CAMERA_POSITION);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.copy(DEFAULT_TARGET);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2.1;
    controls.update();

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);

    const directional = new THREE.DirectionalLight(0xffffff, 0.6);
    directional.position.set(12, 18, 10);
    directional.castShadow = false;
    scene.add(directional);

    const floorMaterial = new THREE.MeshStandardMaterial({
        color: 0x121a26,
        roughness: 0.9,
        metalness: 0.05
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.02;
    floor.receiveShadow = true;
    scene.add(floor);

    const gridHelper = new THREE.GridHelper(120, 60, 0x314057, 0x1b283d);
    gridHelper.position.y = 0.001;
    scene.add(gridHelper);

    const state = {
        rows: 3,
        columns: 5,
        levels: 3,
        showLabels: true,
        craneT: 0.25,
        agvSpeed: 0.7,
        agvPaused: false,
        pathVisible: true,
        agvProgress: 0,
        forkliftProgress: 0.5
    };

    const metrics = {
        binWidth: 1.2,
        binHeight: 0.8,
        binDepth: 1.1,
        spacingX: 1.8,
        spacingZ: 2.4,
        levelHeight: 1.1,
        frontBuffer: 4,
        backBuffer: 2,
        sideBuffer: 2
    };

    let shelvesGroup = new THREE.Group();
    let craneGroup = new THREE.Group();
    let zoneGroup = new THREE.Group();
    let pathGroup = new THREE.Group();
    let vehiclesGroup = new THREE.Group();
    scene.add(shelvesGroup);
    scene.add(craneGroup);
    scene.add(zoneGroup);
    scene.add(pathGroup);
    scene.add(vehiclesGroup);

    let agvCurve = null;
    let agvVehicle = null;
    let forkliftVehicle = null;

    const clock = new THREE.Clock();

    function updateStateFromInputs() {
        state.rows = clampInt(document.getElementById('rows').value, 1, 20, state.rows);
        state.columns = clampInt(document.getElementById('columns').value, 1, 20, state.columns);
        state.levels = clampInt(document.getElementById('levels').value, 1, 8, state.levels);
        state.showLabels = document.getElementById('showLabels').checked;
        state.craneT = parseFloat(document.getElementById('cranePosition').value);
        state.agvSpeed = parseFloat(document.getElementById('agvSpeed').value);
    }

    function clampInt(value, min, max, fallback) {
        const parsed = parseInt(value, 10);
        if (isNaN(parsed)) return fallback;
        return Math.min(Math.max(parsed, min), max);
    }

    function disposeGroup(group) {
        group.traverse((child) => {
            if (child.geometry) {
                child.geometry.dispose();
            }
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(disposeMaterial);
                } else {
                    disposeMaterial(child.material);
                }
            }
        });
        group.clear();
    }

    function disposeMaterial(material) {
        if (material.map) {
            material.map.dispose();
        }
        material.dispose();
    }

    function computeLayout() {
        const width = (state.columns - 1) * metrics.spacingX + metrics.binWidth;
        const depth = (state.rows - 1) * metrics.spacingZ + metrics.binDepth;
        const height = (state.levels - 1) * metrics.levelHeight + metrics.binHeight;
        const offsetX = -width / 2;
        const offsetZ = -depth / 2;
        return { width, depth, height, offsetX, offsetZ };
    }

    function buildShelves() {
        scene.remove(shelvesGroup);
        disposeGroup(shelvesGroup);
        shelvesGroup = new THREE.Group();

        const { width, depth, offsetX, offsetZ } = computeLayout();
        const binGeo = new THREE.BoxGeometry(metrics.binWidth, metrics.binHeight, metrics.binDepth);
        const frameMaterial = new THREE.MeshStandardMaterial({
            color: 0x4a90e2,
            transparent: true,
            opacity: 0.65,
            roughness: 0.4,
            metalness: 0.2
        });
        const frameEdgesMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.15 });

        const labelGroup = new THREE.Group();
        labelGroup.name = 'slotLabels';

        for (let r = 0; r < state.rows; r++) {
            for (let c = 0; c < state.columns; c++) {
                for (let l = 0; l < state.levels; l++) {
                    const bin = new THREE.Mesh(binGeo, frameMaterial.clone());
                    const x = offsetX + c * metrics.spacingX;
                    const y = l * metrics.levelHeight + metrics.binHeight / 2;
                    const z = offsetZ + r * metrics.spacingZ;
                    bin.position.set(x, y, z);
                    bin.castShadow = false;
                    shelvesGroup.add(bin);

                    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(binGeo), frameEdgesMaterial.clone());
                    edges.position.copy(bin.position);
                    shelvesGroup.add(edges);

                    if (state.showLabels) {
                        const label = buildLabel(`R${r + 1}-C${c + 1}-L${l + 1}`);
                        label.position.set(x, y + metrics.binHeight / 2 + 0.2, z + metrics.binDepth / 2 + 0.05);
                        labelGroup.add(label);
                    }
                }
            }
        }

        shelvesGroup.add(labelGroup);

        // simple base beams
        const baseGeometry = new THREE.BoxGeometry(width + 1.2, 0.2, depth + 1.2);
        const baseMaterial = new THREE.MeshStandardMaterial({
            color: 0x1d2a3a,
            roughness: 0.8,
            metalness: 0.05
        });
        const base = new THREE.Mesh(baseGeometry, baseMaterial);
        base.position.set(0, -0.12, 0);
        base.receiveShadow = true;
        shelvesGroup.add(base);

        scene.add(shelvesGroup);
    }

    function buildLabel(text) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 128;
        const context = canvas.getContext('2d');
        context.fillStyle = 'rgba(13, 21, 35, 0.9)';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#6be3ff';
        context.font = 'bold 64px "Segoe UI", Arial';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(text, canvas.width / 2, canvas.height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(1.9, 0.95, 1);
        return sprite;
    }

    function buildZoneLabel(text) {
        const sprite = buildLabel(text);
        sprite.material.color.set(0xffffff);
        sprite.scale.set(3.2, 1.4, 1);
        return sprite;
    }

    function buildCrane() {
        scene.remove(craneGroup);
        disposeGroup(craneGroup);
        craneGroup = new THREE.Group();

        const { width, depth, height, offsetZ } = computeLayout();
        const railLength = width + 4;
        const railSeparation = depth + 3.2;
        const craneHeight = height + 2.4;

        const railGeometry = new THREE.BoxGeometry(railLength, 0.18, 0.25);
        const railMaterial = new THREE.MeshStandardMaterial({
            color: 0xdfe4ea,
            metalness: 0.6,
            roughness: 0.3
        });

        const leftRail = new THREE.Mesh(railGeometry, railMaterial.clone());
        leftRail.position.set(0, craneHeight, offsetZ - 1.6);
        const rightRail = new THREE.Mesh(railGeometry, railMaterial.clone());
        rightRail.position.set(0, craneHeight, offsetZ + depth + 1.6);
        craneGroup.add(leftRail, rightRail);

        const bridgeGroup = new THREE.Group();
        const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, railSeparation), new THREE.MeshStandardMaterial({
            color: 0xffc300,
            metalness: 0.45,
            roughness: 0.35
        }));
        bridgeGroup.add(bridge);

        const trolley = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.9), new THREE.MeshStandardMaterial({
            color: 0xff9100,
            metalness: 0.3,
            roughness: 0.4
        }));
        trolley.position.y = -0.4;
        bridgeGroup.add(trolley);

        const hookCable = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 12), new THREE.MeshStandardMaterial({
            color: 0x4e5c6e,
            metalness: 0.2,
            roughness: 0.5
        }));
        hookCable.position.y = -1.4;
        bridgeGroup.add(hookCable);

        const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 16), new THREE.MeshStandardMaterial({
            color: 0x1f2933,
            metalness: 0.6,
            roughness: 0.3
        }));
        hook.rotation.z = Math.PI / 2;
        hook.position.y = -2;
        bridgeGroup.add(hook);

        const load = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.6), new THREE.MeshStandardMaterial({
            color: 0x1dd1a1,
            metalness: 0.2,
            roughness: 0.6
        }));
        load.position.y = -2.5;
        bridgeGroup.add(load);

        bridgeGroup.position.set(0, craneHeight, computeCraneZ(state.craneT, depth, offsetZ));
        bridgeGroup.name = 'craneBridge';
        craneGroup.add(bridgeGroup);

        scene.add(craneGroup);
    }

    function computeCraneZ(t, depth, offsetZ) {
        const start = offsetZ - 1.6;
        const end = offsetZ + depth + 1.6;
        return THREE.MathUtils.lerp(start, end, t);
    }

    function buildZones() {
        scene.remove(zoneGroup);
        disposeGroup(zoneGroup);
        zoneGroup = new THREE.Group();

        const { width, offsetX, offsetZ } = computeLayout();
        const zoneNames = ['收货区', '暂存区', '发货区'];
        const zoneColors = [0x2a9d8f, 0xf4a261, 0xe76f51];
        const zoneDepth = 3.4;
        const zoneGap = 0.4;
        const startX = offsetX + (width / 3) / 2;
        const frontZ = offsetZ - zoneDepth / 2 - 0.6;

        for (let i = 0; i < 3; i++) {
            const zoneWidth = width / 3 - zoneGap;
            const plane = new THREE.Mesh(new THREE.PlaneGeometry(zoneWidth, zoneDepth), new THREE.MeshStandardMaterial({
                color: zoneColors[i],
                transparent: true,
                opacity: 0.35,
                side: THREE.DoubleSide
            }));
            plane.rotation.x = -Math.PI / 2;
            plane.position.set(startX + i * (zoneWidth + zoneGap), 0.005, frontZ);
            zoneGroup.add(plane);

            const label = buildZoneLabel(zoneNames[i]);
            label.position.set(plane.position.x, 0.8, frontZ - zoneDepth / 3);
            zoneGroup.add(label);
        }

        scene.add(zoneGroup);
    }

    function buildPathAndVehicles() {
        scene.remove(pathGroup);
        disposeGroup(pathGroup);
        pathGroup = new THREE.Group();
        scene.remove(vehiclesGroup);
        disposeGroup(vehiclesGroup);
        vehiclesGroup = new THREE.Group();

        const { width, depth, offsetX, offsetZ } = computeLayout();
        const leftX = offsetX - metrics.sideBuffer;
        const rightX = offsetX + width + metrics.sideBuffer;
        const frontZ = offsetZ - metrics.frontBuffer;
        const midZ = offsetZ + depth / 2;
        const backZ = offsetZ + depth + metrics.backBuffer;

        const pathPoints = [
            new THREE.Vector3(leftX, 0, frontZ),
            new THREE.Vector3(rightX, 0, frontZ),
            new THREE.Vector3(rightX, 0, midZ),
            new THREE.Vector3(rightX, 0, backZ),
            new THREE.Vector3(leftX, 0, backZ),
            new THREE.Vector3(leftX, 0, midZ),
            new THREE.Vector3(leftX, 0, frontZ)
        ];

        agvCurve = new THREE.CatmullRomCurve3(pathPoints, true, 'centripetal');

        const tubeGeometry = new THREE.TubeGeometry(agvCurve, 240, 0.1, 12, true);
        const tubeMaterial = new THREE.MeshStandardMaterial({
            color: 0xff6d00,
            emissive: 0xff6d00,
            emissiveIntensity: 0.35,
            roughness: 0.5,
            metalness: 0.1,
            transparent: true,
            opacity: 0.85
        });
        const tube = new THREE.Mesh(tubeGeometry, tubeMaterial);
        tube.position.y = 0.02;
        pathGroup.add(tube);

        agvVehicle = buildAgv();
        forkliftVehicle = buildForklift();
        vehiclesGroup.add(agvVehicle);
        vehiclesGroup.add(forkliftVehicle);

        pathGroup.visible = state.pathVisible;
        scene.add(pathGroup);
        scene.add(vehiclesGroup);
    }

    function buildAgv() {
        const group = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 1.6), new THREE.MeshStandardMaterial({
            color: 0x00c853,
            metalness: 0.2,
            roughness: 0.5
        }));
        body.position.y = 0.2;
        group.add(body);

        const top = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.18, 24), new THREE.MeshStandardMaterial({
            color: 0x1a237e,
            metalness: 0.3,
            roughness: 0.4
        }));
        top.rotation.x = Math.PI / 2;
        top.position.set(0, 0.42, 0);
        group.add(top);

        const sensor = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.15, 24), new THREE.MeshStandardMaterial({
            color: 0xffeb3b,
            emissive: 0xffe082,
            emissiveIntensity: 0.4
        }));
        sensor.rotation.x = Math.PI / 2;
        sensor.position.set(0, 0.55, 0);
        group.add(sensor);

        return group;
    }

    function buildForklift() {
        const group = new THREE.Group();
        const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.6, 1.4), new THREE.MeshStandardMaterial({
            color: 0xffb300,
            metalness: 0.3,
            roughness: 0.5
        }));
        chassis.position.y = 0.3;
        group.add(chassis);

        const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.8), new THREE.MeshStandardMaterial({
            color: 0x263238,
            transparent: true,
            opacity: 0.65
        }));
        cabin.position.set(0, 0.8, -0.1);
        group.add(cabin);

        const mast = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.2, 0.15), new THREE.MeshStandardMaterial({
            color: 0x37474f,
            metalness: 0.4,
            roughness: 0.4
        }));
        mast.position.set(0, 1.0, 0.55);
        group.add(mast);

        const fork = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.08, 0.9), new THREE.MeshStandardMaterial({
            color: 0x8d6e63,
            metalness: 0.2,
            roughness: 0.6
        }));
        fork.position.set(0, 0.2, 0.95);
        group.add(fork);

        return group;
    }

    function updateVehicles(delta) {
        if (!agvCurve || !agvVehicle || !forkliftVehicle) return;
        if (!state.agvPaused) {
            state.agvProgress = (state.agvProgress + delta * state.agvSpeed * 0.08) % 1;
            state.forkliftProgress = (state.agvProgress + 0.5) % 1;
        }
        positionVehicleOnCurve(agvVehicle, state.agvProgress, 0.25);
        positionVehicleOnCurve(forkliftVehicle, state.forkliftProgress, 0.32);
    }

    function positionVehicleOnCurve(vehicle, t, height) {
        const point = agvCurve.getPointAt(t);
        const tangent = agvCurve.getTangentAt(t).normalize();
        vehicle.position.set(point.x, height, point.z);
        const heading = Math.atan2(tangent.x, tangent.z);
        vehicle.rotation.y = heading;
    }

    function handleResize() {
        const container = canvas.parentElement;
        const width = container.clientWidth;
        const height = container.clientHeight;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
    }

    function resetView() {
        camera.position.copy(DEFAULT_CAMERA_POSITION);
        controls.target.copy(DEFAULT_TARGET);
        controls.update();
    }

    function render() {
        requestAnimationFrame(render);
        const delta = clock.getDelta();
        controls.update();
        updateVehicles(delta);
        renderer.render(scene, camera);
    }

    function initializeUi() {
        updateStateFromInputs();
        document.getElementById('rows').addEventListener('change', () => {
            updateStateFromInputs();
            rebuildScene();
        });
        document.getElementById('columns').addEventListener('change', () => {
            updateStateFromInputs();
            rebuildScene();
        });
        document.getElementById('levels').addEventListener('change', () => {
            updateStateFromInputs();
            rebuildScene();
        });
        document.getElementById('showLabels').addEventListener('change', () => {
            state.showLabels = document.getElementById('showLabels').checked;
            rebuildScene();
        });
        document.getElementById('cranePosition').addEventListener('input', (event) => {
            state.craneT = parseFloat(event.target.value);
            updateCranePosition();
        });
        document.getElementById('agvSpeed').addEventListener('input', (event) => {
            state.agvSpeed = parseFloat(event.target.value);
        });
        document.getElementById('togglePath').addEventListener('click', () => {
            state.pathVisible = !state.pathVisible;
            pathGroup.visible = state.pathVisible;
        });
        const pauseButton = document.getElementById('pauseAgv');
        pauseButton.addEventListener('click', () => {
            state.agvPaused = !state.agvPaused;
            pauseButton.textContent = state.agvPaused ? '继续动画' : '暂停动画';
        });
        const resetButton = document.getElementById('resetView');
        if (resetButton) {
            resetButton.addEventListener('click', resetView);
        }
    }

    function rebuildScene() {
        buildShelves();
        buildCrane();
        buildZones();
        buildPathAndVehicles();
        handleResize();
    }

    function updateCranePosition() {
        const { depth, offsetZ } = computeLayout();
        const bridge = craneGroup.getObjectByName('craneBridge');
        if (bridge) {
            bridge.position.z = computeCraneZ(state.craneT, depth, offsetZ);
        }
    }

    window.addEventListener('resize', handleResize);
    initializeUi();
    rebuildScene();
    render();
})();
