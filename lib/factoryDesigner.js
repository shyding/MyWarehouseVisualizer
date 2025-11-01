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
        forkliftProgress: 0.5,
        craneTrackSegments: []
    };

    state.craneTrackSegments = createDefaultCraneTrackSegments();

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

    function clonePoint(point) {
        return { x: point.x, y: point.y, z: point.z };
    }

    function createDefaultCraneTrackSegments() {
        const { width, depth, height, offsetX, offsetZ } = computeLayout();
        const elevated = height + 2.6;
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

    function resizeCraneTrackSegments(desiredCount) {
        const count = Math.max(1, desiredCount);
        const current = state.craneTrackSegments.length;
        if (count === current) return;

        if (count > current) {
            for (let i = current; i < count; i++) {
                const previous = state.craneTrackSegments[i - 1];
                const base = previous ? previous.p3 : { x: 0, y: 6, z: 0 };
                const nextSegment = {
                    p0: clonePoint(base),
                    p1: { x: base.x + 2.5, y: base.y + 0.8, z: base.z + 1.5 },
                    p2: { x: base.x + 5, y: base.y + 0.8, z: base.z - 1.5 },
                    p3: { x: base.x + 7, y: base.y, z: base.z }
                };
                state.craneTrackSegments.push(nextSegment);
            }
        } else {
            state.craneTrackSegments.splice(count);
        }

        enforceTrackContinuity();
    }

    function renderCraneTrackControls() {
        const editor = document.getElementById('craneTrackEditor');
        if (!editor) return;

        editor.innerHTML = '';

        state.craneTrackSegments.forEach((segment, index) => {
            const segmentContainer = document.createElement('div');
            segmentContainer.className = 'track-segment';

            const title = document.createElement('h4');
            title.textContent = `贝塞尔段 ${index + 1}`;
            segmentContainer.appendChild(title);

            if (index === 0) {
                segmentContainer.appendChild(buildPointInputs(segment, index, 'p0', '起点'));
            } else {
                const startInfo = document.createElement('p');
                startInfo.className = 'track-start';
                startInfo.dataset.start = `segment-${index}`;
                startInfo.textContent = formatPointDisplay('起点', segment.p0);
                segmentContainer.appendChild(startInfo);
            }

            segmentContainer.appendChild(buildPointInputs(segment, index, 'p1', '控制点 1'));
            segmentContainer.appendChild(buildPointInputs(segment, index, 'p2', '控制点 2'));
            segmentContainer.appendChild(buildPointInputs(segment, index, 'p3', '终点'));

            editor.appendChild(segmentContainer);
        });
    }

    function buildPointInputs(segment, segmentIndex, pointKey, labelText) {
        const wrapper = document.createElement('div');
        wrapper.className = 'point-inputs';
        const axes = ['x', 'y', 'z'];

        axes.forEach((axis) => {
            const label = document.createElement('label');
            label.textContent = `${labelText} ${axis.toUpperCase()}`;
            const input = document.createElement('input');
            input.type = 'number';
            input.step = '0.1';
            input.value = segment[pointKey][axis].toFixed(2);
            const inputId = `track-${segmentIndex}-${pointKey}-${axis}`;
            label.setAttribute('for', inputId);
            input.id = inputId;
            input.dataset.segment = String(segmentIndex);
            input.dataset.point = pointKey;
            input.dataset.axis = axis;
            wrapper.appendChild(label);
            wrapper.appendChild(input);
        });

        return wrapper;
    }

    function formatPointDisplay(prefix, point) {
        return `${prefix} (x: ${point.x.toFixed(2)}, y: ${point.y.toFixed(2)}, z: ${point.z.toFixed(2)})`;
    }

    function updateLinkedStartLabel(segmentIndex) {
        const startLabel = document.querySelector(`[data-start="segment-${segmentIndex}"]`);
        if (startLabel && state.craneTrackSegments[segmentIndex]) {
            const startPoint = state.craneTrackSegments[segmentIndex].p0;
            startLabel.textContent = formatPointDisplay('起点', startPoint);
        }
    }

    function handleTrackInputChange(event) {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;

        const { segment, point, axis } = target.dataset;
        if (segment === undefined || !point || !axis) return;

        const segmentIndex = parseInt(segment, 10);
        if (Number.isNaN(segmentIndex)) return;

        const value = parseFloat(target.value);
        if (Number.isNaN(value)) return;

        const segmentData = state.craneTrackSegments[segmentIndex];
        if (!segmentData || !segmentData[point]) return;

        segmentData[point][axis] = value;
        target.value = value.toFixed(2);

        if (point === 'p3' && segmentIndex + 1 < state.craneTrackSegments.length) {
            const nextSegment = state.craneTrackSegments[segmentIndex + 1];
            nextSegment.p0[axis] = value;
            updateLinkedStartLabel(segmentIndex + 1);
        }

        if (point === 'p0' && segmentIndex > 0) {
            const previousSegment = state.craneTrackSegments[segmentIndex - 1];
            previousSegment.p3[axis] = value;
            updateLinkedStartLabel(segmentIndex);
        }

        buildCrane();
    }

    function initializeCraneTrackUi() {
        const segmentsInput = document.getElementById('craneSegments');
        if (segmentsInput) {
            segmentsInput.value = state.craneTrackSegments.length;
            segmentsInput.addEventListener('change', (event) => {
                const desired = clampInt(event.target.value, 1, 6, state.craneTrackSegments.length);
                resizeCraneTrackSegments(desired);
                segmentsInput.value = state.craneTrackSegments.length;
                renderCraneTrackControls();
                buildCrane();
            });
        }

        const editor = document.getElementById('craneTrackEditor');
        if (editor) {
            editor.addEventListener('input', handleTrackInputChange);
        }

        renderCraneTrackControls();
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
