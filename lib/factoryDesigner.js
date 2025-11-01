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

    renderer.domElement.addEventListener('pointerdown', handleCanvasPointerDown);

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
        forkliftProgress: 0.5,
        craneTrackSegments: []
    };

    state.craneTrackSegments = createDefaultCraneTrackSegments();
    updateDrawPlane();

    const drawState = {
        active: false,
        pendingPoints: []
    };

    const trackUi = {
        startButton: null,
        finishButton: null,
        undoButton: null,
        clearButton: null
    };

    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    let drawPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    let drawPreviewGroup = null;

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
    let craneTrackData = { curves: [], totalLength: 0 };
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

    function getCraneRailHeight() {
        const { height } = computeLayout();
        return height + 2.6;
    }

    function updateDrawPlane() {
        drawPlane.set(new THREE.Vector3(0, 1, 0), -getCraneRailHeight());
    }

    function clonePoint(point) {
        return { x: point.x, y: point.y, z: point.z };
    }

    function createDefaultCraneTrackSegments() {
        const { width, depth, offsetX, offsetZ } = computeLayout();
        const elevated = getCraneRailHeight();
        const start = { x: offsetX - 2, y: elevated, z: offsetZ - 2 };
        const mid = { x: offsetX + width * 0.55, y: elevated + 0.3, z: offsetZ + depth * 0.35 };
        const end = { x: offsetX + width + 2, y: elevated, z: offsetZ + depth + 2 };

        const first = {
            p0: clonePoint(start),
            p1: { x: offsetX + width * 0.15, y: elevated + 0.9, z: offsetZ - 3.5 },
            p2: { x: offsetX + width * 0.35, y: elevated + 0.4, z: offsetZ + depth * 0.15 },
            p3: clonePoint(mid)
        };

        const second = {
            p0: clonePoint(first.p3),
            p1: { x: offsetX + width * 0.85, y: elevated + 0.6, z: offsetZ + depth * 0.45 },
            p2: { x: offsetX + width + 1.2, y: elevated + 0.8, z: offsetZ + depth + 1 },
            p3: clonePoint(end)
        };

        return [first, second];
    }

    function enforceTrackContinuity() {
        for (let i = 1; i < state.craneTrackSegments.length; i++) {
            const prevEnd = state.craneTrackSegments[i - 1].p3;
            const segment = state.craneTrackSegments[i];
            segment.p0.x = prevEnd.x;
            segment.p0.y = prevEnd.y;
            segment.p0.z = prevEnd.z;
        }
    }

    function pointToVector(point) {
        return new THREE.Vector3(point.x, point.y, point.z);
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

        enforceTrackContinuity();

        const trackGroup = new THREE.Group();
        trackGroup.name = 'craneTrack';

        const trackMaterial = new THREE.MeshStandardMaterial({
            color: 0xdfe4ea,
            metalness: 0.65,
            roughness: 0.35
        });
        const anchorMaterial = new THREE.MeshStandardMaterial({
            color: 0x1dd1a1,
            emissive: 0x1dd1a1,
            emissiveIntensity: 0.25,
            roughness: 0.45
        });
        const controlMaterial = new THREE.MeshStandardMaterial({
            color: 0xff9100,
            emissive: 0xff9100,
            emissiveIntensity: 0.2,
            roughness: 0.45
        });
        const markerGeometry = new THREE.SphereGeometry(0.18, 18, 18);

        const curveEntries = [];
        let totalLength = 0;

        state.craneTrackSegments.forEach((segment) => {
            const curve = new THREE.CubicBezierCurve3(
                pointToVector(segment.p0),
                pointToVector(segment.p1),
                pointToVector(segment.p2),
                pointToVector(segment.p3)
            );

            const tubeGeometry = new THREE.TubeGeometry(curve, 90, 0.12, 12, false);
            const tube = new THREE.Mesh(tubeGeometry, trackMaterial.clone());
            trackGroup.add(tube);

            const length = curve.getLength();
            curveEntries.push({ curve, length });
            totalLength += length;

            const controlPoints = [segment.p0, segment.p1, segment.p2, segment.p3];
            controlPoints.forEach((point, pointIndex) => {
                const material = (pointIndex === 0 || pointIndex === 3 ? anchorMaterial : controlMaterial).clone();
                const marker = new THREE.Mesh(markerGeometry.clone(), material);
                marker.position.copy(pointToVector(point));
                trackGroup.add(marker);
            });
        });

        markerGeometry.dispose();
        trackMaterial.dispose();
        anchorMaterial.dispose();
        controlMaterial.dispose();

        craneGroup.add(trackGroup);

        craneTrackData = {
            curves: curveEntries,
            totalLength
        };

        const { depth } = computeLayout();
        const bridgeGroup = new THREE.Group();
        bridgeGroup.name = 'craneBridge';

        const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, depth + 3.2), new THREE.MeshStandardMaterial({
            color: 0xffc300,
            metalness: 0.45,
            roughness: 0.35
        }));
        bridge.position.y = 0;
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

        craneGroup.add(bridgeGroup);
        scene.add(craneGroup);

        updateCranePosition();
        renderTrackSummary();
        updateTrackStatus();
        updateTrackButtons();
    }

    function evaluateCraneTrack(t) {
        if (!craneTrackData || craneTrackData.curves.length === 0 || craneTrackData.totalLength === 0) {
            const { height } = computeLayout();
            const fallbackHeight = height + 2.4;
            return {
                point: new THREE.Vector3(0, fallbackHeight, 0),
                tangent: new THREE.Vector3(0, 0, 1)
            };
        }

        const clamped = THREE.MathUtils.clamp(t, 0, 1);
        const targetDistance = clamped * craneTrackData.totalLength;
        let accumulated = 0;

        for (let i = 0; i < craneTrackData.curves.length; i++) {
            const entry = craneTrackData.curves[i];
            const nextAccum = accumulated + entry.length;
            if (targetDistance <= nextAccum || i === craneTrackData.curves.length - 1) {
                const segmentLength = entry.length <= 0 ? 1 : entry.length;
                const localDistance = targetDistance - accumulated;
                const localT = THREE.MathUtils.clamp(segmentLength === 0 ? 0 : localDistance / segmentLength, 0, 1);
                const point = entry.curve.getPointAt(localT);
                const tangent = entry.curve.getTangentAt(localT).normalize();
                return { point, tangent };
            }
            accumulated = nextAccum;
        }

        const lastEntry = craneTrackData.curves[craneTrackData.curves.length - 1];
        return {
            point: lastEntry.curve.getPoint(1),
            tangent: lastEntry.curve.getTangent(1).normalize()
        };
    }

    function formatPointDisplay(prefix, point) {
        return `${prefix} (x: ${point.x.toFixed(2)}, y: ${point.y.toFixed(2)}, z: ${point.z.toFixed(2)})`;
    }

    function renderTrackSummary() {
        const editor = document.getElementById('craneTrackEditor');
        if (!editor) return;

        editor.innerHTML = '';

        if (state.craneTrackSegments.length === 0) {
            const placeholder = document.createElement('p');
            placeholder.className = 'track-placeholder';
            placeholder.textContent = drawState.active
                ? '正在绘制：继续在场景中点击，依次放置控制点与终点。'
                : '暂无轨道。点击“开始绘制轨道”后，在视图中布置起点、控制点与终点。';
            editor.appendChild(placeholder);
            return;
        }

        state.craneTrackSegments.forEach((segment, index) => {
            const segmentContainer = document.createElement('div');
            segmentContainer.className = 'track-segment';

            const title = document.createElement('h4');
            title.textContent = `贝塞尔段 ${index + 1}`;
            segmentContainer.appendChild(title);

            const list = document.createElement('dl');
            appendPointToList(list, '起点', segment.p0);
            appendPointToList(list, '控制点 1', segment.p1);
            appendPointToList(list, '控制点 2', segment.p2);
            appendPointToList(list, '终点', segment.p3);

            segmentContainer.appendChild(list);
            editor.appendChild(segmentContainer);
        });
    }

    function appendPointToList(container, label, point) {
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        dd.textContent = `(${point.x.toFixed(2)}, ${point.y.toFixed(2)}, ${point.z.toFixed(2)})`;
        container.appendChild(dt);
        container.appendChild(dd);
    }

    function updateTrackStatus(message) {
        const status = document.getElementById('trackStatus');
        if (!status) return;

        if (message) {
            status.textContent = message;
            return;
        }

        if (drawState.active) {
            const remaining = Math.max(4 - drawState.pendingPoints.length, 0);
            if (remaining > 0) {
                status.textContent = `绘制中：本段还需放置 ${remaining} 个点。`;
            } else {
                status.textContent = '绘制中：该段已完成，可继续点击以开始下一段。';
            }
            return;
        }

        if (state.craneTrackSegments.length > 0) {
            status.textContent = `当前共有 ${state.craneTrackSegments.length} 段轨道，可点击“开始绘制轨道”追加新段或使用“清空轨道”重新规划。`;
            return;
        }

        status.textContent = '点击“开始绘制轨道”后，在视图中依次放置起点、两个控制点与终点即可生成轨道。';
    }

    function updateTrackButtons() {
        if (!trackUi.startButton) return;

        const hasSegments = state.craneTrackSegments.length > 0;
        const baseAnchorCount = hasSegments ? 1 : 0;
        const canUndoPoint = drawState.pendingPoints.length > baseAnchorCount;
        const hasPendingPoints = drawState.pendingPoints.length > 0;

        trackUi.startButton.disabled = drawState.active;
        trackUi.finishButton.disabled = !drawState.active;
        trackUi.undoButton.disabled = !hasSegments && !canUndoPoint;
        trackUi.clearButton.disabled = !hasSegments && !hasPendingPoints;
    }

    function startTrackDrawing() {
        if (drawState.active) return;

        drawState.active = true;
        controls.enabled = false;
        canvas.classList.add('drawing-track');
        updateDrawPlane();

        if (state.craneTrackSegments.length > 0) {
            const lastSegment = state.craneTrackSegments[state.craneTrackSegments.length - 1];
            drawState.pendingPoints = [clonePoint(lastSegment.p3)];
        } else {
            drawState.pendingPoints = [];
        }

        updateDrawingPreview();
        updateTrackButtons();
        updateTrackStatus('绘制中：先点击起点，再依次放置控制点 1、控制点 2 与终点。');
        renderTrackSummary();
    }

    function finishTrackDrawing() {
        if (!drawState.active) return;

        const minimumPoints = state.craneTrackSegments.length > 0 ? 1 : 0;
        if (drawState.pendingPoints.length > minimumPoints && drawState.pendingPoints.length < 4) {
            updateTrackStatus('当前段未完成，继续点击以补齐剩余点。');
            return;
        }

        drawState.active = false;
        drawState.pendingPoints = [];
        controls.enabled = true;
        canvas.classList.remove('drawing-track');
        updateDrawingPreview();
        updateTrackButtons();
        updateTrackStatus();
    }

    function undoTrackPoint() {
        const hasSegments = state.craneTrackSegments.length > 0;
        const baseAnchor = hasSegments ? 1 : 0;

        if (drawState.active) {
            if (drawState.pendingPoints.length > baseAnchor) {
                drawState.pendingPoints.pop();
                updateDrawingPreview();
                updateTrackStatus();
                updateTrackButtons();
                return;
            }

            if (hasSegments) {
                state.craneTrackSegments.pop();
                if (state.craneTrackSegments.length > 0) {
                    const lastSegment = state.craneTrackSegments[state.craneTrackSegments.length - 1];
                    drawState.pendingPoints = [clonePoint(lastSegment.p3)];
                } else {
                    drawState.pendingPoints = [];
                }
                buildCrane();
                updateDrawingPreview();
                updateTrackButtons();
                return;
            }
        } else if (hasSegments) {
            state.craneTrackSegments.pop();
            buildCrane();
            updateTrackButtons();
            updateTrackStatus();
        }
    }

    function clearTrackDrawing() {
        if (state.craneTrackSegments.length === 0 && drawState.pendingPoints.length === 0) return;
        state.craneTrackSegments = [];
        drawState.pendingPoints = [];
        if (drawState.active) {
            drawState.active = false;
            controls.enabled = true;
            canvas.classList.remove('drawing-track');
        }
        buildCrane();
        updateDrawingPreview();
        updateTrackButtons();
        updateTrackStatus('轨道已清空，可重新点击“开始绘制轨道”。');
    }

    function handleCanvasPointerDown(event) {
        if (!drawState.active || event.button !== 0) return;

        event.preventDefault();
        event.stopPropagation();

        const intersection = projectPointerToRail(event);
        if (!intersection) return;

        addDrawPoint(intersection);
    }

    function projectPointerToRail(event) {
        const rect = canvas.getBoundingClientRect();
        pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointerNdc, camera);
        const intersection = new THREE.Vector3();
        const hit = raycaster.ray.intersectPlane(drawPlane, intersection);
        if (!hit) return null;
        return intersection.clone();
    }

    function addDrawPoint(vector) {
        const point = { x: vector.x, y: vector.y, z: vector.z };
        drawState.pendingPoints.push(point);
        updateDrawingPreview();
        updateTrackButtons();

        if (drawState.pendingPoints.length >= 4) {
            finalizeDrawnSegment(drawState.pendingPoints.slice(0, 4));
        } else {
            updateTrackStatus();
        }
    }

    function finalizeDrawnSegment(points) {
        if (points.length < 4) return;

        const [p0, p1, p2, p3] = points;
        state.craneTrackSegments.push({
            p0: clonePoint(p0),
            p1: clonePoint(p1),
            p2: clonePoint(p2),
            p3: clonePoint(p3)
        });

        drawState.pendingPoints = [clonePoint(p3)];
        buildCrane();
        updateDrawingPreview();
        updateTrackButtons();
        updateTrackStatus(`完成第 ${state.craneTrackSegments.length} 段，继续点击即可追加下一段。`);
    }

    function updateDrawingPreview() {
        if (drawPreviewGroup) {
            scene.remove(drawPreviewGroup);
            disposeGroup(drawPreviewGroup);
        }

        drawPreviewGroup = new THREE.Group();
        drawPreviewGroup.name = 'craneDrawPreview';

        if (drawState.active && drawState.pendingPoints.length > 0) {
            const markerGeometry = new THREE.SphereGeometry(0.14, 16, 16);

            drawState.pendingPoints.forEach((point, index) => {
                const color = index === 0 ? 0x26c6da : 0xff7043;
                const marker = new THREE.Mesh(markerGeometry.clone(), new THREE.MeshBasicMaterial({ color }));
                marker.position.copy(pointToVector(point));
                drawPreviewGroup.add(marker);
            });

            if (drawState.pendingPoints.length >= 2) {
                const points = drawState.pendingPoints.map((point) => pointToVector(point));
                const geometry = new THREE.BufferGeometry().setFromPoints(points);
                const material = new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.5, gapSize: 0.2 });
                const line = new THREE.Line(geometry, material);
                line.computeLineDistances();
                drawPreviewGroup.add(line);
            }

            markerGeometry.dispose();
        }

        scene.add(drawPreviewGroup);
    }

    function initializeCraneTrackUi() {
        trackUi.startButton = document.getElementById('startTrackDrawing');
        trackUi.finishButton = document.getElementById('finishTrackDrawing');
        trackUi.undoButton = document.getElementById('undoTrackPoint');
        trackUi.clearButton = document.getElementById('clearTrackDrawing');

        if (trackUi.startButton) {
            trackUi.startButton.addEventListener('click', startTrackDrawing);
        }
        if (trackUi.finishButton) {
            trackUi.finishButton.addEventListener('click', finishTrackDrawing);
        }
        if (trackUi.undoButton) {
            trackUi.undoButton.addEventListener('click', undoTrackPoint);
        }
        if (trackUi.clearButton) {
            trackUi.clearButton.addEventListener('click', clearTrackDrawing);
        }

        renderTrackSummary();
        updateTrackButtons();
        updateTrackStatus();
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

        initializeCraneTrackUi();
    }

    function rebuildScene() {
        buildShelves();
        buildCrane();
        buildZones();
        buildPathAndVehicles();
        handleResize();
        updateDrawPlane();
        if (drawState.active) {
            updateDrawingPreview();
        }
    }

    function updateCranePosition() {
        const bridge = craneGroup.getObjectByName('craneBridge');
        if (!bridge) return;

        const { point, tangent } = evaluateCraneTrack(state.craneT);
        bridge.position.copy(point);

        if (tangent.lengthSq() > 0.0001) {
            const heading = Math.atan2(tangent.x, tangent.z);
            bridge.rotation.set(0, heading, 0);
        } else {
            bridge.rotation.set(0, 0, 0);
        }
    }

    window.addEventListener('resize', handleResize);
    initializeUi();
    rebuildScene();
    render();
})();
