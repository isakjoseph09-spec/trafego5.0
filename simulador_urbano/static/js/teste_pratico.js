(() => {
    "use strict";

    const container = document.querySelector("#practice-canvas");
    if (!container || !window.THREE) {
        if (container) container.innerHTML = '<div class="practice-fallback">Não foi possível carregar o renderizador 3D. Verifique a conexão com a biblioteca Three.js.</div>';
        return;
    }

    const requiredSelectors = [
        "#practice-radar",
        "#practice-avg-speed",
        "#practice-avg-wait",
        "#practice-flow",
        "#practice-day",
        "#practice-reset",
        "#practice-green",
        "#practice-green-output",
        "#practice-density",
        "#practice-density-output",
        "#practice-train",
        "#practice-train-output"
    ];
    const missingSelectors = requiredSelectors.filter((selector) =>
        !document.querySelector(selector)
    );
    if (missingSelectors.length) {
        console.error("A página do simulador não contém todos os controles necessários.", missingSelectors);
        container.innerHTML = '<div class="practice-fallback">A página do simulador está incompleta. Recarregue-a ou informe o erro ao suporte.</div>';
        return;
    }

    function updateAccidentHazards() {
        if (!state.accidentState) return;
        const flashing = Math.floor(performance.now() / 280) % 2 === 0;
        const vehicles = state.accidentState.involvedVehicles.slice();
        if (state.accidentIsPlayer) vehicles.push(manualCar);
        vehicles.forEach((vehicle) => {
            const lights = vehicle.userData.lights;
            if (!lights) return;
            const color = flashing ? 0xffad38 : 0x4a351a;
            lights.turnLeft.material.color.setHex(color);
            lights.turnRight.material.color.setHex(color);
        });
    }

    const state = {
        greenTime: 25,
        density: 18,
        trainInterval: 35,
        trainElapsed: 0,
        trainActive: false,
        trainDirection: 1,
        trainX: -80,
        aerial: false,
        trafficElapsed: 0,
        waiting: 0,
        intersectionOwner: null,
        aiStatusUpdatedAt: 0,
        passed: 0,
        collisions: 0,
        infractions: 0,
        dusk: false,
        cameraShake: 0,
        alertUntil: 0,
        trafficScale: 1,
        paused: false,
        freeCameraTarget: new THREE.Vector3(),
        audioEnabled: false,
        freeCameraYaw: 0,
        freeCameraPitch: .58,
        freeCameraDistance: 125,
        cameraMode: 3,
        cameraLookSide: 0,
        secondPersonFront: false,
        gear: "P",
        steerAngle: 0,
        policeResponse: 0,
        policeStatus: "Sem ocorrências",
        policeActive: false,
        policeElapsed: 0,
        policeMode: null,
        policeTarget: null,
        policeSpawnedAt: 0,
        policeCollisionCount: 0,
        accidentVehicle: null,
        accidentIsPlayer: false,
        accidentPosition: null,
        accidentHeading: 0,
        accidentState: null,
        accidentSmoke: [],
        accidentSmokeElapsed: 0,
        ambulance: null,
        patients: [],
        paramedic: null,
        towTruck: null,
        officer: null,
        towHud: null,
        towCountdown: 0,
        loopErrors: new Map()
    };

    function runLoopModule(name, callback) {
        try {
            callback();
            return true;
        } catch (error) {
            const now = performance.now();
            const record = state.loopErrors.get(name) || { count: 0, lastReported: 0 };
            record.count += 1;
            if (record.count === 1 || now - record.lastReported >= 5000) {
                console.error(`Falha isolada no módulo ${name}; o ciclo de simulação continuará.`, error);
                record.lastReported = now;
            }
            state.loopErrors.set(name, record);
            return false;
        }
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9bc4a4);
    scene.fog = new THREE.FogExp2(0x9bc4a4, 0.0038);

    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 420);
    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch (error) {
        console.error("Não foi possível iniciar o renderizador 3D do simulador.", error);
        container.innerHTML = '<div class="practice-fallback">Não foi possível iniciar o renderizador 3D neste navegador.</div>';
        return;
    }
    const clock = new THREE.Clock();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xeaf6ff, 0x486040, 0.9));
    const sun = new THREE.DirectionalLight(0xfff4d6, 1.15);
    sun.position.set(-35, 55, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -70;
    sun.shadow.camera.right = 70;
    sun.shadow.camera.top = 70;
    sun.shadow.camera.bottom = -70;
    scene.add(sun);

    function mat(color, roughness = 0.78, metalness = 0.08) {
        return new THREE.MeshStandardMaterial({ color, roughness, metalness });
    }

    function box(parent, size, position, color, options = {}) {
        const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(size[0], size[1], size[2]),
            mat(color, options.roughness, options.metalness)
        );
        mesh.position.set(position[0], position[1], position[2]);
        mesh.castShadow = options.castShadow !== false;
        mesh.receiveShadow = options.receiveShadow !== false;
        parent.add(mesh);
        return mesh;
    }

    function cylinder(parent, radius, height, position, color, segments = 12) {
        const mesh = new THREE.Mesh(
            new THREE.CylinderGeometry(radius, radius, height, segments),
            mat(color)
        );
        mesh.position.set(position[0], position[1], position[2]);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        parent.add(mesh);
        return mesh;
    }

    const WORLD_HALF = 120;
    const WORLD_SIZE = WORLD_HALF * 2;
    const SIDE_STREET_OFFSET = 72;
    const SIDE_STREET_WIDTH = 18;
    const ground = box(scene, [WORLD_SIZE + 20, 0.2, WORLD_SIZE + 20], [0, -0.11, 0], 0x367b4e);
    ground.receiveShadow = true;

    // Connected avenue grid around the central signalized junction.
    box(scene, [WORLD_SIZE, 0.16, 24], [0, 0.03, 0], 0x30363a);
    box(scene, [24, 0.17, WORLD_SIZE], [0, 0.04, 0], 0x30363a);
    for (const offset of [-SIDE_STREET_OFFSET, SIDE_STREET_OFFSET]) {
        box(scene, [WORLD_SIZE, 0.15, SIDE_STREET_WIDTH], [0, 0.025, offset], 0x30363a);
        box(scene, [SIDE_STREET_WIDTH, 0.15, WORLD_SIZE], [offset, 0.025, 0], 0x30363a);
        box(scene, [WORLD_SIZE, 0.1, 1.4], [0, 0.14, offset - SIDE_STREET_WIDTH / 2 - .7], 0x87918d);
        box(scene, [WORLD_SIZE, 0.1, 1.4], [0, 0.14, offset + SIDE_STREET_WIDTH / 2 + .7], 0x87918d);
        box(scene, [1.4, 0.1, WORLD_SIZE], [offset - SIDE_STREET_WIDTH / 2 - .7, 0.14, 0], 0x87918d);
        box(scene, [1.4, 0.1, WORLD_SIZE], [offset + SIDE_STREET_WIDTH / 2 + .7, 0.14, 0], 0x87918d);
    }
    box(scene, [WORLD_SIZE, 0.12, 2.2], [0, 0.16, 13], 0x87918d);
    box(scene, [WORLD_SIZE, 0.12, 2.2], [0, 0.16, -13], 0x87918d);
    box(scene, [2.2, 0.12, WORLD_SIZE], [13, 0.16, 0], 0x87918d);
    box(scene, [2.2, 0.12, WORLD_SIZE], [-13, 0.16, 0], 0x87918d);

    for (let x = -WORLD_HALF + 4; x <= WORLD_HALF - 4; x += 8) {
        if (Math.abs(x) > 14) box(scene, [3.4, 0.025, 0.14], [x, 0.17, 0], 0xe6e0ad);
        for (const offset of [-SIDE_STREET_OFFSET, SIDE_STREET_OFFSET]) {
            box(scene, [3.4, 0.025, 0.14], [x, 0.17, offset], 0xe6e0ad);
        }
    }
    for (let z = -WORLD_HALF + 4; z <= WORLD_HALF - 4; z += 8) {
        if (Math.abs(z) > 14) box(scene, [0.14, 0.025, 3.4], [0, 0.17, z], 0xe6e0ad);
        for (const offset of [-SIDE_STREET_OFFSET, SIDE_STREET_OFFSET]) {
            box(scene, [0.14, 0.025, 3.4], [offset, 0.17, z], 0xe6e0ad);
        }
    }
    for (const offset of [-SIDE_STREET_OFFSET, SIDE_STREET_OFFSET]) {
        for (let stripe = -5; stripe <= 5; stripe += 1) {
            const mark = stripe * 1.65;
            [-1, 1].forEach((side) => {
                box(scene, [1.05, 0.025, 12], [side * 12 + mark, 0.18, offset], 0xf1efe3);
                box(scene, [12, 0.025, 1.05], [offset, 0.18, side * 12 + mark], 0xf1efe3);
            });
        }
    }

    // Pedestrian crossings
    [-10.5, 10.5].forEach((z) => {
        for (let x = -9; x <= 9; x += 2.25) {
            box(scene, [1.25, 0.025, 4], [x, 0.19, z], 0xf1efe3);
        }
    });
    [-10.5, 10.5].forEach((x) => {
        for (let z = -9; z <= 9; z += 2.25) {
            box(scene, [4, 0.025, 1.25], [x, 0.19, z], 0xf1efe3);
        }
    });

    // Central square and plaza
    cylinder(scene, 5.8, 0.25, [0, 0.14, 0], 0x778c73, 32);
    cylinder(scene, 3.2, 0.28, [0, 0.29, 0], 0xb0bb9f, 32);
    cylinder(scene, 0.35, 4.2, [0, 2.1, 0], 0x8a7a62, 10);
    cylinder(scene, 1.8, 0.55, [0, 4.45, 0], 0x3d7652, 12);

    function addBuilding(x, z, w, d, h, color) {
        box(scene, [w, h, d], [x, h / 2, z], color);
        box(scene, [w + 0.5, 0.3, d + 0.5], [x, h + 0.15, z], 0x69747a);
        for (let floor = 1; floor < h - 1; floor += 2.2) {
            box(scene, [w * 0.25, 0.55, 0.08], [x - w * 0.25, floor, z + d / 2 + 0.04], 0x8ab1b9);
            box(scene, [w * 0.25, 0.55, 0.08], [x + w * 0.25, floor, z + d / 2 + 0.04], 0x8ab1b9);
        }
    }

    addBuilding(-31, -31, 12, 10, 8, 0xaeb5af);
    addBuilding(32, -29, 14, 12, 11, 0x9da8a6);
    addBuilding(-34, 32, 15, 11, 10, 0xb7b8aa);
    addBuilding(34, 33, 11, 13, 7, 0xa5aaa2);

    const HOSPITAL_X = 52;
    const HOSPITAL_BAY = new THREE.Vector3(HOSPITAL_X, .45, 9);
    const HOSPITAL_ENTRANCE = new THREE.Vector3(HOSPITAL_X, .45, 14);
    function addHospital() {
        box(scene, [18, 12, 18], [HOSPITAL_X, 6, 23], 0xd7dfdc);
        box(scene, [18.8, .35, 18.8], [HOSPITAL_X, 12.18, 23], 0x7d898c);
        box(scene, [3, 3.4, .18], [HOSPITAL_X, 1.8, 13.82], 0x477080);
        box(scene, [18, .35, .18], [HOSPITAL_X, 12.35, 13.78], 0xb73238);
        box(scene, [16, .12, .18], [HOSPITAL_X, 12.1, 13.77], 0xf2f2eb);
        box(scene, [.85, 3.3, .24], [HOSPITAL_X, 9.2, 13.55], 0xd9222a);
        box(scene, [3, .85, .24], [HOSPITAL_X, 9.2, 13.55], 0xd9222a);
        const crossLight = new THREE.PointLight(0xff3038, 2.2, 24);
        crossLight.position.set(HOSPITAL_X, 9.2, 12.6);
        scene.add(crossLight);

        const labelCanvas = document.createElement("canvas");
        labelCanvas.width = 512;
        labelCanvas.height = 128;
        const context = labelCanvas.getContext("2d");
        context.fillStyle = "#b51f2b";
        context.fillRect(0, 0, labelCanvas.width, labelCanvas.height);
        context.fillStyle = "#ffffff";
        context.font = "bold 58px Segoe UI, sans-serif";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText("HOSPITAL · PRONTO-SOCORRO", 256, 64);
        const label = new THREE.Sprite(new THREE.SpriteMaterial({
            map: new THREE.CanvasTexture(labelCanvas),
            transparent: false
        }));
        label.position.set(HOSPITAL_X, 7, 13.45);
        label.scale.set(12, 3, 1);
        scene.add(label);

        box(scene, [9, .12, 18], [HOSPITAL_X, .12, 6], 0x30363a);
        for (let x = HOSPITAL_X - 5; x <= HOSPITAL_X + 5; x += 10) {
            box(scene, [.16, .03, 7], [x, .21, 7], 0xf2d15d);
        }
        box(scene, [3.2, .04, 2], [HOSPITAL_X, .23, 8], 0xf1efe3);
    }
    addHospital();

    function addTree(x, z) {
        cylinder(scene, 0.18, 1.4, [x, 0.7, z], 0x704b34, 8);
        const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.15, 1), mat(0x2f8050));
        crown.position.set(x, 2.15, z);
        crown.castShadow = true;
        scene.add(crown);
    }
    [[-21,-20],[21,-20],[-21,20],[21,20],[-48,21],[48,-21],[-48,-21],[48,21]]
        .forEach(([x, z]) => addTree(x, z));

    // Railway line perpendicular to the main street
    for (let z = -WORLD_HALF; z <= WORLD_HALF; z += 4) {
        box(scene, [0.28, 0.12, 3.2], [z, 0.24, 24], 0x4d3b2b);
    }
    box(scene, [WORLD_SIZE, 0.08, 0.24], [0, 0.28, 21.2], 0xbfc2bd);
    box(scene, [WORLD_SIZE, 0.08, 0.24], [0, 0.28, 26.8], 0xbfc2bd);

    function addLamp(x, z) {
        cylinder(scene, 0.09, 4.2, [x, 2.1, z], 0x3f494d, 8);
        box(scene, [0.7, 0.18, 0.7], [x, 4.22, z], 0xe0d99a);
    }
    [[-16,-16],[16,-16],[-16,16],[16,16],[-48,16],[48,-16]]
        .forEach(([x, z]) => addLamp(x, z));

    // Traffic lights at the four approaches
    const trafficLights = [];
    function addTrafficLight(x, z, rotation = 0) {
        const group = new THREE.Group();
        group.position.set(x, 0, z);
        group.rotation.y = rotation;
        cylinder(group, 0.09, 3.4, [0, 1.7, 0], 0x30383a, 8);
        box(group, [1.1, 2.2, 0.7], [0, 3.2, 0], 0x20272a);
        const red = cylinder(group, 0.28, 0.12, [0, 3.75, 0.37], 0xff3f49, 12);
        const yellow = cylinder(group, 0.28, 0.12, [0, 3.18, 0.37], 0xffca49, 12);
        const green = cylinder(group, 0.28, 0.12, [0, 2.61, 0.37], 0x35cf78, 12);
        red.rotation.x = Math.PI / 2;
        yellow.rotation.x = Math.PI / 2;
        green.rotation.x = Math.PI / 2;
        scene.add(group);
        trafficLights.push({ red, yellow, green });
    }
    addTrafficLight(-12, -12, 0);
    addTrafficLight(12, 12, Math.PI);
    addTrafficLight(-12, 12, -Math.PI / 2);
    addTrafficLight(12, -12, Math.PI / 2);

    function setTrafficLightColor() {
        trafficLights.forEach((light, index) => {
            const color = getSignalColor(index >= 2);
            light.green.material.color.setHex(color === "green" ? 0x35cf78 : 0x1b4a30);
            light.yellow.material.color.setHex(color === "yellow" ? 0xffca49 : 0x594f2a);
            light.red.material.color.setHex(color === "red" ? 0xff3f49 : 0x55242a);
        });
    }

    // Train
    const train = new THREE.Group();
    const locomotive = box(train, [8, 3.2, 3.5], [-4, 1.9, 24], 0xb94d3e);
    box(train, [3.2, 2.6, 3.8], [-7, 4.2, 24], 0x30383a);
    box(train, [2.2, 1.4, 3.9], [-7, 4.2, 24], 0xbfd5d7);
    for (let i = 1; i <= 4; i += 1) {
        box(train, [7, 2.8, 3.4], [-4 - i * 8.5, 1.6, 24], i % 2 ? 0x4f6e8a : 0x8a5a45);
    }
    scene.add(train);
    train.position.x = state.trainX;

    const smoke = [];
    function addSmoke() {
        if (!state.trainActive || smoke.length > 28) return;
        const puff = new THREE.Mesh(
            new THREE.SphereGeometry(0.35 + Math.random() * 0.35, 8, 6),
            new THREE.MeshStandardMaterial({ color: 0xcfd4d0, transparent: true, opacity: 0.55 })
        );
        puff.position.set(train.position.x - 10, 6.5 + Math.random(), 24);
        puff.userData.life = 0;
        scene.add(puff);
        smoke.push(puff);
    }

    const barrierGroups = [];
    function addBarrier(x, z, rotation) {
        const group = new THREE.Group();
        group.position.set(x, 0, z);
        group.rotation.y = rotation;
        cylinder(group, 0.18, 2.5, [0, 1.25, 0], 0xe6e8e5, 10);
        const arm = box(group, [10, 0.25, 0.25], [5, 2.25, 0], 0xf2e9cf);
        for (let i = 0; i < 5; i += 1) {
            box(arm, [0.9, 0.27, 0.27], [-3 + i * 2.2, 0, 0.14], i % 2 ? 0xe64b43 : 0xf2e9cf);
        }
        const red = cylinder(group, 0.28, 0.12, [0, 2.7, 0.5], 0xff3f49, 12);
        red.rotation.x = Math.PI / 2;
        scene.add(group);
        barrierGroups.push({ arm, red, group });
    }
    addBarrier(-12, 24, -Math.PI / 2);
    addBarrier(12, 24, Math.PI / 2);

    function setBarrier(active) {
        barrierGroups.forEach((barrier) => {
            barrier.arm.rotation.z = active ? -1.35 : 0;
            barrier.arm.position.y = active ? 2.15 : 2.25;
            barrier.red.material.color.setHex(active && Math.floor(performance.now() / 350) % 2
                ? 0xff222e
                : 0x5a2528);
        });
    }

    function rememberAiPosition(car) {
        const data = car.userData;
        if (Number.isFinite(car.position.x) && Number.isFinite(car.position.z)) {
            data.lastFinitePosition.copy(car.position);
        }
    }

    function recoverAiVehicle(car, reason) {
        const data = car.userData;
        if (!data.invalidStateReported) {
            console.error("Estado inválido no veículo da IA; posição e velocidade foram recuperadas.", {
                reason,
                x: car.position.x,
                z: car.position.z,
                heading: car.rotation.y
            });
            data.invalidStateReported = true;
        }
        if (!Number.isFinite(car.position.x) || !Number.isFinite(car.position.z)) {
            car.position.copy(data.lastFinitePosition);
        }
        if (!Number.isFinite(car.rotation.y)) {
            car.rotation.y = data.horizontal
                ? (data.direction > 0 ? Math.PI / 2 : -Math.PI / 2)
                : (data.direction > 0 ? 0 : Math.PI);
        }
        if (!Number.isFinite(data.speed)) data.speed = 0;
        data.roundaboutMode = "road";
        data.crashed = false;
        rememberAiPosition(car);
    }

    // Player and AI vehicles
    const keys = new Set();
    const manual = {
        position: new THREE.Vector3(-42, 0.45, -5),
        lastFinitePosition: new THREE.Vector3(-42, 0.45, -5),
        heading: 0,
        speed: 0,
        velocity: new THREE.Vector3(),
        mass: 1450,
        steerAngle: 0,
        reverseTarget: false
    };

    function recoverManualVehicle(reason) {
        console.error("Estado inválido no veículo do jogador; restaurando a última posição segura.", reason);
        manual.position.copy(manual.lastFinitePosition);
        manual.heading = Number.isFinite(manual.heading) ? manual.heading : 0;
        manual.speed = 0;
        manual.velocity.set(0, 0, 0);
    }

    function createVehicle(color, type = "sedan") {
        const group = new THREE.Group();
        const dimensions = {
            hatch: [3.1, 1.05, 4.7],
            sedan: [3.2, 1.12, 5.4],
            suv: [3.5, 1.45, 5.7],
            onibus: [3.8, 2.8, 10.5],
            caminhao: [3.6, 2.2, 8.2]
        };
        const size = dimensions[type] || dimensions.sedan;
        box(group, size, [0, size[1] / 2 + 0.22, 0], color, {
            roughness: .28,
            metalness: .68
        });
        box(group, [size[0] * .84, size[1] * .52, size[2] * .48], [0, size[1] * 1.15, -size[2] * .06], 0x94bac2);
        box(group, [.55, .28, .08], [-size[0] * .28, size[1] * .72, size[2] / 2 + .04], 0xfff1ae);
        box(group, [.55, .28, .08], [size[0] * .28, size[1] * .72, size[2] / 2 + .04], 0xfff1ae);
        const brakeLeft = box(group, [.55, .28, .08], [-size[0] * .28, size[1] * .72, -size[2] / 2 - .04], 0xa52f33);
        const brakeRight = box(group, [.55, .28, .08], [size[0] * .28, size[1] * .72, -size[2] / 2 - .04], 0xa52f33);
        const turnLeft = box(group, [.16, .18, .08], [-size[0] * .46, size[1] * .55, size[2] / 2 + .05], 0xffad38);
        const turnRight = box(group, [.16, .18, .08], [size[0] * .46, size[1] * .55, size[2] / 2 + .05], 0xffad38);
        const frontWheels = [];
        [-1, 1].forEach((side) => {
            [-1, 1].forEach((axle) => {
                const steeringPivot = new THREE.Group();
                steeringPivot.position.set(side * (size[0] * .43), .42, axle * (size[2] * .34));
                const wheel = cylinder(steeringPivot, .42, .32, [0, 0, 0], 0x202428, 12);
                wheel.rotation.z = Math.PI / 2;
                group.add(steeringPivot);
                if (axle > 0) frontWheels.push(steeringPivot);
            });
        });
        group.userData.lights = { brakeLeft, brakeRight, turnLeft, turnRight };
        group.userData.size = size;
        group.userData.type = type;
        group.userData.frontWheels = frontWheels;
        return group;
    }
    const manualCar = createVehicle(0xf4c94d);
    scene.add(manualCar);

    const aiVehicles = [];
    const aiColors = [0x4f91d2, 0xdf6c55, 0x64c7a1, 0x9e83d4, 0xe8edf2];
    const vehicleTypes = ["hatch", "sedan", "suv", "onibus", "caminhao"];
    function chooseTurnIntent(index, turnCount) {
        const choice = (index + turnCount * 3) % 10;
        if (choice === 0) return "roundabout";
        if (choice === 3) return "left";
        if (choice === 7) return "right";
        return "straight";
    }

    function addAiVehicle(index) {
        const horizontal = index % 2 === 0;
        const direction = index % 4 < 2 ? 1 : -1;
        const centerProgressSlots = [-100, -80, -60, -40, -20, 20, 40, 60, 80, 100];
        const sameLane = aiVehicles.filter((other) =>
            other.userData.horizontal === horizontal &&
            other.userData.direction === direction &&
            other.userData.roundaboutMode === "road" &&
            !other.userData.maneuverPath
        );
        const centerProgress = centerProgressSlots.reduce((best, candidate) => {
            const candidateGap = sameLane.reduce((gap, other) => {
                const progress = horizontal
                    ? other.position.x * direction
                    : other.position.z * direction;
                return Math.min(gap, Math.abs(progress - candidate));
            }, Infinity);
            const bestGap = sameLane.reduce((gap, other) => {
                const progress = horizontal
                    ? other.position.x * direction
                    : other.position.z * direction;
                return Math.min(gap, Math.abs(progress - best));
            }, Infinity);
            return candidateGap > bestGap ? candidate : best;
        }, centerProgressSlots[0]);
        const lane = horizontal
            ? (direction > 0 ? -4.3 : 4.3)
            : (direction > 0 ? 4.3 : -4.3);
        const type = vehicleTypes[index % vehicleTypes.length];
        const car = createVehicle(aiColors[index % aiColors.length], type);
        car.position.set(
            horizontal ? centerProgress * direction : lane,
            0.45,
            horizontal ? lane : centerProgress * direction
        );
        car.userData = {
            ...car.userData,
            index,
            horizontal,
            direction,
            speed: 0,
            lastFinitePosition: car.position.clone(),
            desiredSpeed: 11.1,
            roundaboutSpeed: 6.95,
            waiting: 0,
            turning: false,
            reactionTime: .28 + (index % 5) * .08,
            reactionElapsed: 0,
            collisionGuard: 0,
            intersectionGranted: false,
            decidedAtCrossing: false,
            hazardUntil: 0,
            roundaboutMode: "road",
            roundaboutAngle: 0,
            roundaboutProgress: 0,
            roundaboutDirection: 1,
            roundaboutExitAngle: 0,
            turnCount: 0,
            turnIntent: chooseTurnIntent(index, 0),
            maneuverPath: null,
            maneuverKind: null
        };
        scene.add(car);
        aiVehicles.push(car);
    }
    function syncAiCount() {
        while (aiVehicles.length < state.density) addAiVehicle(aiVehicles.length);
        while (aiVehicles.length > state.density) {
            const removed = aiVehicles.pop();
            if (state.intersectionOwner === removed) state.intersectionOwner = null;
            scene.remove(removed);
        }
    }
    syncAiCount();

    const policeCar = createVehicle(0xf1f4f6, "sedan");
    policeCar.visible = false;
    policeCar.position.set(-WORLD_HALF + 4, .45, -4.3);
    policeCar.rotation.y = Math.PI / 2;
    const policeLights = new THREE.Group();
    const policeRed = box(policeLights, [.8, .28, .32], [-.55, 1.95, 0], 0xff1838);
    const policeBlue = box(policeLights, [.8, .28, .32], [.55, 1.95, 0], 0x2d62ff);
    policeCar.add(policeLights);
    scene.add(policeCar);

    function createOfficer(shirt = 0x233d67, pants = 0x182b48, capColor = shirt) {
        const officer = new THREE.Group();
        box(officer, [.62, .78, .34], [0, 1.25, 0], shirt);
        box(officer, [.66, .12, .37], [0, .88, 0], 0x20262b);
        const badge = box(officer, [.13, .16, .04], [-.2, 1.42, .19], 0xf4c84a);
        badge.castShadow = false;
        const head = new THREE.Mesh(new THREE.SphereGeometry(.24, 12, 10), mat(0xb87953));
        head.position.set(0, 1.84, 0);
        head.castShadow = true;
        officer.add(head);
        box(officer, [.48, .13, .42], [0, 2.06, 0], capColor);
        const limbs = [];
        [-1, 1].forEach((side) => {
            const arm = new THREE.Group();
            arm.position.set(side * .38, 1.55, 0);
            box(arm, [.2, .62, .22], [0, -.28, 0], shirt);
            officer.add(arm);
            limbs.push(arm);
            const leg = new THREE.Group();
            leg.position.set(side * .17, .87, 0);
            box(leg, [.24, .72, .28], [0, -.33, 0], pants);
            officer.add(leg);
            limbs.push(leg);
        });
        officer.userData.limbs = limbs;
        officer.visible = false;
        scene.add(officer);
        return officer;
    }

    function createTowTruck() {
        const truck = new THREE.Group();
        box(truck, [3.5, .9, 12.5], [0, .6, -1.1], 0xc6cdd0);
        box(truck, [3.5, 2.1, 3.8], [0, 1.85, 3.5], 0xf2f2eb);
        box(truck, [2.95, .9, .12], [0, 2.25, 5.42], 0x83aeb9);
        box(truck, [3.2, .22, 8.3], [0, 1.18, -2.45], 0x59656a);
        const ramp = new THREE.Group();
        ramp.position.set(0, 1.15, -6.6);
        box(ramp, [3.15, .16, 4], [0, 0, -2], 0x7d898d);
        for (let side = -1; side <= 1; side += 2) {
            box(ramp, [.12, .22, 4], [side * 1.48, .12, -2], 0xd0a744);
        }
        truck.add(ramp);
        const amberLights = [];
        [-.9, .9].forEach((x) => {
            amberLights.push(box(truck, [.45, .2, .3], [x, 3, 3.5], 0xffae24));
        });
        for (const x of [-1.72, 1.72]) {
            for (const z of [-5, -1.5, 2.4]) {
                const wheel = cylinder(truck, .52, .34, [x, .48, z], 0x202428, 12);
                wheel.rotation.z = Math.PI / 2;
            }
        }
        truck.userData.ramp = ramp;
        truck.userData.amberLights = amberLights;
        truck.userData.size = [3.5, 2.4, 12.5];
        truck.visible = false;
        scene.add(truck);
        return truck;
    }

    function createAmbulance() {
        const ambulance = new THREE.Group();
        box(ambulance, [3.4, 2.2, 6.8], [0, 1.45, 0], 0xf2f4f3);
        box(ambulance, [3.1, 1.25, 3.2], [0, 2.45, -.25], 0xe7eeed);
        box(ambulance, [2.95, .85, .12], [0, 2.45, 3.02], 0x87b9c5);
        box(ambulance, [3.45, .42, 5.7], [0, 1.38, 0], 0xd92d38);
        box(ambulance, [1.12, .32, .16], [0, 2.15, 3.48], 0xf7f7f2);
        box(ambulance, [.32, 1.12, .16], [0, 2.15, 3.48], 0xf7f7f2);
        const beacons = [
            box(ambulance, [.72, .24, .24], [-.72, 3.15, .55], 0xff3038),
            box(ambulance, [.72, .24, .24], [.72, 3.15, .55], 0xff3038)
        ];

        const rearDoors = [];
        [-1, 1].forEach((side) => {
            const hinge = new THREE.Group();
            hinge.position.set(side * 1.65, 1.65, -3.4);
            box(hinge, [1.6, 2.05, .12], [-side * .8, 0, 0], 0xf2f4f3);
            ambulance.add(hinge);
            rearDoors.push(hinge);
        });
        for (const x of [-1.72, 1.72]) {
            for (const z of [-2.2, 2.2]) {
                const wheel = cylinder(ambulance, .48, .32, [x, .48, z], 0x202428, 12);
                wheel.rotation.z = Math.PI / 2;
            }
        }
        ambulance.userData.rearDoors = rearDoors;
        ambulance.userData.beacons = beacons;
        ambulance.userData.size = [3.4, 3.2, 6.8];
        ambulance.visible = false;
        scene.add(ambulance);
        return ambulance;
    }

    state.officer = createOfficer();
    state.towTruck = createTowTruck();
    state.ambulance = createAmbulance();
    state.patients = [
        createOfficer(0x387c96, 0x35485a, 0x387c96),
        createOfficer(0x8c644d, 0x394857, 0x8c644d)
    ];
    state.paramedic = createOfficer(0x57a997, 0x254858, 0xeaf0ed);
    [...state.patients, state.paramedic].forEach((person) => {
        person.visible = false;
        scene.add(person);
    });

    const towHud = document.createElement("div");
    towHud.setAttribute("role", "alert");
    towHud.setAttribute("aria-live", "assertive");
    towHud.style.cssText = "position:absolute;z-index:5;top:72px;left:50%;transform:translateX(-50%);width:min(420px,calc(100% - 24px));padding:14px;border:1px solid #ffc857;border-radius:10px;background:rgba(20,25,29,.96);color:#fff;text-align:center;font:700 14px/1.45 'Segoe UI',sans-serif;box-shadow:0 8px 26px rgba(0,0,0,.4)";
    const towMessage = document.createElement("div");
    towMessage.textContent = "Veículo apreendido e rebocado por infração/colisão.";
    const towButton = document.createElement("button");
    towButton.type = "button";
    towButton.textContent = "Receber novo veículo";
    towButton.style.cssText = "margin-top:10px;padding:8px 12px;border:0;border-radius:6px;background:#2ecc71;color:#10251a;font-weight:800;cursor:pointer";
    towHud.append(towMessage, towButton);
    towHud.hidden = true;
    state.towHud = towHud;
    container.style.position = "relative";
    container.append(towHud);

    function shortestAngleDifference(target, current) {
        let delta = target - current;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        return delta;
    }

    function smoothYaw(current, target, amount) {
        return current + shortestAngleDifference(target, current) * amount;
    }

    function moveToward(current, target, step) {
        return current < target
            ? Math.min(current + step, target)
            : Math.max(current - step, target);
    }

    function getAiForward(data) {
        return data.horizontal
            ? new THREE.Vector3(data.direction, 0, 0)
            : new THREE.Vector3(0, 0, data.direction);
    }

    function createCurvePath(start, end, startHeading, endHeading, controlLength) {
        const startDirection = new THREE.Vector3(
            Math.sin(startHeading), 0, Math.cos(startHeading)
        );
        const endDirection = new THREE.Vector3(
            Math.sin(endHeading), 0, Math.cos(endHeading)
        );
        const control1 = start.clone().addScaledVector(startDirection, controlLength);
        const control2 = end.clone().addScaledVector(endDirection, -controlLength);
        const points = [];
        const cumulative = [0];
        let length = 0;
        const segments = 32;

        for (let index = 0; index <= segments; index += 1) {
            const t = index / segments;
            const inverse = 1 - t;
            const point = start.clone().multiplyScalar(inverse * inverse * inverse)
                .addScaledVector(control1, 3 * inverse * inverse * t)
                .addScaledVector(control2, 3 * inverse * t * t)
                .addScaledVector(end, t * t * t);
            if (points.length) {
                length += point.distanceTo(points[points.length - 1]);
                cumulative.push(length);
            }
            points.push(point);
        }

        return { points, cumulative, length, distance: 0 };
    }

    function advanceAlongCurve(car, path, distance) {
        path.distance = Math.min(path.length, path.distance + distance);
        let index = 1;
        while (index < path.cumulative.length && path.cumulative[index] < path.distance) {
            index += 1;
        }
        index = Math.min(index, path.points.length - 1);
        const previous = path.points[index - 1];
        const next = path.points[index];
        const segmentLength = path.cumulative[index] - path.cumulative[index - 1];
        const progress = segmentLength > 0
            ? (path.distance - path.cumulative[index - 1]) / segmentLength
            : 1;
        car.position.lerpVectors(previous, next, progress);
        const tangent = next.clone().sub(previous);
        if (tangent.lengthSq() > 0) {
            car.rotation.y = Math.atan2(tangent.x, tangent.z);
        }
        return path.distance >= path.length;
    }

    function getSafeSpeedAhead(car, forward, targetSpeed, delta = .008) {
        if (!Number.isFinite(targetSpeed) ||
            !Number.isFinite(forward.x) || !Number.isFinite(forward.z)) {
            return 0;
        }
        const right = new THREE.Vector3(forward.z, 0, -forward.x);
        const candidates = aiVehicles.filter((other) =>
            other !== car && other.userData.roundaboutMode !== "circle"
        );
        candidates.push(manualCar);
        if (state.policeActive) candidates.push(policeCar);
        if (state.towTruck && state.towTruck.visible) candidates.push(state.towTruck);
        if (state.ambulance && state.ambulance.visible) candidates.push(state.ambulance);

        let safeSpeed = targetSpeed;
        let foundNearbyObstacle = false;
        candidates.forEach((obstacle) => {
            if (!obstacle.visible) return;
            const dx = obstacle.position.x - car.position.x;
            const dz = obstacle.position.z - car.position.z;
            const ahead = dx * forward.x + dz * forward.z;
            const lateral = Math.abs(dx * right.x + dz * right.z);
            if (!Number.isFinite(ahead) || !Number.isFinite(lateral) ||
                !Number.isFinite(obstacle.rotation.y)) {
                if (aiVehicles.includes(obstacle)) {
                    recoverAiVehicle(obstacle, "invalid state while checking following distance");
                } else if (!obstacle.userData.invalidObstacleReported) {
                    console.error("Veículo de emergência ou jogador com posição inválida na verificação de distância.", obstacle);
                    obstacle.userData.invalidObstacleReported = true;
                }
                return;
            }

            const obstacleForward = new THREE.Vector3(
                Math.sin(obstacle.rotation.y), 0, Math.cos(obstacle.rotation.y)
            );
            const obstacleSpeed = obstacle === manualCar
                ? Math.abs(manual.speed)
                : Math.abs((obstacle.userData && obstacle.userData.speed) || 0);

            const size = obstacle.userData.size || [3.2, 1.2, 6];
            if (!Number.isFinite(size[0]) || !Number.isFinite(size[2])) {
                if (!obstacle.userData.invalidObstacleReported) {
                    console.error("Dimensões inválidas em um veículo usado no controle de distância.", size);
                    obstacle.userData.invalidObstacleReported = true;
                }
                return;
            }
            if (obstacle === manualCar || aiVehicles.includes(obstacle)) {
                const ownVelocity = forward.clone().multiplyScalar(car.userData.speed);
                const obstacleVelocity = obstacle === manualCar
                    ? manual.velocity
                    : obstacleForward.clone().multiplyScalar(obstacleSpeed);
                const relativeVelocityX = obstacleVelocity.x - ownVelocity.x;
                const relativeVelocityZ = obstacleVelocity.z - ownVelocity.z;
                const relativeSpeedSquared =
                    relativeVelocityX * relativeVelocityX +
                    relativeVelocityZ * relativeVelocityZ;
                if (relativeSpeedSquared > .01) {
                    const timeToClosestApproach = -(
                        dx * relativeVelocityX + dz * relativeVelocityZ
                    ) / relativeSpeedSquared;
                    if (timeToClosestApproach > 0 && timeToClosestApproach < 1.5) {
                        const closestX = dx + relativeVelocityX * timeToClosestApproach;
                        const closestZ = dz + relativeVelocityZ * timeToClosestApproach;
                        const collisionRadius = (
                            Math.hypot(car.userData.size[0], car.userData.size[2]) +
                            Math.hypot(size[0], size[2])
                        ) * .32;
                        if (Math.hypot(closestX, closestZ) < collisionRadius) {
                            let shouldYield = obstacle === manualCar;
                            if (obstacle !== manualCar) {
                                const bothGranted = car.userData.intersectionGranted &&
                                    obstacle.userData.intersectionGranted;
                                if (state.intersectionOwner === car) {
                                    shouldYield = false;
                                } else if (state.intersectionOwner === obstacle) {
                                    shouldYield = true;
                                } else if (car.userData.intersectionGranted !==
                                    obstacle.userData.intersectionGranted) {
                                    shouldYield = !car.userData.intersectionGranted;
                                } else if (!bothGranted) {
                                    shouldYield = car.userData.index > obstacle.userData.index;
                                }
                            }
                            if (shouldYield) {
                                const brakingDistance = Math.max(
                                    0,
                                    (timeToClosestApproach - .2) * Math.max(car.userData.speed, .5)
                                );
                                safeSpeed = Math.min(
                                    safeSpeed,
                                    Math.sqrt(2 * 7 * brakingDistance)
                                );
                            }
                        }
                    }
                }
            }
            const obstacleRight = new THREE.Vector3(
                obstacleForward.z, 0, -obstacleForward.x
            );
            const projectedWidth = Math.abs(obstacleForward.dot(right)) * size[2] +
                Math.abs(obstacleRight.dot(right)) * size[0];
            const lateralLimit = (car.userData.size[0] + projectedWidth) * .5 + .4;
            if (lateral > lateralLimit) return;
            const projectedLength = Math.abs(obstacleForward.dot(forward)) * size[2] +
                Math.abs(obstacleForward.dot(right)) * size[0];
            const ownLength = car.userData.size[2];
            const longitudinalReach = (ownLength + projectedLength) * .5;
            if (ahead + longitudinalReach <= 0) return;
            const gap = ahead - (ownLength + projectedLength) * .5;
            if (!Number.isFinite(gap)) {
                console.error("Não foi possível calcular a distância segura entre veículos.", {
                    ownLength,
                    projectedLength,
                    ahead
                });
                return;
            }
            const bumperGap = Math.max(0, gap);
            const desiredBumperGap = 1.35 + car.userData.speed * .72 +
                car.userData.speed * Math.max(0, car.userData.speed - obstacleSpeed) /
                (2 * Math.sqrt(7 * 9));
            if (bumperGap < 12) foundNearbyObstacle = true;

            const speedRatio = targetSpeed > 0 ? car.userData.speed / targetSpeed : 0;
            const idmAcceleration = 2.2 * (
                1 -
                Math.pow(Math.max(0, speedRatio), 4) -
                Math.pow(desiredBumperGap / Math.max(bumperGap, .15), 2)
            );
            const reactionLocked = bumperGap < 5 &&
                car.userData.reactionElapsed < car.userData.reactionTime;
            let idmSpeed = reactionLocked
                ? 0
                : Math.max(0, car.userData.speed + idmAcceleration * delta);

            if (bumperGap < desiredBumperGap) {
                idmSpeed = Math.min(
                    idmSpeed,
                    Math.sqrt(2 * 7 * Math.max(0, bumperGap - 1.15))
                );
            }
            safeSpeed = Math.min(safeSpeed, idmSpeed);
        });
        car.userData.reactionElapsed = foundNearbyObstacle
            ? THREE.MathUtils.clamp(car.userData.reactionElapsed - delta * .25, 0, car.userData.reactionTime)
            : Math.min(car.userData.reactionTime, car.userData.reactionElapsed + delta);
        return safeSpeed;
    }

    function getRoundaboutEntryAngle(forward) {
        return Math.atan2(-forward.x, forward.z);
    }

    function getRoundaboutExitsAfter(angle) {
        const fullTurn = Math.PI * 2;
        return [0, Math.PI / 2, Math.PI, -Math.PI / 2]
            .map((exit) => ({
                angle: exit,
                distance: (exit - angle + fullTurn) % fullTurn
            }))
            .filter((exit) => exit.distance > .45)
            .sort((left, right) => left.distance - right.distance)
            .map((exit) => exit.angle);
    }

    function hasRoundaboutPriority(entryAngle, vehicle) {
        const fullTurn = Math.PI * 2;
        return aiVehicles.some((other) => {
            if (other === vehicle ||
                (other.userData.roundaboutMode !== "circle" &&
                    other.userData.roundaboutMode !== "exit")) return false;
            const angleUntilEntry =
                (entryAngle - other.userData.roundaboutAngle + fullTurn) % fullTurn;
            return angleUntilEntry < 1.25;
        });
    }

    function hasIntersectionConflict(vehicle) {
        return aiVehicles.some((other) => {
            if (other === vehicle || other.userData.roundaboutMode === "circle") return false;
            if (other.userData.crashed ||
                Math.abs(other.position.x) >= 9 ||
                Math.abs(other.position.z) >= 9) return false;
            return Boolean(other.userData.maneuverPath) ||
                other.userData.horizontal !== vehicle.userData.horizontal ||
                vehicle.userData.turnIntent !== "straight" ||
                other.userData.turnIntent !== "straight";
        });
    }

    function updateIntersectionReservation() {
        const owner = state.intersectionOwner;
        if (owner && (
            !owner.visible ||
            owner.userData.crashed ||
            owner.userData.roundaboutMode === "circle" ||
            Math.abs(owner.position.x) > 21 ||
            Math.abs(owner.position.z) > 21
        )) {
            state.intersectionOwner = null;
        }

        const manualInIntersection =
            Math.abs(manual.position.x) < 17 && Math.abs(manual.position.z) < 17;
        if (!state.intersectionOwner && !manualInIntersection) {
            const candidates = aiVehicles.filter((car) => {
                const data = car.userData;
                if (!car.visible || data.crashed || data.roundaboutMode === "circle" ||
                    Math.abs(data.horizontal ? car.position.z : car.position.x) >= 12.5) {
                    return false;
                }
                if (data.turnIntent === "roundabout" &&
                    hasRoundaboutPriority(
                        getRoundaboutEntryAngle(getAiForward(data)),
                        car
                    )) return false;
                const axisPosition = data.horizontal ? car.position.x : car.position.z;
                const centerProgress = axisPosition * data.direction;
                const inIntersection = Math.abs(car.position.x) < 17 &&
                    Math.abs(car.position.z) < 17;
                if (!inIntersection && (centerProgress < -45 || centerProgress > -15)) {
                    return false;
                }
                return inIntersection || getSignalColor(data.horizontal) === "green";
            }).sort((left, right) => {
                const leftInside =
                    Math.abs(left.position.x) < 17 && Math.abs(left.position.z) < 17;
                const rightInside =
                    Math.abs(right.position.x) < 17 && Math.abs(right.position.z) < 17;
                if (leftInside !== rightInside) return leftInside ? -1 : 1;
                if (left.userData.waiting !== right.userData.waiting) {
                    return right.userData.waiting - left.userData.waiting;
                }
                const leftProgress = (left.userData.horizontal
                    ? left.position.x
                    : left.position.z) * left.userData.direction;
                const rightProgress = (right.userData.horizontal
                    ? right.position.x
                    : right.position.z) * right.userData.direction;
                return rightProgress - leftProgress;
            });
            state.intersectionOwner = candidates[0] || null;
        }

        const activeOwner = state.intersectionOwner;
        aiVehicles.forEach((car) => {
            const data = car.userData;
            const progress = (data.horizontal ? car.position.x : car.position.z) * data.direction;
            const queuedForJunction = Math.abs(data.horizontal ? car.position.z : car.position.x) < 12.5 &&
                progress >= -45 && progress <= -15;
            const sharesStraightMovement = activeOwner &&
                activeOwner !== car &&
                queuedForJunction &&
                !data.maneuverPath &&
                !activeOwner.userData.maneuverPath &&
                data.roundaboutMode === "road" &&
                activeOwner.userData.roundaboutMode === "road" &&
                data.horizontal === activeOwner.userData.horizontal &&
                data.turnIntent === "straight" &&
                activeOwner.userData.turnIntent === "straight";
            data.intersectionGranted = activeOwner === car || Boolean(sharesStraightMovement);
        });
    }

    function getUturnTarget(car) {
        const forward = getAiForward(car.userData);
        const right = new THREE.Vector3(forward.z, 0, -forward.x);
        const along = car.position.x * forward.x + car.position.z * forward.z;
        return new THREE.Vector3()
            .addScaledVector(forward, along - 5)
            .addScaledVector(right, -8.6);
    }

    function hasUturnConflict(car) {
        const target = getUturnTarget(car);
        return aiVehicles.some((other) => {
            if (other === car) return false;
            const safeDistance = (car.userData.size[2] + other.userData.size[2]) * .5 + 3;
            return Math.hypot(
                other.position.x - target.x,
                other.position.z - target.z
            ) < safeDistance;
        });
    }

    function startAiManeuver(car, kind) {
        const data = car.userData;
        const forward = getAiForward(data);
        const right = new THREE.Vector3(forward.z, 0, -forward.x);
        const start = car.position.clone();
        const startHeading = car.rotation.y;
        let end;
        let endHeading;
        let exitDirection;

        if (kind === "left" || kind === "right") {
            exitDirection = kind === "right" ? right.clone() : right.clone().negate();
            end = new THREE.Vector3()
                .addScaledVector(forward, kind === "right" ? -4.3 : 4.3);
            end.y = .45;
            endHeading = Math.atan2(exitDirection.x, exitDirection.z);
            const signal = data.lights &&
                (kind === "left" ? data.lights.turnLeft : data.lights.turnRight);
            if (signal) signal.material.color.setHex(0xffad38);
        } else if (kind === "roundabout-entry") {
            data.roundaboutEntryAngle = getRoundaboutEntryAngle(forward);
            const angle = data.roundaboutEntryAngle;
            end = new THREE.Vector3(
                Math.cos(angle) * 9.2,
                .45,
                Math.sin(angle) * 9.2
            );
            exitDirection = forward.clone();
            endHeading = Math.atan2(exitDirection.x, exitDirection.z);
        } else if (kind === "roundabout-exit") {
            const angle = data.roundaboutExitAngle;
            exitDirection = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
            const exitRight = new THREE.Vector3(exitDirection.z, 0, -exitDirection.x);
            end = new THREE.Vector3()
                .addScaledVector(exitDirection, 54)
                .addScaledVector(exitRight, 4.3);
            end.y = .45;
            endHeading = Math.atan2(exitDirection.x, exitDirection.z);
        } else if (kind === "uturn") {
            exitDirection = forward.clone().negate();
            end = getUturnTarget(car);
            end.y = .45;
            endHeading = Math.atan2(exitDirection.x, exitDirection.z);
        } else {
            return;
        }

        const controlLength = Math.max(3, Math.min(7, start.distanceTo(end) * .38));
        data.maneuverPath = createCurvePath(
            start,
            end,
            startHeading,
            endHeading,
            controlLength
        );
        data.maneuverKind = kind;
        data.maneuverExitDirection = exitDirection;
        if (kind === "roundabout-entry") data.roundaboutMode = "entry";
        if (kind === "roundabout-exit") data.roundaboutMode = "exit";
    }

    function completeAiManeuver(car) {
        const data = car.userData;
        const kind = data.maneuverKind;
        const direction = data.maneuverExitDirection;
        data.maneuverPath = null;
        data.maneuverKind = null;

        if (kind === "roundabout-entry") {
            data.roundaboutMode = "circle";
            data.roundaboutAngle = data.roundaboutEntryAngle;
            data.roundaboutDirection = 1;
            data.roundaboutProgress = 0;
            const exits = getRoundaboutExitsAfter(data.roundaboutEntryAngle);
            data.roundaboutExitAngle = exits[
                (data.index + data.turnCount) % Math.min(2, exits.length)
            ];
            return;
        }

        data.roundaboutMode = "road";
        data.horizontal = Math.abs(direction.x) > Math.abs(direction.z);
        data.direction = data.horizontal
            ? Math.sign(direction.x)
            : Math.sign(direction.z);
        data.decidedAtCrossing = kind === "left" || kind === "right";
        if (kind === "roundabout-exit" || kind === "uturn") {
            data.turnCount += 1;
            data.turnIntent = chooseTurnIntent(data.index, data.turnCount);
            data.decidedAtCrossing = false;
        }
    }

    function updateAiManeuver(car, delta) {
        const data = car.userData;
        const forward = new THREE.Vector3(
            Math.sin(car.rotation.y), 0, Math.cos(car.rotation.y)
        );
        const targetSpeed = data.desiredSpeed * state.trafficScale;
        const safeSpeed = getSafeSpeedAhead(car, forward, targetSpeed, delta);
        data.speed = moveToward(
            data.speed,
            safeSpeed,
            (safeSpeed < data.speed ? 7 : 2.8) * delta
        );
        if (advanceAlongCurve(car, data.maneuverPath, data.speed * delta)) {
            completeAiManeuver(car);
        }
        rememberAiPosition(car);
    }

    function getSignalColor(horizontal) {
        const cycle = state.greenTime * 2 + 4;
        const phase = state.trafficElapsed % cycle;
        if (horizontal) {
            if (phase < state.greenTime) return "green";
            if (phase < state.greenTime + 2) return "yellow";
            return "red";
        }
        if (phase < state.greenTime + 2) return "red";
        if (phase < state.greenTime * 2 + 2) return "green";
        return "yellow";
    }

    function updateVehicleCount(delta) {
        updateIntersectionReservation();
        const playerAtIntersection =
            manual.position.x > -12 && manual.position.x < 12 &&
            manual.position.z > -12 && manual.position.z < 12;
        if (playerAtIntersection && Math.abs(manual.speed) < .5) {
            state.waiting += delta;
        } else {
            state.waiting = Math.max(0, state.waiting - delta);
        }
        aiVehicles.forEach((car) => {
            const data = car.userData;
            if (!Number.isFinite(data.speed) ||
                !Number.isFinite(car.position.x) ||
                !Number.isFinite(car.position.z) ||
                !Number.isFinite(car.rotation.y)) {
                recoverAiVehicle(car, "invalid state before traffic update");
                return;
            }
            if (data.hazardUntil > performance.now()) {
                const flashing = Math.floor(performance.now() / 280) % 2 === 0;
                if (data.lights) {
                    data.lights.turnLeft.material.color.setHex(flashing ? 0xffad38 : 0x4a351a);
                    data.lights.turnRight.material.color.setHex(flashing ? 0xffad38 : 0x4a351a);
                }
            } else if (data.maneuverKind === "left" || data.maneuverKind === "right") {
                const flashing = Math.floor(performance.now() / 280) % 2 === 0;
                data.lights.turnLeft.material.color.setHex(
                    data.maneuverKind === "left" && flashing ? 0xffad38 : 0x4a351a
                );
                data.lights.turnRight.material.color.setHex(
                    data.maneuverKind === "right" && flashing ? 0xffad38 : 0x4a351a
                );
            }

            if (data.crashed) {
                data.speed = 0;
                return;
            }

            const targetSpeed = data.desiredSpeed * state.trafficScale;
            if (!Number.isFinite(targetSpeed)) {
                console.error("Velocidade-alvo inválida para veículo da IA.", {
                    desiredSpeed: data.desiredSpeed,
                    trafficScale: state.trafficScale
                });
                data.speed = 0;
                return;
            }

            if (data.maneuverPath) {
                updateAiManeuver(car, delta);
                return;
            }

            const radius = 9.2;
            if (data.roundaboutMode === "circle") {
                let circleSpeed = data.roundaboutSpeed * state.trafficScale;
                aiVehicles.forEach((other) => {
                    if (other === car ||
                        (other.userData.roundaboutMode !== "circle" &&
                            other.userData.roundaboutMode !== "exit")) return;
                    const angleGap = (other.userData.roundaboutAngle - data.roundaboutAngle +
                        Math.PI * 2) % (Math.PI * 2);
                    if (angleGap >= Math.PI ||
                        (angleGap < 1e-4 && other.userData.index > data.index)) return;
                    const gap = angleGap * radius -
                        (car.userData.size[2] + other.userData.size[2]) * .5 - 2.5;
                    circleSpeed = Math.min(
                        circleSpeed,
                        Math.sqrt(2 * 7 * Math.max(0, gap - 3))
                    );
                });
                data.speed = moveToward(
                    data.speed,
                    circleSpeed,
                    (circleSpeed < data.speed ? 7 : 2.8) * delta
                );
                data.roundaboutAngle += data.roundaboutDirection *
                    data.speed * delta / radius;
                const angle = data.roundaboutAngle;
                const nextPosition = new THREE.Vector3(
                    Math.cos(angle) * radius,
                    .45,
                    Math.sin(angle) * radius
                );
                car.position.copy(nextPosition);
                const tangentAngle = angle + data.roundaboutDirection * Math.PI / 2;
                const targetYaw = Math.atan2(Math.cos(tangentAngle), Math.sin(tangentAngle));
                car.rotation.y = smoothYaw(car.rotation.y, targetYaw, .28);
                rememberAiPosition(car);
                data.roundaboutProgress += data.speed * (delta || .016) / radius;

                const exitAngle = data.roundaboutExitAngle;
                const exitDistance = Math.abs(shortestAngleDifference(angle, exitAngle));
                if (data.roundaboutProgress > .75 &&
                    exitDistance < .18) {
                    if (state.intersectionOwner && state.intersectionOwner !== car) {
                        data.speed = 0;
                        return;
                    }
                    state.intersectionOwner = car;
                    data.intersectionGranted = true;
                    data.lights && data.lights.turnRight &&
                        data.lights.turnRight.material.color.setHex(0xffad38);
                    startAiManeuver(car, "roundabout-exit");
                    updateAiManeuver(car, delta);
                    return;
                }
                data.waiting = 0;
                return;
            }

            let blocked = false;
            const maxBraking = 7;
            const lanePosition = data.horizontal ? car.position.z : car.position.x;
            const axisPosition = data.horizontal ? car.position.x : car.position.z;
            const centerProgress = axisPosition * data.direction;
            const forward = getAiForward(data);
            const onApproach = Math.abs(lanePosition) < 12.5;
            let safeSpeed = targetSpeed;
            const intersectionConflict = onApproach &&
                centerProgress > -45 && centerProgress < 12 &&
                !data.intersectionGranted;

            if (onApproach) {
                const distanceToLine = -17.5 - centerProgress;
                if (distanceToLine > 0 &&
                    (getSignalColor(data.horizontal) !== "green" ||
                        !data.intersectionGranted)) {
                    safeSpeed = Math.min(
                        safeSpeed,
                        Math.sqrt(2 * maxBraking * Math.max(0, distanceToLine - 1.1))
                    );
                    blocked = distanceToLine < Math.max(12, data.speed * data.speed / (2 * maxBraking) + 2);
                }
            }

            if (intersectionConflict) {
                const distanceToIntersection = Math.max(0, -17 - centerProgress);
                safeSpeed = Math.min(
                    safeSpeed,
                    Math.sqrt(2 * maxBraking * distanceToIntersection)
                );
                blocked = true;
            }

            if (state.trainActive && !data.horizontal && Math.abs(car.position.x) < 12.5) {
                const railLine = data.direction > 0 ? 18 : 30;
                const distanceToRail = (railLine - axisPosition) * data.direction;
                if (distanceToRail > 0) {
                    safeSpeed = Math.min(
                        safeSpeed,
                        Math.sqrt(2 * maxBraking * Math.max(0, distanceToRail - 1.5))
                    );
                    blocked = blocked || distanceToRail < Math.max(12, data.speed * data.speed / (2 * maxBraking) + 2);
                }
            }

            if (onApproach && data.turnIntent === "roundabout" &&
                centerProgress > -28 && centerProgress < -10) {
                const entryAngle = getRoundaboutEntryAngle(forward);
                if (hasRoundaboutPriority(entryAngle, car)) {
                    const yieldDistance = Math.max(0, -17 - centerProgress);
                    safeSpeed = Math.min(
                        safeSpeed,
                        Math.sqrt(2 * maxBraking * yieldDistance)
                    );
                    blocked = blocked || yieldDistance < Math.max(3, data.speed * 1.2);
                }
            }

            const safeAheadSpeed = getSafeSpeedAhead(car, forward, targetSpeed, delta);
            if (safeAheadSpeed < safeSpeed) blocked = true;
            safeSpeed = Math.min(safeSpeed, safeAheadSpeed);
            data.speed = moveToward(
                data.speed,
                safeSpeed,
                (safeSpeed < data.speed ? 7 : 2.8) * delta
            );
            if (blocked) {
                data.waiting += delta;
                data.lights && data.lights.brakeLeft.material.color.setHex(0xff2222);
                data.lights && data.lights.brakeRight.material.color.setHex(0xff2222);
            } else {
                data.waiting = Math.max(0, data.waiting - delta * .5);
                data.lights && data.lights.brakeLeft.material.color.setHex(0xa52f33);
                data.lights && data.lights.brakeRight.material.color.setHex(0xa52f33);
            }

            if (centerProgress >= WORLD_HALF - 15) {
                if (hasUturnConflict(car)) {
                    data.speed = moveToward(data.speed, 0, maxBraking * delta);
                    car.position.addScaledVector(forward, data.speed * delta);
                    car.position.x = THREE.MathUtils.clamp(car.position.x, -WORLD_HALF + 4, WORLD_HALF - 4);
                    car.position.z = THREE.MathUtils.clamp(car.position.z, -WORLD_HALF + 4, WORLD_HALF - 4);
                    rememberAiPosition(car);
                    return;
                }
                startAiManeuver(car, "uturn");
                updateAiManeuver(car, delta);
                return;
            }

            const signalGreen = getSignalColor(data.horizontal) === "green";
            if (onApproach && signalGreen && !data.decidedAtCrossing) {
                if (data.turnIntent === "roundabout" && centerProgress >= -14 &&
                    !hasRoundaboutPriority(getRoundaboutEntryAngle(forward), car) &&
                    !hasIntersectionConflict(car)) {
                    startAiManeuver(car, "roundabout-entry");
                    updateAiManeuver(car, delta);
                    return;
                }
                if ((data.turnIntent === "left" || data.turnIntent === "right") &&
                    centerProgress >= -10 && !hasIntersectionConflict(car)) {
                    startAiManeuver(car, data.turnIntent);
                    data.decidedAtCrossing = true;
                    updateAiManeuver(car, delta);
                    return;
                }
                if (data.turnIntent === "straight" && centerProgress >= 10) {
                    data.decidedAtCrossing = true;
                }
            }

            car.position.addScaledVector(forward, data.speed * delta);
            car.rotation.y = Math.atan2(forward.x, forward.z);
            car.position.x = THREE.MathUtils.clamp(car.position.x, -WORLD_HALF + 4, WORLD_HALF - 4);
            car.position.z = THREE.MathUtils.clamp(car.position.z, -WORLD_HALF + 4, WORLD_HALF - 4);
            if (data.decidedAtCrossing &&
                (Math.abs(car.position.x) > 22 || Math.abs(car.position.z) > 22)) {
                data.decidedAtCrossing = false;
                data.turnCount += 1;
                data.turnIntent = chooseTurnIntent(data.index, data.turnCount);
            }
            rememberAiPosition(car);
        });
        for (let i = 0; i < aiVehicles.length; i += 1) {
            for (let j = i + 1; j < aiVehicles.length; j += 1) {
                const left = aiVehicles[i];
                const right = aiVehicles[j];
                if (!left.visible || !right.visible) continue;
                if (!Number.isFinite(left.position.x) || !Number.isFinite(left.position.z) ||
                    !Number.isFinite(left.rotation.y)) {
                    recoverAiVehicle(left, "invalid state before vehicle collision check");
                }
                if (!Number.isFinite(right.position.x) || !Number.isFinite(right.position.z) ||
                    !Number.isFinite(right.rotation.y)) {
                    recoverAiVehicle(right, "invalid state before vehicle collision check");
                }
                const collision = getObbCollision(
                    left.position,
                    left.rotation.y,
                    left.userData.size,
                    right.position,
                    right.rotation.y,
                    right.userData.size
                );
                if (!collision) continue;
                if (!Number.isFinite(collision.depth) ||
                    !Number.isFinite(collision.normal.x) ||
                    !Number.isFinite(collision.normal.y)) {
                    recoverAiVehicle(left, "invalid collision geometry");
                    recoverAiVehicle(right, "invalid collision geometry");
                    continue;
                }
                const involvesWreck = left.userData.crashed || right.userData.crashed;
                if (!involvesWreck) {
                    left.userData.speed *= .48;
                    right.userData.speed *= .48;
                    left.userData.waiting += .01;
                    right.userData.waiting += .01;
                }
                const correction = Math.max(0, collision.depth) * .5 + .025;
                const leftPosition = left.position.clone().addScaledVector(
                    new THREE.Vector3(collision.normal.x, 0, collision.normal.y),
                    -correction
                );
                const rightPosition = right.position.clone().addScaledVector(
                    new THREE.Vector3(collision.normal.x, 0, collision.normal.y),
                    correction
                );
                if (!Number.isFinite(leftPosition.x) || !Number.isFinite(leftPosition.z) ||
                    !Number.isFinite(rightPosition.x) || !Number.isFinite(rightPosition.z)) {
                    recoverAiVehicle(left, "non-finite collision resolution");
                    recoverAiVehicle(right, "non-finite collision resolution");
                    continue;
                }
                left.position.copy(leftPosition);
                right.position.copy(rightPosition);
                rememberAiPosition(left);
                rememberAiPosition(right);
                if (!involvesWreck) {
                    left.userData.hazardUntil = performance.now() + 7000;
                    right.userData.hazardUntil = performance.now() + 7000;
                }
                const leftVelocity = new THREE.Vector3(
                    left.userData.horizontal ? left.userData.direction * left.userData.speed : 0,
                    0,
                    left.userData.horizontal ? 0 : left.userData.direction * left.userData.speed
                );
                const rightVelocity = new THREE.Vector3(
                    right.userData.horizontal ? right.userData.direction * right.userData.speed : 0,
                    0,
                    right.userData.horizontal ? 0 : right.userData.direction * right.userData.speed
                );
                if (!involvesWreck && leftVelocity.distanceTo(rightVelocity) >= 5 && !state.policeActive) {
                    console.warn("Colisão entre veículos autônomos.", {
                        left: left.userData.index,
                        right: right.userData.index,
                        leftPosition: left.position.toArray(),
                        rightPosition: right.position.toArray(),
                        relativeSpeed: leftVelocity.distanceTo(rightVelocity)
                    });
                    left.userData.crashed = true;
                    right.userData.crashed = true;
                    left.userData.speed = 0;
                    right.userData.speed = 0;
                    spawnPolice(
                        new THREE.Vector3(
                            (left.position.x + right.position.x) * .5,
                            .45,
                            (left.position.z + right.position.z) * .5
                        ),
                        left,
                        false
                    );
                    if (state.accidentState && !state.accidentState.involvedVehicles.includes(right)) {
                        right.userData.hazardUntil = Infinity;
                        state.accidentState.involvedVehicles.push(right);
                    }
                }
            }
        }
        const staticObstacles = [
            { x: -31, z: -31, w: 12, h: 8, d: 10 },
            { x: 32, z: -29, w: 14, h: 8, d: 12 },
            { x: -34, z: 32, w: 15, h: 8, d: 11 },
            { x: 34, z: 33, w: 11, h: 8, d: 13 },
            { x: HOSPITAL_X, z: 23, w: 18, h: 8, d: 18 }
        ];
        aiVehicles.forEach((car) => {
            if (!car.visible || car.userData.crashed) return;
            for (const obstacle of staticObstacles) {
                const collision = getObbCollision(
                    car.position,
                    car.rotation.y,
                    car.userData.size,
                    new THREE.Vector3(obstacle.x, .45, obstacle.z),
                    0,
                    [obstacle.w, obstacle.h, obstacle.d]
                );
                if (!collision) continue;
                const normal = new THREE.Vector3(collision.normal.x, 0, collision.normal.y);
                car.position.addScaledVector(normal, collision.depth + .035);
                car.userData.speed *= .2;
                car.userData.waiting += .02;
                rememberAiPosition(car);
            }
            if (state.trainActive) {
                const collision = getObbCollision(
                    car.position,
                    car.rotation.y,
                    car.userData.size,
                    new THREE.Vector3(state.trainX - 20.75, .45, 24),
                    0,
                    [44, 3.2, 3.5]
                );
                if (collision) {
                    const normal = new THREE.Vector3(collision.normal.x, 0, collision.normal.y);
                    car.position.addScaledVector(normal, collision.depth + .035);
                    car.userData.speed *= .12;
                    car.userData.crashed = true;
                    rememberAiPosition(car);
                }
            }
            car.position.x = THREE.MathUtils.clamp(car.position.x, -WORLD_HALF + 4, WORLD_HALF - 4);
            car.position.z = THREE.MathUtils.clamp(car.position.z, -WORLD_HALF + 4, WORLD_HALF - 4);
        });
    }

    function updateTrain(delta) {
        state.trainElapsed += delta;
        if (!state.trainActive && state.trainElapsed >= state.trainInterval) {
            state.trainActive = true;
            state.trainElapsed = 0;
            state.trainDirection = 1;
            state.trainX = -80;
        }
        if (state.trainActive) {
            state.trainX += 8 * state.trainDirection * delta;
            train.position.x = state.trainX;
            setBarrier(true);
            addSmoke();
            if (state.trainX > 120) {
                state.trainActive = false;
                state.trainElapsed = 0;
                train.position.x = -80;
                setBarrier(false);
            }
        } else {
            setBarrier(false);
        }
        smoke.forEach((puff) => {
            puff.userData.life += delta;
            puff.position.x -= delta * 0.7;
            puff.position.y += delta * 0.8;
            puff.scale.multiplyScalar(1 + delta * 0.35);
            puff.material.opacity = Math.max(0, 0.55 - puff.userData.life * 0.12);
        });
        for (let i = smoke.length - 1; i >= 0; i -= 1) {
            if (smoke[i].userData.life > 4.5) {
                scene.remove(smoke[i]);
                smoke.splice(i, 1);
            }
        }
    }

    let lastCollisionAt = 0;
    let lastRedAt = 0;

    function showPracticeAlert(message) {
        state.alertUntil = performance.now() + 2200;
        const status = document.querySelector("#practice-status");
        if (status) status.textContent = message;
    }

    function addImpactEffect(position) {
        for (let i = 0; i < 7; i += 1) {
            const spark = new THREE.Mesh(
                new THREE.SphereGeometry(.12, 5, 4),
                new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffa43b : 0xffffff })
            );
            spark.position.copy(position);
            spark.position.y += .8;
            spark.userData.velocity = new THREE.Vector3(
                (Math.random() - .5) * 7,
                2 + Math.random() * 4,
                (Math.random() - .5) * 7
            );
            spark.userData.life = 0;
            scene.add(spark);
            if (!window.practiceImpactParticles) window.practiceImpactParticles = [];
            window.practiceImpactParticles.push(spark);
        }
        state.cameraShake = .55;
    }

    function updateAccidentSmoke(delta) {
        if (state.accidentState) {
            state.accidentSmokeElapsed += delta;
            if (state.accidentSmokeElapsed >= .32 && state.accidentSmoke.length < 14) {
                state.accidentSmokeElapsed = 0;
                const puff = new THREE.Mesh(
                    new THREE.SphereGeometry(.35 + Math.random() * .2, 8, 6),
                    new THREE.MeshBasicMaterial({
                        color: 0x7d8587,
                        transparent: true,
                        opacity: .42,
                        depthWrite: false
                    })
                );
                puff.position.copy(state.accidentPosition);
                puff.position.y += 1.8 + Math.random() * .4;
                puff.position.x += (Math.random() - .5) * .8;
                puff.position.z += (Math.random() - .5) * .8;
                puff.userData.life = 0;
                scene.add(puff);
                state.accidentSmoke.push(puff);
            }
        }
        for (let i = state.accidentSmoke.length - 1; i >= 0; i -= 1) {
            const puff = state.accidentSmoke[i];
            puff.userData.life += delta;
            puff.position.y += delta * .8;
            puff.scale.multiplyScalar(1 + delta * .4);
            puff.material.opacity = Math.max(0, .42 * (1 - puff.userData.life / 2.4));
            if (puff.userData.life >= 2.4) {
                scene.remove(puff);
                puff.geometry.dispose();
                puff.material.dispose();
                state.accidentSmoke.splice(i, 1);
            }
        }
    }

    function updateImpactEffects(delta) {
        const particles = window.practiceImpactParticles || [];
        for (let i = particles.length - 1; i >= 0; i -= 1) {
            const spark = particles[i];
            spark.userData.life += delta;
            spark.userData.velocity.y -= delta * 9;
            spark.position.addScaledVector(spark.userData.velocity, delta);
            if (spark.userData.life > .8) {
                scene.remove(spark);
                particles.splice(i, 1);
            }
        }
    }

    function moveGroupToward(group, target, distance) {
        const offset = target.clone().sub(group.position);
        offset.y = 0;
        const remaining = offset.length();
        if (remaining <= distance) {
            group.position.copy(target);
            return true;
        }
        offset.normalize();
        group.position.addScaledVector(offset, distance);
        group.rotation.y = smoothYaw(group.rotation.y, Math.atan2(offset.x, offset.z), .16);
        return false;
    }

    function getAccidentForward() {
        return new THREE.Vector3(Math.sin(state.accidentHeading), 0, Math.cos(state.accidentHeading));
    }

    function restoreIncidentVehicles(vehicles) {
        const involved = new Set(vehicles);
        const occupied = aiVehicles.filter((car) =>
            !involved.has(car) && car.visible && !car.userData.crashed
        );
        if (manualCar.visible) occupied.push(manualCar);

        const spawnPoints = [
            { horizontal: true, direction: 1, position: new THREE.Vector3(-WORLD_HALF + 12, .45, -4.3), heading: Math.PI / 2 },
            { horizontal: true, direction: -1, position: new THREE.Vector3(WORLD_HALF - 12, .45, 4.3), heading: -Math.PI / 2 },
            { horizontal: false, direction: 1, position: new THREE.Vector3(4.3, .45, -WORLD_HALF + 12), heading: 0 },
            { horizontal: false, direction: -1, position: new THREE.Vector3(-4.3, .45, WORLD_HALF - 12), heading: Math.PI }
        ];

        vehicles.forEach((vehicle) => {
            if (!vehicle || vehicle === manualCar) return;
            const data = vehicle.userData;
            const spawn = spawnPoints.reduce((best, candidate) => {
                const clearance = occupied.reduce((minimum, other) => {
                    const requiredGap = (data.size[2] + other.userData.size[2]) * .5 + 2.5;
                    return Math.min(
                        minimum,
                        candidate.position.distanceTo(other.position) - requiredGap
                    );
                }, Infinity);
                const bestClearance = occupied.reduce((minimum, other) => {
                    const requiredGap = (data.size[2] + other.userData.size[2]) * .5 + 2.5;
                    return Math.min(
                        minimum,
                        best.position.distanceTo(other.position) - requiredGap
                    );
                }, Infinity);
                return clearance > bestClearance ? candidate : best;
            }, spawnPoints[0]);

            data.crashed = false;
            data.speed = 0;
            data.waiting = 0;
            data.hazardUntil = 0;
            data.roundaboutMode = "road";
            data.roundaboutProgress = 0;
            data.maneuverPath = null;
            data.maneuverKind = null;
            data.maneuverExitDirection = null;
            data.decidedAtCrossing = false;
            data.horizontal = spawn.horizontal;
            data.direction = spawn.direction;
            vehicle.position.copy(spawn.position);
            vehicle.rotation.y = spawn.heading;
            vehicle.visible = true;
            data.lights.turnLeft.material.color.setHex(0x4a351a);
            data.lights.turnRight.material.color.setHex(0x4a351a);
            data.lights.brakeLeft.material.color.setHex(0xa52f33);
            data.lights.brakeRight.material.color.setHex(0xa52f33);
            data.lastFinitePosition.copy(vehicle.position);
            occupied.push(vehicle);
        });
    }

    function spawnPolice(position, vehicle = manualCar, isPlayer = vehicle === manualCar) {
        if (state.policeActive || !position) return;
        state.policeSpawnedAt = performance.now();
        state.policeActive = true;
        state.policeMode = "approaching";
        state.policeTarget = position.clone();
        state.accidentVehicle = vehicle;
        state.accidentIsPlayer = isPlayer;
        state.accidentPosition = position.clone();
        state.accidentSmokeElapsed = 0;
        state.accidentHeading = isPlayer ? manual.heading : vehicle.rotation.y;
        state.accidentState = {
            phase: "police-response",
            policePhase: "approaching",
            medicalPhase: "waiting",
            towPhase: "waiting",
            route: [],
            routeIndex: 0,
            elapsed: 0,
            towElapsed: 0,
            patientTargets: [],
            involvedVehicles: vehicle === manualCar ? [] : [vehicle]
        };
        state.accidentState.involvedVehicles.forEach((involvedVehicle) => {
            involvedVehicle.userData.crashed = true;
            involvedVehicle.userData.speed = 0;
            involvedVehicle.userData.hazardUntil = Infinity;
        });
        state.policeElapsed = 0;
        state.policeCollisionCount += 1;
        state.policeResponse = 0;
        policeCar.visible = true;
        const forward = getAccidentForward();
        const parkPosition = position.clone().addScaledVector(forward, -8);
        policeCar.position.copy(parkPosition).addScaledVector(forward, -62);
        policeCar.position.y = .45;
        policeCar.rotation.y = state.accidentHeading;
        state.officer.visible = false;
        state.towTruck.visible = false;
        state.towTruck.userData.ramp.rotation.x = 0;
        if (!isPlayer) {
            vehicle.userData.crashed = true;
            vehicle.userData.speed = 0;
            vehicle.userData.hazardUntil = Infinity;
        } else {
            manual.speed = 0;
            manual.velocity.set(0, 0, 0);
            keys.clear();
            manualCar.userData.hazardActive = true;
        }
        state.policeStatus = "Viatura a caminho";
    }

    function updateOfficer(delta, target) {
        const officer = state.officer;
        const direction = target.clone().sub(officer.position);
        direction.y = 0;
        if (direction.lengthSq() > .001) {
            direction.normalize();
            officer.rotation.y = Math.atan2(direction.x, direction.z);
            officer.userData.limbs[0].rotation.x = Math.sin(state.policeElapsed * 9) * .55;
            officer.userData.limbs[2].rotation.x = -Math.sin(state.policeElapsed * 9) * .55;
            officer.userData.limbs[1].rotation.x = -Math.sin(state.policeElapsed * 9) * .45;
            officer.userData.limbs[3].rotation.x = Math.sin(state.policeElapsed * 9) * .45;
        } else {
            officer.userData.limbs.forEach((limb) => limb.rotation.set(0, 0, 0));
        }
        return moveGroupToward(officer, target, delta * 2.1);
    }

    function finishIncident() {
        const vehicles = state.accidentState ? state.accidentState.involvedVehicles : [];
        policeCar.visible = false;
        state.towTruck.visible = false;
        state.officer.visible = false;
        state.ambulance.visible = false;
        state.accidentSmoke.forEach((puff) => {
            scene.remove(puff);
            puff.geometry.dispose();
            puff.material.dispose();
        });
        state.accidentSmoke = [];
        [...state.patients, state.paramedic].forEach((person) => {
            person.visible = false;
        });
        state.policeActive = false;
        state.policeMode = null;
        state.policeTarget = null;
        state.policeStatus = "Pista liberada";
        restoreIncidentVehicles(vehicles);
        if (state.accidentIsPlayer) {
            manualCar.userData.hazardActive = false;
            manualCar.userData.lights.turnLeft.material.color.setHex(0xffad38);
            manualCar.userData.lights.turnRight.material.color.setHex(0xffad38);
            manualCar.visible = false;
            state.towCountdown = 3;
            state.towHud.hidden = false;
            towMessage.textContent = "Veículo apreendido e rebocado por infração/colisão. Novo veículo em 3 s.";
        }
        state.accidentVehicle = null;
        state.accidentIsPlayer = false;
        state.accidentPosition = null;
        state.accidentState = null;
    }

    function deliverReplacementVehicle() {
        if (!state.towHud || state.towHud.hidden) return;
        state.towHud.hidden = true;
        state.towCountdown = 0;
        towMessage.textContent = "Veículo apreendido e rebocado por infração/colisão.";
        manual.position.set(-56, .45, -8);
        manual.lastFinitePosition.copy(manual.position);
        manual.heading = Math.PI / 2;
        manual.speed = 0;
        manual.velocity.set(0, 0, 0);
        manual.steerAngle = 0;
        manualCar.position.copy(manual.position);
        manualCar.rotation.y = manual.heading;
        manualCar.visible = true;
        manualCar.userData.frontWheels.forEach((wheel) => {
            wheel.rotation.y = 0;
        });
        state.gear = "P";
        state.policeStatus = "Novo veículo entregue";
        showPracticeAlert("Novo veículo entregue. A via está livre.");
    }

    towButton.addEventListener("click", () =>
        runLoopModule("replacement-vehicle-input", deliverReplacementVehicle)
    );

    function updateTowCountdown(delta) {
        if (state.towCountdown <= 0) return;
        state.towCountdown = Math.max(0, state.towCountdown - delta);
        towMessage.textContent =
            `Veículo apreendido e rebocado por infração/colisão. Novo veículo em ${Math.ceil(state.towCountdown)} s.`;
        if (state.towCountdown === 0) deliverReplacementVehicle();
    }

    function startAmbulanceResponse(forward, right) {
        const event = state.accidentState;
        const ambulance = state.ambulance;
        ambulance.position.copy(state.accidentPosition).addScaledVector(right, 52);
        ambulance.position.y = .45;
        ambulance.rotation.y = state.accidentHeading;
        ambulance.visible = true;
        ambulance.userData.rearDoors.forEach((door) => {
            door.rotation.y = 0;
        });
        event.medicalPhase = "approaching";
        event.elapsed = 0;
        event.towElapsed = 0;
        event.ambulancePark = state.accidentPosition.clone().addScaledVector(right, 4.8);
        event.ambulancePark.y = .45;
        event.patientTargets = [];
        state.policeStatus = "Ambulância a caminho do acidente";
    }

    function buildHospitalRoute() {
        const position = state.accidentPosition;
        const forward = getAccidentForward();
        const route = [];
        if (Math.abs(forward.x) > Math.abs(forward.z)) {
            route.push(new THREE.Vector3(0, .45, position.z));
        } else {
            route.push(new THREE.Vector3(position.x, .45, 0));
        }
        route.push(new THREE.Vector3(0, .45, 0));
        route.push(new THREE.Vector3(HOSPITAL_BAY.x, .45, 0));
        route.push(HOSPITAL_BAY.clone());
        return route.filter((point, index) => index === 0 || point.distanceTo(route[index - 1]) > .5);
    }

    function animatePersonWalk(person, delta) {
        const swing = Math.sin(performance.now() / 1000 * 8) * .45;
        person.userData.limbs[0].rotation.x = swing;
        person.userData.limbs[2].rotation.x = -swing;
        person.userData.limbs[1].rotation.x = -swing * .8;
        person.userData.limbs[3].rotation.x = swing * .8;
        person.userData.elapsed = (person.userData.elapsed || 0) + delta;
    }

    function setAmbulanceDoors(open) {
        state.ambulance.userData.rearDoors.forEach((door, index) => {
            const side = index === 0 ? -1 : 1;
            door.rotation.y = THREE.MathUtils.lerp(door.rotation.y, open ? side * .85 : 0, .12);
        });
    }

    function updateMedicalResponse(delta) {
        const event = state.accidentState;
        if (!event || event.medicalPhase === "waiting" || event.medicalPhase === "complete") return;
        const ambulance = state.ambulance;
        const phase = event.medicalPhase;
        event.elapsed += delta;
        const pulse = Math.floor(performance.now() / 220) % 2 === 0;
        ambulance.userData.beacons.forEach((beacon) => {
            beacon.material.color.setHex(pulse ? 0xff3038 : 0x631c22);
        });
        if (phase === "approaching") {
            if (moveGroupToward(ambulance, event.ambulancePark, delta * 16)) {
                ambulance.rotation.y = state.accidentHeading;
                event.medicalPhase = "opening-at-scene";
                event.elapsed = 0;
            }
        } else if (phase === "opening-at-scene") {
            setAmbulanceDoors(true);
            if (event.elapsed >= .9) {
                const forward = getAccidentForward();
                const right = new THREE.Vector3(forward.z, 0, -forward.x);
                const rear = ambulance.position.clone().addScaledVector(forward, -3.7);
                state.patients.forEach((patient, index) => {
                    patient.position.copy(state.accidentPosition)
                        .addScaledVector(right, index === 0 ? -2.2 : 2.2);
                    patient.position.y = .45;
                    patient.visible = true;
                    event.patientTargets.push(rear.clone().addScaledVector(right, index === 0 ? -.7 : .7));
                });
                state.paramedic.position.copy(ambulance.position)
                    .addScaledVector(forward, -4.5)
                    .addScaledVector(right, 1.8);
                state.paramedic.position.y = .45;
                state.paramedic.visible = true;
                event.medicalPhase = "boarding";
                event.elapsed = 0;
                state.policeStatus = "Paramédicos embarcando os ocupantes";
            }
        } else if (phase === "boarding") {
            let boarded = true;
            state.patients.forEach((patient, index) => {
                if (!moveGroupToward(patient, event.patientTargets[index], delta * 1.35)) {
                    animatePersonWalk(patient, delta);
                    boarded = false;
                }
            });
            const medicTarget = event.patientTargets[1].clone()
                .add(new THREE.Vector3(1.4, 0, 0));
            if (!moveGroupToward(state.paramedic, medicTarget, delta * 1.5)) {
                animatePersonWalk(state.paramedic, delta);
                boarded = false;
            }
            if (boarded) {
                state.patients.forEach((patient) => { patient.visible = false; });
                state.paramedic.visible = false;
                event.medicalPhase = "departing";
                event.route = buildHospitalRoute();
                event.routeIndex = 0;
                event.elapsed = 0;
                setAmbulanceDoors(false);
                state.policeStatus = "Ambulância transportando pacientes ao hospital";
            }
        } else if (phase === "departing") {
            const target = event.route[event.routeIndex];
            if (!target || moveGroupToward(ambulance, target, delta * 18)) {
                event.routeIndex += 1;
                if (event.routeIndex >= event.route.length) {
                    ambulance.rotation.y = 0;
                    event.medicalPhase = "opening-at-hospital";
                    event.elapsed = 0;
                }
            }
        } else if (phase === "opening-at-hospital") {
            setAmbulanceDoors(true);
            if (event.elapsed >= .8) {
                const rear = ambulance.position.clone().add(new THREE.Vector3(0, 0, -3.7));
                state.patients.forEach((patient, index) => {
                    patient.position.copy(rear).add(new THREE.Vector3(index ? .8 : -.8, 0, 0));
                    patient.position.y = .45;
                    patient.visible = true;
                });
                state.paramedic.position.copy(rear).add(new THREE.Vector3(1.8, 0, 0));
                state.paramedic.position.y = .45;
                state.paramedic.visible = true;
                event.medicalPhase = "unloading";
                event.elapsed = 0;
                state.policeStatus = "Pacientes desembarcando no pronto-socorro";
            }
        } else if (phase === "unloading") {
            let unloaded = true;
            state.patients.forEach((patient) => {
                if (!moveGroupToward(patient, HOSPITAL_ENTRANCE, delta * 1.25)) {
                    animatePersonWalk(patient, delta);
                    unloaded = false;
                }
            });
            const medicTarget = HOSPITAL_ENTRANCE.clone().add(new THREE.Vector3(1.8, 0, 0));
            if (!moveGroupToward(state.paramedic, medicTarget, delta * 1.4)) {
                animatePersonWalk(state.paramedic, delta);
                unloaded = false;
            }
            if (unloaded) {
                state.patients.forEach((patient) => { patient.visible = false; });
                state.paramedic.visible = false;
                setAmbulanceDoors(false);
                event.medicalPhase = "complete";
                event.phase = "clearing-road";
                state.policeStatus = "Atendimento médico concluído no hospital";
                maybeFinishIncident();
            }
        }
    }

    function updateTowService(delta) {
        const event = state.accidentState;
        if (!event || event.towPhase === "done") return;
        const forward = getAccidentForward();
        const towPark = state.accidentPosition.clone().addScaledVector(forward, 11);
        towPark.y = .45;
        const amberOn = Math.floor(performance.now() / 250) % 2 === 0;

        if (event.towPhase === "waiting" && event.medicalPhase === "departing") {
            state.towTruck.position.copy(state.accidentPosition).addScaledVector(forward, 59);
            state.towTruck.position.y = .45;
            state.towTruck.rotation.y = state.accidentHeading;
            state.towTruck.visible = true;
            event.towPhase = "approaching";
            event.phase = "coordinated-response";
            state.policeStatus = "Guincho a caminho · ambulância em rota ao hospital";
        }
        if (event.towPhase === "approaching") {
            state.towTruck.userData.amberLights.forEach((light) =>
                light.material.color.setHex(amberOn ? 0xffae24 : 0x503810)
            );
            if (moveGroupToward(state.towTruck, towPark, delta * 8)) {
                state.towTruck.rotation.y = state.accidentHeading;
                event.towPhase = "ramp-lowering";
                event.towElapsed = 0;
            }
        } else if (event.towPhase === "ramp-lowering") {
            event.towElapsed += delta;
            const progress = THREE.MathUtils.clamp(event.towElapsed / 1.2, 0, 1);
            state.towTruck.userData.ramp.rotation.x = -.45 * progress;
            state.towTruck.userData.amberLights.forEach((light) =>
                light.material.color.setHex(amberOn ? 0xffae24 : 0x503810)
            );
            if (progress >= 1) {
                event.towPhase = "loading";
                event.towElapsed = 0;
            }
        } else if (event.towPhase === "loading") {
            event.towElapsed += delta;
            const progress = THREE.MathUtils.clamp(event.towElapsed / 2.2, 0, 1);
            const loadedPosition = state.towTruck.position.clone().addScaledVector(forward, -5.2);
            loadedPosition.y = .95;
            state.accidentVehicle.position.lerpVectors(state.accidentPosition, loadedPosition, progress);
            state.accidentVehicle.rotation.y = state.accidentHeading;
            state.towTruck.userData.ramp.rotation.x = -.45 * (1 - progress);
            if (progress >= 1) {
                event.involvedVehicles.forEach((vehicle) => {
                    if (vehicle !== state.accidentVehicle) vehicle.visible = false;
                });
                event.towPhase = "leaving";
                state.policeMode = "leaving";
                state.policeElapsed = 0;
                event.policePhase = "leaving";
                state.policeStatus = "Guincho removendo o veículo · pista sendo liberada";
            }
        } else if (event.towPhase === "leaving") {
            state.towTruck.position.addScaledVector(forward, delta * 9);
            state.accidentVehicle.position.copy(state.towTruck.position).addScaledVector(forward, -5.2);
            state.accidentVehicle.position.y = 1.25;
            if (state.towTruck.position.distanceTo(state.accidentPosition) > 78) {
                state.towTruck.visible = false;
                event.towPhase = "done";
                maybeFinishIncident();
            }
        }
    }

    function maybeFinishIncident() {
        const event = state.accidentState;
        if (event && event.towPhase === "done" && event.medicalPhase === "complete" &&
            event.policePhase === "done") {
            finishIncident();
        }
    }

    function updatePolice(delta) {
        if (!state.policeActive || !state.policeMode || !state.accidentState) return;
        const pulse = Math.floor(performance.now() / 260) % 2 === 0;
        policeRed.material.color.setHex(pulse ? 0xff1838 : 0x45101a);
        policeBlue.material.color.setHex(pulse ? 0x2d62ff : 0x172b6a);
        state.policeElapsed += delta;
        const forward = getAccidentForward();
        const right = new THREE.Vector3(forward.z, 0, -forward.x);
        const leftSide = right.clone().negate();
        const policePark = state.accidentPosition.clone().addScaledVector(forward, -8);
        policePark.y = .45;
        const officerStart = policePark.clone().addScaledVector(leftSide, 2.7);
        const officerTarget = state.accidentPosition.clone().addScaledVector(leftSide, 3.2);
        officerTarget.y = .45;

        if (state.policeMode === "approaching") {
            if (moveGroupToward(policeCar, policePark, delta * 15)) {
                state.policeMode = "officer-exit";
                state.accidentState.policePhase = "officer-exit";
                state.policeElapsed = 0;
                state.policeResponse = Math.max(.1, state.policeResponse);
                state.officer.position.copy(officerStart);
                state.officer.rotation.y = state.accidentHeading;
                state.officer.visible = true;
            } else {
                state.policeResponse += delta;
            }
        } else if (state.policeMode === "officer-exit") {
            if (state.policeElapsed > .7) {
                state.policeMode = "officer-walk";
                state.accidentState.policePhase = "officer-walk";
                state.policeElapsed = 0;
            }
        } else if (state.policeMode === "officer-walk") {
            if (updateOfficer(delta, officerTarget)) {
                state.policeMode = "attending";
                state.accidentState.policePhase = "attending";
                state.policeElapsed = 0;
                state.policeStatus = "Policial orientando o trânsito";
            }
        } else if (state.policeMode === "attending") {
            state.officer.userData.limbs[0].rotation.x = -.9;
            state.officer.userData.limbs[2].rotation.x = -.9;
            if (state.policeElapsed >= 3.5) {
                state.policeMode = "officer-return";
                state.accidentState.policePhase = "officer-return";
                state.policeElapsed = 0;
            }
        } else if (state.policeMode === "officer-return") {
            if (updateOfficer(delta, officerStart)) {
                state.officer.visible = false;
                state.policeMode = "standby";
                state.accidentState.policePhase = "standby";
                startAmbulanceResponse(forward, right);
            }
        } else if (state.policeMode === "standby" && state.accidentState.policePhase === "leaving") {
            state.policeMode = "leaving";
            state.policeElapsed = 0;
        } else if (state.policeMode === "leaving") {
            policeCar.position.addScaledVector(forward, delta * 10);
            if (policeCar.position.distanceTo(state.accidentPosition) > 78) {
                policeCar.visible = false;
                state.policeMode = "done";
                state.accidentState.policePhase = "done";
                maybeFinishIncident();
            }
        }
    }

    function vehicleMass(type) {
        return { hatch: 1150, sedan: 1450, suv: 1900, onibus: 12500, caminhao: 5200 }[type] || 1450;
    }

    function getOrientedAxes(heading) {
        return {
            right: new THREE.Vector2(Math.cos(heading), -Math.sin(heading)),
            forward: new THREE.Vector2(Math.sin(heading), Math.cos(heading))
        };
    }

    function projectRadius(size, heading, axis) {
        const axes = getOrientedAxes(heading);
        return Math.abs(size[0] * .5 * axes.right.dot(axis)) +
            Math.abs(size[2] * .5 * axes.forward.dot(axis));
    }

    function getObbCollision(positionA, headingA, sizeA, positionB, headingB, sizeB) {
        if (!positionA || !positionB || !sizeA || !sizeB) return null;
        if (!Number.isFinite(positionA.x) || !Number.isFinite(positionA.z) ||
            !Number.isFinite(positionB.x) || !Number.isFinite(positionB.z)) return null;
        headingA = Number.isFinite(headingA) ? headingA : 0;
        headingB = Number.isFinite(headingB) ? headingB : 0;

        const heightA = Number.isFinite(sizeA[1]) ? sizeA[1] : 1.2;
        const heightB = Number.isFinite(sizeB[1]) ? sizeB[1] : 1.2;
        const centerYA = Number.isFinite(positionA.y) ? positionA.y : .45;
        const centerYB = Number.isFinite(positionB.y) ? positionB.y : .45;
        if (Math.abs(centerYB - centerYA) >= (heightA + heightB) * .5) return null;

        const centerDelta = new THREE.Vector2(positionB.x - positionA.x, positionB.z - positionA.z);
        const axesA = getOrientedAxes(headingA);
        const axesB = getOrientedAxes(headingB);
        const testAxes = [axesA.right, axesA.forward, axesB.right, axesB.forward];
        let smallestOverlap = Infinity;
        let smallestAxis = null;
        for (const axis of testAxes) {
            const testAxis = axis.clone().normalize();
            const distance = Math.abs(centerDelta.dot(testAxis));
            const radiusA = projectRadius(sizeA, headingA, testAxis);
            const radiusB = projectRadius(sizeB, headingB, testAxis);
            const overlap = radiusA + radiusB - distance;
            if (overlap <= 0) return null;
            if (overlap < smallestOverlap) {
                smallestOverlap = overlap;
                smallestAxis = testAxis;
            }
        }
        if (!smallestAxis) return null;
        if (centerDelta.dot(smallestAxis) < 0) smallestAxis.multiplyScalar(-1);
        return { normal: smallestAxis, depth: smallestOverlap };
    }

    function registerCollision(
        otherPosition,
        otherVelocity,
        otherMass,
        normal,
        penetration,
        strong = false,
        otherVehicle = null
    ) {
        const now = performance.now();
        const recordImpact = now - lastCollisionAt >= 900;
        if (recordImpact) {
            lastCollisionAt = now;
            state.collisions += 1;
        }
        const normal3 = new THREE.Vector3(normal.x, 0, normal.y);
        const inversePlayerMass = 1 / manual.mass;
        const inverseOtherMass = 1 / Math.max(otherMass, 1);
        const relativeVelocity = manual.velocity.clone().sub(otherVelocity);
        const velocityAlongNormal = relativeVelocity.dot(normal3);
        if (velocityAlongNormal > 0) {
            const restitution = strong ? .08 : .28;
            const impulseMagnitude =
                (1 + restitution) * velocityAlongNormal /
                (inversePlayerMass + inverseOtherMass);
            manual.velocity.addScaledVector(normal3, -impulseMagnitude * inversePlayerMass);
            if (otherVehicle && otherVehicle.userData) {
                otherVehicle.userData.speed = Math.max(0, otherVehicle.userData.speed * .35);
            }
        }
        manual.velocity.multiplyScalar(.24);
        const positionalCorrection = Math.max(penetration, 0) + .015;
        const playerShare = otherVehicle ? .5 : 1;
        manual.position.addScaledVector(normal3, -positionalCorrection * playerShare);
        if (otherVehicle) {
            otherVehicle.position.addScaledVector(normal3, positionalCorrection * (1 - playerShare));
        }
        manual.speed = manual.velocity.length();
        manual.speed = THREE.MathUtils.clamp(manual.speed, -7, 18);
        if (recordImpact) {
            state.waiting += 2;
            state.cameraShake = strong ? .9 : .45;
            addImpactEffect(manual.position.clone().lerp(otherPosition, .5));
            if (!state.accidentState && (strong || velocityAlongNormal >= 4.2)) {
                spawnPolice(manual.position.clone().lerp(otherPosition, .5), manualCar, true);
            }
            showPracticeAlert("Colisão detectada. Impulso físico e rebote aplicados.");
        }
    }

    function checkPracticeCollisions() {
        aiVehicles.forEach((car) => {
            if (!car.visible) return;
            const collision = getObbCollision(
                manual.position,
                manual.heading,
                manualCar.userData.size || [3.2, 1.12, 5.4],
                car.position,
                car.rotation.y,
                car.userData.size
            );
            if (!collision) return;
            const otherVelocity = new THREE.Vector3(
                car.userData.horizontal ? car.userData.direction * car.userData.speed : 0,
                0,
                car.userData.horizontal ? 0 : car.userData.direction * car.userData.speed
            );
            registerCollision(
                car.position,
                otherVelocity,
                vehicleMass(car.userData.type),
                collision.normal,
                collision.depth,
                false,
                car
            );
        });
        if (state.trainActive) {
            const collision = getObbCollision(
                manual.position,
                manual.heading,
                manualCar.userData.size || [3.2, 1.12, 5.4],
                new THREE.Vector3(state.trainX - 20.75, .45, 24),
                0,
                [44, 3.2, 3.5]
            );
            if (collision) {
                registerCollision(
                    new THREE.Vector3(state.trainX - 20.75, 1, 24),
                    new THREE.Vector3(.68, 0, 0),
                    180000,
                    collision.normal,
                    collision.depth,
                    true
                );
            }
        }
        const staticObstacles = [
            { x: -31, z: -31, w: 12, d: 10 },
            { x: 32, z: -29, w: 14, d: 12 },
            { x: -34, z: 32, w: 15, d: 11 },
            { x: 34, z: 33, w: 11, d: 13 },
            { x: HOSPITAL_X, z: 23, w: 18, d: 18 }
        ];
        staticObstacles.forEach((obstacle) => {
            const collision = getObbCollision(
                manual.position,
                manual.heading,
                manualCar.userData.size || [3.2, 1.12, 5.4],
                new THREE.Vector3(obstacle.x, .45, obstacle.z),
                0,
                [obstacle.w, 8, obstacle.d]
            );
            if (collision) {
                registerCollision(
                    new THREE.Vector3(obstacle.x, 1, obstacle.z),
                    new THREE.Vector3(),
                    100000,
                    collision.normal,
                    collision.depth,
                    true
                );
            }
        });
        [policeCar, state.towTruck, state.ambulance].forEach((vehicle) => {
            if (!vehicle.visible) return;
            const collision = getObbCollision(
                manual.position,
                manual.heading,
                manualCar.userData.size || [3.2, 1.12, 5.4],
                vehicle.position,
                vehicle.rotation.y,
                vehicle.userData.size
            );
            if (collision) {
                registerCollision(
                    vehicle.position,
                    new THREE.Vector3(),
                    vehicle === state.towTruck ? 5200 : 1800,
                    collision.normal,
                    collision.depth,
                    true
                );
            }
        });
        if (state.trainActive) {
            barrierGroups.forEach((barrier) => {
                if (Math.abs(barrier.arm.rotation.z) > .05) return;
                const center = barrier.group.localToWorld(new THREE.Vector3(5, 2.25, 0));
                const collision = getObbCollision(
                    manual.position,
                    manual.heading,
                    manualCar.userData.size || [3.2, 1.12, 5.4],
                    new THREE.Vector3(center.x, .45, center.z),
                    barrier.group.rotation.y,
                    [10, 2.5, .4]
                );
                if (collision) {
                    registerCollision(
                        new THREE.Vector3(center.x, 1, center.z),
                        new THREE.Vector3(),
                        100000,
                        collision.normal,
                        collision.depth,
                        true
                    );
                }
            });
        }
        if (Math.abs(manual.position.x) > WORLD_HALF - 4) {
            const normal = manual.position.x > 0 ? new THREE.Vector2(-1, 0) : new THREE.Vector2(1, 0);
            manual.position.x = THREE.MathUtils.clamp(manual.position.x, -WORLD_HALF + 4, WORLD_HALF - 4);
            registerCollision(manual.position, new THREE.Vector3(), 100000, normal, 1.2, true);
        }
        if (Math.abs(manual.position.z) > WORLD_HALF - 4) {
            const normal = manual.position.z > 0 ? new THREE.Vector2(0, -1) : new THREE.Vector2(0, 1);
            manual.position.z = THREE.MathUtils.clamp(manual.position.z, -WORLD_HALF + 4, WORLD_HALF - 4);
            registerCollision(manual.position, new THREE.Vector3(), 100000, normal, 1.2, true);
        }
    }

    function checkPracticeInfractions() {
        const playerHorizontal = Math.abs(Math.sin(manual.heading)) > .5;
        const signalColor = getSignalColor(playerHorizontal);
        const atIntersection = Math.abs(manual.position.x) < 13 && Math.abs(manual.position.z) < 13;
        if (atIntersection && signalColor !== "green" && manual.speed > 1.5) {
            const now = performance.now();
            if (now - lastRedAt > 2500) {
                lastRedAt = now;
                state.infractions += 1;
                showPracticeAlert("Infração: avanço com sinal vermelho.");
            }
        }
        if (state.trainActive && Math.abs(manual.position.z - 24) < 5.5 && Math.abs(manual.position.x) < WORLD_HALF) {
            const now = performance.now();
            if (now - lastRedAt > 2500) {
                lastRedAt = now;
                state.infractions += 1;
                showPracticeAlert("Infração: invasão da faixa ferroviária.");
            }
        }
        const playerDistance = Math.hypot(manual.position.x, manual.position.z);
        if (playerDistance > 11 && playerDistance < 24) {
            const entryAngle = Math.atan2(manual.position.z, manual.position.x);
            const anotherInside = aiVehicles.some((car) =>
                car.userData.roundaboutMode === "circle" &&
                Math.abs(shortestAngleDifference(car.userData.roundaboutAngle, entryAngle + Math.PI / 2)) < .95
            );
            if (anotherInside && Math.abs(manual.speed) > .2) {
                const now = performance.now();
                if (now - lastRedAt > 2500) {
                    lastRedAt = now;
                    state.infractions += 1;
                    showPracticeAlert("Infração leve: prioridade da rotatória.");
                }
            }
        }
    }

    function updateManual(delta) {
        if (!Number.isFinite(manual.position.x) ||
            !Number.isFinite(manual.position.z) ||
            !Number.isFinite(manual.heading) ||
            !Number.isFinite(manual.speed)) {
            recoverManualVehicle("invalid player state before movement");
        }
        if (state.accidentIsPlayer || !state.towHud.hidden) {
            manual.speed = 0;
            manual.velocity.set(0, 0, 0);
            manual.steerAngle = 0;
            manualCar.position.copy(manual.position);
            manualCar.userData.frontWheels.forEach((wheel) => {
                wheel.rotation.y = 0;
            });
            return;
        }
        const forward = keys.has("w") || keys.has("W") || keys.has("ArrowUp");
        const reverse = keys.has("s") || keys.has("S") || keys.has("ArrowDown");
        const left = keys.has("a") || keys.has("A") || keys.has("ArrowLeft");
        const right = keys.has("d") || keys.has("D") || keys.has("ArrowRight");
        const steerInput = (left ? 1 : 0) - (right ? 1 : 0);

        const targetSteer = THREE.MathUtils.clamp(steerInput * .55, -.55, .55);
        manual.steerAngle = THREE.MathUtils.lerp(manual.steerAngle, targetSteer, 1 - Math.pow(.0008, delta));
        if (steerInput === 0) {
            manual.steerAngle = THREE.MathUtils.lerp(manual.steerAngle, 0, 1 - Math.pow(.08, delta));
        }

        if (forward && !reverse) {
            if (manual.speed < -.05) {
                manual.speed = Math.min(manual.speed + delta * 5.5, 0);
            } else {
                manual.speed = Math.min(manual.speed + delta * 2.8, 11);
            }
        } else if (reverse && !forward) {
            if (manual.speed > .05) {
                manual.speed = Math.max(manual.speed - delta * 5.5, 0);
            } else {
                manual.speed = Math.max(manual.speed - delta * 2.2, -5);
            }
        } else {
            manual.speed *= Math.pow(.88, delta * 60);
        }

        if (manual.speed > .05) state.gear = "D";
        else if (manual.speed < -.05) state.gear = "R";
        else state.gear = "P";
        state.steerAngle = manual.steerAngle;

        if (Math.abs(manual.speed) > .02) {
            const wheelBase = 5.4;
            const yawRate = (manual.speed / wheelBase) * Math.tan(manual.steerAngle);
            manual.heading += yawRate * delta;
        }
        manual.position.x += Math.sin(manual.heading) * manual.speed * delta;
        manual.position.z += Math.cos(manual.heading) * manual.speed * delta;

        if (state.trainActive && Math.abs(manual.position.z - 24) < 7 && Math.abs(manual.position.x) < WORLD_HALF) {
            manual.speed *= 0.1;
        }

        manual.position.x = THREE.MathUtils.clamp(manual.position.x, -WORLD_HALF + 4, WORLD_HALF - 4);
        manual.position.z = THREE.MathUtils.clamp(manual.position.z, -WORLD_HALF + 4, WORLD_HALF - 4);
        manual.velocity.set(
            Math.sin(manual.heading) * manual.speed,
            0,
            Math.cos(manual.heading) * manual.speed
        );
        checkPracticeCollisions();
        checkPracticeInfractions();
        if (!Number.isFinite(manual.position.x) ||
            !Number.isFinite(manual.position.z) ||
            !Number.isFinite(manual.heading) ||
            !Number.isFinite(manual.speed)) {
            recoverManualVehicle("invalid player state after collision resolution");
        } else {
            manual.lastFinitePosition.copy(manual.position);
        }
        manualCar.position.copy(manual.position);
        manualCar.rotation.y = manual.heading;
        manualCar.userData.frontWheels.forEach((wheel) => {
            wheel.rotation.y = manual.steerAngle;
        });
    }

    function updateCamera() {
        if (state.cameraMode === 4) {
            state.aerial = true;
            let panX = (keys.has("d") || keys.has("D") || keys.has("ArrowRight") ? 1 : 0)
                - (keys.has("a") || keys.has("A") || keys.has("ArrowLeft") ? 1 : 0);
            let panZ = (keys.has("w") || keys.has("W") || keys.has("ArrowUp") ? 1 : 0)
                - (keys.has("s") || keys.has("S") || keys.has("ArrowDown") ? 1 : 0);
            if (panX || panZ) {
                const length = Math.hypot(panX, panZ) || 1;
                panX /= length;
                panZ /= length;
                state.freeCameraTarget.x += panX * .42;
                state.freeCameraTarget.z += panZ * .42;
            }
            if (keys.has("q") || keys.has("Q")) state.freeCameraYaw -= .018;
            if (keys.has("e") || keys.has("E")) state.freeCameraYaw += .018;
            const horizontal = state.freeCameraDistance * Math.cos(state.freeCameraPitch);
            const desired = new THREE.Vector3(
                state.freeCameraTarget.x + Math.sin(state.freeCameraYaw) * horizontal,
                state.freeCameraTarget.y + state.freeCameraDistance * Math.sin(state.freeCameraPitch),
                state.freeCameraTarget.z + Math.cos(state.freeCameraYaw) * horizontal
            );
            camera.position.lerp(desired, .08);
            camera.lookAt(state.freeCameraTarget);
        } else if (state.cameraMode === 1) {
            const forward = new THREE.Vector3(
                Math.sin(manual.heading),
                0,
                Math.cos(manual.heading)
            );
            const right = new THREE.Vector3(forward.z, 0, -forward.x);
            const cockpit = manual.position.clone()
                .addScaledVector(forward, 1.15)
                .addScaledVector(right, -.75)
                .add(new THREE.Vector3(0, 2.05, 0));
            cockpit.applyAxisAngle(new THREE.Vector3(0, 1, 0), state.cameraLookSide);
            camera.position.lerp(cockpit, .22);
            const lookTarget = cockpit.clone()
                .addScaledVector(forward, 45)
                .add(new THREE.Vector3(0, -.3, 0));
            camera.lookAt(lookTarget);
        } else if (state.cameraMode === 2) {
            const forward = new THREE.Vector3(
                Math.sin(manual.heading),
                0,
                Math.cos(manual.heading)
            );
            let hood = state.secondPersonFront
                ? manual.position.clone().addScaledVector(forward, 8)
                : manual.position.clone().addScaledVector(forward, -8);
            hood.y = state.secondPersonFront ? 3.0 : 4.2;
            if (!state.secondPersonFront) hood.add(new THREE.Vector3(forward.z * 7, 0, -forward.x * 7));
            camera.position.lerp(hood, .12);
            camera.lookAt(manual.position.x, 1.25, manual.position.z);
        } else {
            state.aerial = false;
            const forward = new THREE.Vector3(
                Math.sin(manual.heading),
                0,
                Math.cos(manual.heading)
            );
            const distance = 18 + THREE.MathUtils.clamp(Math.abs(manual.speed) * .2, 0, 8);
            const target = manual.position.clone()
                .addScaledVector(forward, -distance)
                .add(new THREE.Vector3(0, 11, 0));
            camera.position.lerp(target, 1 - Math.pow(.025, 1 / 60));
            camera.lookAt(manual.position.x, 1.5, manual.position.z);
        }
        if (state.cameraShake > 0.01) {
            camera.position.x += (Math.random() - .5) * state.cameraShake;
            camera.position.y += (Math.random() - .5) * state.cameraShake * .35;
            state.cameraShake *= .88;
        }
    }

    const radar = document.querySelector("#practice-radar");
    const radarContext = radar && radar.getContext("2d");
    if (!radarContext) {
        console.error("O canvas do radar não oferece um contexto 2D.");
        container.innerHTML = '<div class="practice-fallback">Não foi possível iniciar o radar do simulador.</div>';
        return;
    }
    function drawRadar() {
        const scale = radar.width / WORLD_SIZE;
        radarContext.clearRect(0, 0, radar.width, radar.height);
        radarContext.fillStyle = "#11171a";
        radarContext.fillRect(0, 0, radar.width, radar.height);
        radarContext.strokeStyle = "#36464a";
        radarContext.lineWidth = 24 * scale;
        radarContext.beginPath();
        radarContext.moveTo(0, radar.height / 2);
        radarContext.lineTo(radar.width, radar.height / 2);
        radarContext.moveTo(radar.width / 2, 0);
        radarContext.lineTo(radar.width / 2, radar.height);
        radarContext.stroke();
        radarContext.lineWidth = SIDE_STREET_WIDTH * scale;
        radarContext.beginPath();
        [-SIDE_STREET_OFFSET, SIDE_STREET_OFFSET].forEach((offset) => {
            const roadCoordinate = (offset + WORLD_HALF) * scale;
            radarContext.moveTo(0, roadCoordinate);
            radarContext.lineTo(radar.width, roadCoordinate);
            radarContext.moveTo(roadCoordinate, 0);
            radarContext.lineTo(roadCoordinate, radar.height);
        });
        radarContext.stroke();

        function point(x, z, color, radius) {
            radarContext.fillStyle = color;
            radarContext.beginPath();
            radarContext.arc((x + WORLD_HALF) * scale, (z + WORLD_HALF) * scale, radius, 0, Math.PI * 2);
            radarContext.fill();
        }
        aiVehicles.forEach((car) => {
            if (car.visible) point(car.position.x, car.position.z, "#63a5ff", 3);
        });
        point(manual.position.x, manual.position.z, "#f4c94d", 4);
        if (state.trainActive) point(state.trainX - 20.75, 24, "#ff5959", 5);
        if (state.policeActive) point(policeCar.position.x, policeCar.position.z, "#4d8cff", 5);
        if (state.ambulance.visible) {
            point(state.ambulance.position.x, state.ambulance.position.z, "#ff525c", 5);
        }
        point(HOSPITAL_X, 23, "#ff5260", 4);
    }

    function updateHud() {
        const speed = Math.abs(manual.speed) * 4.1;
        const activeVehicles = aiVehicles.filter((car) => car.visible);
        const averageSpeed = activeVehicles.length
            ? activeVehicles.reduce((sum, car) => sum + car.userData.speed * 4.1, 0) / activeVehicles.length
            : speed;
        const aiWait = activeVehicles.length
            ? activeVehicles.reduce((sum, car) => sum + car.userData.waiting, 0) / activeVehicles.length
            : 0;
        const wait = state.waiting + aiWait;
        const flow = Math.round(state.density * (state.trainActive ? 0.55 : 0.86));
        document.querySelector("#practice-avg-speed").textContent = `${averageSpeed.toFixed(1)} km/h`;
        document.querySelector("#practice-avg-wait").textContent = `${wait.toFixed(1)} s`;
        document.querySelector("#practice-flow").textContent = String(flow);
        if (performance.now() - state.aiStatusUpdatedAt >= 700) {
            const aiStatus = document.querySelector("#practice-ai-status");
            if (aiStatus) {
                const yielding = aiVehicles.filter((car) => {
                    if (!car.visible || car.userData.crashed ||
                        car.userData.roundaboutMode === "circle") return false;
                    const lanePosition = car.userData.horizontal
                        ? car.position.z
                        : car.position.x;
                    const progress = (car.userData.horizontal
                        ? car.position.x
                        : car.position.z) * car.userData.direction;
                    return Math.abs(lanePosition) < 12.5 &&
                        progress >= -45 && progress <= -12 &&
                        !car.userData.intersectionGranted;
                }).length;
                const owner = state.intersectionOwner;
                aiStatus.textContent = owner
                    ? `Coordenação ativa · veículo ${owner.userData.index + 1} tem prioridade; ${yielding} cedendo.`
                    : `Coordenação ativa · ${yielding ? `${yielding} aguardando espaço ou sinal verde.` : "cruzamento livre."}`;
            }
            const signalStatus = document.querySelector("#practice-signal-status");
            if (signalStatus) {
                const labels = {
                    green: "verde",
                    yellow: "amarelo",
                    red: "vermelho"
                };
                signalStatus.textContent =
                    `Semáforos · Leste–Oeste: ${labels[getSignalColor(true)]} · ` +
                    `Norte–Sul: ${labels[getSignalColor(false)]}`;
            }
            state.aiStatusUpdatedAt = performance.now();
        }
        const status = document.querySelector("#practice-status");
        if (status && performance.now() > state.alertUntil) {
            status.textContent =
                `Infrações: ${state.infractions} · Colisões: ${state.collisions} · ` +
                `${state.policeStatus}${state.policeResponse > 0 ? ` · resposta ${state.policeResponse.toFixed(1)} s` : ""}`;
        }
        const cockpit = document.querySelector("#practice-cockpit");
        if (cockpit) {
            cockpit.querySelector("#practice-cockpit-speed").textContent =
                `${Math.round(Math.abs(manual.speed) * 4.1)} km/h`;
            cockpit.querySelector("#practice-cockpit-gear").textContent = state.gear;
            cockpit.querySelector("#practice-cockpit-steer").style.transform =
                `rotate(${(-manual.steerAngle * 100).toFixed(1)}deg)`;
        }
    }

    function resize() {
        const rect = container.getBoundingClientRect();
        renderer.setSize(rect.width, rect.height, false);
        camera.aspect = rect.width / Math.max(rect.height, 1);
        camera.updateProjectionMatrix();
    }
    window.addEventListener("resize", () => runLoopModule("resize", resize));
    runLoopModule("resize", resize);

    window.addEventListener("keydown", (event) => {
        if (event.code === "Space" && !event.repeat) {
            event.preventDefault();
            togglePause();
            return;
        }
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "W", "a", "A", "s", "S", "d", "D", "q", "Q", "e", "E"].includes(event.key)) {
            event.preventDefault();
            keys.add(event.key);
        }
        if (event.key.toLowerCase() === "c" && !event.repeat) cycleCamera();
        if (event.key.toLowerCase() === "v" && !event.repeat) {
            state.secondPersonFront = !state.secondPersonFront;
        }
        if (event.key.toLowerCase() === "q") state.cameraLookSide = THREE.MathUtils.clamp(state.cameraLookSide - .55, -.55, .55);
        if (event.key.toLowerCase() === "e") state.cameraLookSide = THREE.MathUtils.clamp(state.cameraLookSide + .55, -.55, .55);
    });
    window.addEventListener("keyup", (event) => {
        keys.delete(event.key);
        if (event.key.toLowerCase() === "q" || event.key.toLowerCase() === "e") {
            state.cameraLookSide = THREE.MathUtils.lerp(state.cameraLookSide, 0, .35);
        }
    });
    window.addEventListener("blur", () => keys.clear());
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible") keys.clear();
    });

    let draggingCamera = false;
    let dragX = 0;
    let dragY = 0;
    renderer.domElement.addEventListener("pointerdown", (event) => {
        draggingCamera = true;
        dragX = event.clientX;
        dragY = event.clientY;
        renderer.domElement.setPointerCapture?.(event.pointerId);
    });
    renderer.domElement.addEventListener("pointermove", (event) => runLoopModule("camera-drag", () => {
        if (!draggingCamera || !state.aerial) return;
        state.freeCameraYaw -= (event.clientX - dragX) * .006;
        state.freeCameraPitch = THREE.MathUtils.clamp(
            state.freeCameraPitch + (event.clientY - dragY) * .004,
            .18,
            1.35
        );
        dragX = event.clientX;
        dragY = event.clientY;
    }));
    renderer.domElement.addEventListener("pointerup", () => { draggingCamera = false; });
    renderer.domElement.addEventListener("wheel", (event) => runLoopModule("camera-zoom", () => {
        if (!state.aerial) return;
        event.preventDefault();
        state.freeCameraDistance = THREE.MathUtils.clamp(
            state.freeCameraDistance + event.deltaY * .025,
            12,
            WORLD_HALF * 1.6
        );
    }), { passive: false });

    const cameraNames = {
        1: "1ª pessoa",
        2: "2ª pessoa",
        3: "3ª pessoa",
        4: "Aérea"
    };
    function updateCameraButton() {
        const button = document.querySelector("#practice-camera");
        const selector = document.querySelector("#practice-camera-mode");
        if (button) button.textContent = `Câmera: ${cameraNames[state.cameraMode]}`;
        if (selector) selector.value = String(state.cameraMode);
        const cockpit = document.querySelector("#practice-cockpit");
        if (cockpit) cockpit.hidden = state.cameraMode !== 1;
    }
    function cycleCamera() {
        runLoopModule("camera-input", () => {
            state.cameraMode = state.cameraMode >= 4 ? 1 : state.cameraMode + 1;
            state.aerial = state.cameraMode === 4;
            if (state.aerial) state.freeCameraTarget.copy(manual.position);
            updateCameraButton();
        });
    }
    updateCameraButton();
    const cameraButton = document.querySelector("#practice-camera");
    if (cameraButton) cameraButton.addEventListener("click", cycleCamera);
    const cameraSelector = document.querySelector("#practice-camera-mode");
    if (cameraSelector) {
        cameraSelector.addEventListener("change", () => {
            runLoopModule("camera-input", () => {
                state.cameraMode = Number(cameraSelector.value);
                state.aerial = state.cameraMode === 4;
                if (state.aerial) state.freeCameraTarget.copy(manual.position);
                updateCameraButton();
            });
        });
    }
    document.querySelector("#practice-day").addEventListener("click", (event) => {
        runLoopModule("day-night-input", () => {
            state.dusk = !state.dusk;
            scene.background.setHex(state.dusk ? 0x6f7184 : 0x9bc4a4);
            scene.fog.color.setHex(state.dusk ? 0x6f7184 : 0x9bc4a4);
            sun.intensity = state.dusk ? .42 : 1.15;
            sun.color.setHex(state.dusk ? 0xff9a65 : 0xfff4d6);
            event.currentTarget.textContent = state.dusk ? "Modo dia" : "Entardecer";
        });
    });
    document.querySelector("#practice-reset").addEventListener("click", () =>
        runLoopModule("practice-reset", resetPractice)
    );
    const pauseButton = document.querySelector("#practice-pause");
    function togglePause() {
        state.paused = !state.paused;
        if (pauseButton) pauseButton.textContent = state.paused ? "Retomar" : "Pausar";
        const live = document.querySelector("#practice-live");
        if (live) {
            live.dataset.paused = String(state.paused);
            live.textContent = state.paused ? "Simulação pausada" : "Simulação ao vivo";
        }
        if (state.paused) keys.clear();
    }
    if (pauseButton) pauseButton.addEventListener("click", togglePause);

    let spatialContext = null;
    let masterGain = null;
    let engineOscillator = null;
    let engineGain = null;
    let policeOscillator = null;
    let policeGain = null;
    let policePanner = null;
    let enginePanner = null;
    let ambulanceOscillator = null;
    let ambulanceGain = null;
    let ambulancePanner = null;

    function setSpatialPosition(panner, position) {
        if (!panner) return;
        if (panner.positionX) {
            panner.positionX.value = position.x - camera.position.x;
            panner.positionY.value = position.y - camera.position.y;
            panner.positionZ.value = position.z - camera.position.z;
        } else if (panner.pan) {
            panner.pan.value = THREE.MathUtils.clamp(
                (position.x - camera.position.x) / 30,
                -1,
                1
            );
        }
    }

    function initSpatialAudio() {
        if (spatialContext) {
            if (spatialContext.state === "suspended") spatialContext.resume();
            return;
        }
        spatialContext = new (window.AudioContext || window.webkitAudioContext)();
        masterGain = spatialContext.createGain();
        masterGain.gain.value = .18;
        masterGain.connect(spatialContext.destination);

        engineOscillator = spatialContext.createOscillator();
        engineGain = spatialContext.createGain();
        enginePanner = spatialContext.createStereoPanner();
        engineOscillator.type = "sawtooth";
        engineOscillator.frequency.value = 38;
        engineGain.gain.value = .025;
        engineOscillator.connect(engineGain);
        engineGain.connect(enginePanner);
        enginePanner.connect(masterGain);
        engineOscillator.start();

        policeOscillator = spatialContext.createOscillator();
        policeGain = spatialContext.createGain();
        policePanner = spatialContext.createStereoPanner();
        policeOscillator.type = "sine";
        policeOscillator.frequency.value = 660;
        policeGain.gain.value = .018;
        policeOscillator.connect(policeGain);
        policeGain.connect(policePanner);
        policePanner.connect(masterGain);
        policeOscillator.start();

        ambulanceOscillator = spatialContext.createOscillator();
        ambulanceGain = spatialContext.createGain();
        ambulancePanner = spatialContext.createStereoPanner();
        ambulanceOscillator.type = "sine";
        ambulanceOscillator.frequency.value = 760;
        ambulanceGain.gain.value = 0;
        ambulanceOscillator.connect(ambulanceGain);
        ambulanceGain.connect(ambulancePanner);
        ambulancePanner.connect(masterGain);
        ambulanceOscillator.start();
    }

    function updateSpatialAudio() {
        if (!state.audioEnabled || !spatialContext) return;
        setSpatialPosition(enginePanner, manual.position);
        setSpatialPosition(policePanner, policeCar.position);
        setSpatialPosition(ambulancePanner, state.ambulance.position);
        engineOscillator.frequency.value = 32 + Math.abs(manual.speed) * 2.2;
        const siren = state.policeActive
            ? (Math.floor(performance.now() / 500) % 2 ? 720 : 880)
            : 220;
        policeOscillator.frequency.value = siren;
        policeGain.gain.value = state.policeActive ? .025 : .003;
        const ambulanceResponding = state.accidentState &&
            state.accidentState.medicalPhase !== "complete";
        ambulanceOscillator.frequency.value =
            Math.floor(performance.now() / 360) % 2 ? 760 : 920;
        ambulanceGain.gain.value = ambulanceResponding ? .022 : 0;
    }

    const audioButton = document.querySelector("#practice-audio");
    if (audioButton) {
        audioButton.addEventListener("click", (event) => {
            runLoopModule("audio-input", () => {
                state.audioEnabled = !state.audioEnabled;
                if (state.audioEnabled) initSpatialAudio();
                if (masterGain) masterGain.gain.value = state.audioEnabled ? .18 : 0;
                event.currentTarget.textContent = state.audioEnabled ? "Mutar som" : "Ativar som";
            });
        });
    }

    const greenInput = document.querySelector("#practice-green");
    const densityInput = document.querySelector("#practice-density");
    const trainInput = document.querySelector("#practice-train");
    const speedInput = document.querySelector("#practice-speed");
    greenInput.addEventListener("input", () => runLoopModule("green-time-input", () => {
        state.greenTime = Number(greenInput.value);
        document.querySelector("#practice-green-output").textContent = `${state.greenTime} s`;
    }));
    densityInput.addEventListener("input", () => runLoopModule("density-input", () => {
        state.density = Number(densityInput.value);
        document.querySelector("#practice-density-output").textContent = String(state.density);
        syncAiCount();
    }));
    trainInput.addEventListener("input", () => runLoopModule("train-interval-input", () => {
        state.trainInterval = Number(trainInput.value);
        document.querySelector("#practice-train-output").textContent = `${state.trainInterval} s`;
    }));
    if (speedInput) speedInput.addEventListener("input", () => runLoopModule("traffic-speed-input", () => {
        state.trafficScale = Number(speedInput.value);
        document.querySelector("#practice-speed-output").textContent = `${state.trafficScale.toFixed(1)}x`;
        aiVehicles.forEach((car) => {
            if (car.userData.roundaboutMode === "circle") car.userData.speed =
                THREE.MathUtils.clamp(car.userData.speed, 0, car.userData.desiredSpeed * state.trafficScale);
        });
    }));

    function resetPractice() {
        state.paused = false;
        state.intersectionOwner = null;
        state.aiStatusUpdatedAt = 0;
        if (pauseButton) pauseButton.textContent = "Pausar";
        const live = document.querySelector("#practice-live");
        if (live) {
            live.dataset.paused = "false";
            live.textContent = "Simulação ao vivo";
        }
        manual.position.set(-42, 0.45, -8);
        manual.lastFinitePosition.copy(manual.position);
        manual.heading = Math.PI / 2;
        manual.speed = 0;
        manual.velocity.set(0, 0, 0);
        manual.steerAngle = 0;
        state.gear = "P";
        state.waiting = 0;
        state.trainElapsed = 0;
        state.trainActive = false;
        state.collisions = 0;
        state.infractions = 0;
        state.waiting = 0;
        state.policeActive = false;
        state.policeMode = null;
        state.policeResponse = 0;
        state.policeStatus = "Sem ocorrências";
        policeCar.visible = false;
        state.officer.visible = false;
        state.ambulance.visible = false;
        [...state.patients, state.paramedic].forEach((person) => {
            person.visible = false;
        });
        state.towTruck.visible = false;
        state.towTruck.userData.ramp.rotation.x = 0;
        state.accidentState = null;
        state.accidentSmoke.forEach((puff) => {
            scene.remove(puff);
            puff.geometry.dispose();
            puff.material.dispose();
        });
        state.accidentSmoke = [];
        state.towHud.hidden = true;
        state.towCountdown = 0;
        manualCar.userData.hazardActive = false;
        manualCar.userData.lights.turnLeft.material.color.setHex(0xffad38);
        manualCar.userData.lights.turnRight.material.color.setHex(0xffad38);
        state.accidentVehicle = null;
        state.accidentIsPlayer = false;
        state.accidentPosition = null;
        aiVehicles.forEach((car) => {
            car.userData.crashed = false;
            car.userData.hazardUntil = 0;
            car.userData.maneuverPath = null;
            car.userData.maneuverKind = null;
            car.userData.roundaboutMode = "road";
        });
        manualCar.visible = true;
        train.position.x = -80;
        setBarrier(false);
    }

    function animate(now) {
        window.requestAnimationFrame(animate);
        const dt = Math.min(clock.getDelta(), 0.033);
        if (!Number.isFinite(dt) || dt < 0) {
            console.error("O relógio do simulador retornou um delta inválido.", dt);
            return;
        }
        if (state.paused) {
            runLoopModule("camera", updateCamera);
            runLoopModule("radar", drawRadar);
            runLoopModule("renderer", () => renderer.render(scene, camera));
            return;
        }
        runLoopModule("simulation-clock", () => {
            state.trafficElapsed += dt;
        });
        runLoopModule("railway", () => updateTrain(dt));
        runLoopModule("police", () => updatePolice(dt));
        runLoopModule("medical-response", () => updateMedicalResponse(dt));
        runLoopModule("tow-service", () => updateTowService(dt));
        const subStep = dt / 4;
        for (let step = 0; step < 4; step += 1) {
            runLoopModule("player-vehicle", () => updateManual(subStep));
            runLoopModule("autonomous-traffic", () => updateVehicleCount(subStep));
        }
        runLoopModule("impact-effects", () => updateImpactEffects(dt));
        runLoopModule("accident-smoke", () => updateAccidentSmoke(dt));
        runLoopModule("accident-hazards", updateAccidentHazards);
        runLoopModule("tow-countdown", () => updateTowCountdown(dt));
        runLoopModule("traffic-signals", setTrafficLightColor);
        runLoopModule("spatial-audio", updateSpatialAudio);
        runLoopModule("camera", updateCamera);
        runLoopModule("radar", drawRadar);
        runLoopModule("hud", updateHud);
        runLoopModule("renderer", () => renderer.render(scene, camera));
    }

    resetPractice();
    camera.position.set(-58, 9, -21);
    camera.lookAt(manual.position);
    window.requestAnimationFrame(animate);
})();
