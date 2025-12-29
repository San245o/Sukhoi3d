import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ===== CONFIGURATION =====
const CONFIG = {
    modelPath: './assets/scene.gltf',
    
    // FIXED CAMERA - Never changes! Just adjust aircraft values below.
    fixedCamera: {
        position: new THREE.Vector3(0, 2, 20),  // Camera location (x, y, z)
        target: new THREE.Vector3(0, 0, 0),     // Camera looks at origin
        fov: 35                                  // Field of view (lower = more zoom)
    },
    
    // ============================================================
    // AIRCRAFT POSITIONS - Only modify these values!
    // ============================================================
    // position: (x, y, z) = (right/left, up/down, close/far)
    // rotation: (rx, ry, rz) = (pitch, yaw, roll) in radians
    //
    // ROTATION GUIDE:
    //   ry = 0      → Front view
    //   ry = 1.57   → Left side (90°)
    //   ry = -1.57  → Right side (-90°)
    //   ry = 3.14   → Rear view (180°)
    //   rx = 0.5    → Nose up (show bottom)
    //   rx = -0.5   → Nose down (show top)
    //   rz = 0.3    → Roll right (bank)
    //   rz = -0.3   → Roll left (bank)
    // ============================================================
    
    aircraftPositions: [
        // Section 0: HERO - Front view, centered
        { position: new THREE.Vector3(10, 0, 0), rotation: new THREE.Vector3(1.57, 0, 0) },
        
        // Section 1: OVERVIEW - Slight angle, show left side
        { position: new THREE.Vector3(-2, 0, 3), rotation: new THREE.Vector3(0.6, 3.14, -0.1) },
        
        // Section 2: PROPULSION - Show rear/engines, from right
        { position: new THREE.Vector3(-2, 0, 0), rotation: new THREE.Vector3(0, 1.5, -0.1) },
        
        // Section 3: AVIONICS - Show nose/cockpit from left
        { position: new THREE.Vector3(0, 0, 8), rotation: new THREE.Vector3(0.3, 2.6, -0.15) },
        
        // Section 4: WEAPONS - Show bottom/underside
        { position: new THREE.Vector3(0, -3, 0), rotation: new THREE.Vector3(-1.5, 0.4, 0.2) },
        
        // Section 5: STEALTH - Show top view
        { position: new THREE.Vector3(1, -1, 4), rotation: new THREE.Vector3(0.7, -0.6, -0.1) },
        
        // Section 6: SPECS - Full rear view
        { position: new THREE.Vector3(0, -2, 0), rotation: new THREE.Vector3(0.5, 2.9, -0.5) }
    ]
};

// ===== GLOBAL VARIABLES =====
let scene, camera, renderer, controls;
let aircraft = null;
let mixer = null;
let clock = new THREE.Clock();
let scrollProgress = 0;
let currentSection = 0;
let targetCameraPosition = new THREE.Vector3();
let targetCameraTarget = new THREE.Vector3();
let targetAircraftPosition = new THREE.Vector3();
let targetAircraftRotation = new THREE.Vector3();
let loadingProgress = 0;

// MediaPipe Hand Control
let handControlEnabled = false;
let handPosition = { x: 0.5, y: 0.5, z: 0 };
let handRotation = { x: 0, y: 0, z: 0 };
let handZoom = 1.0; // Zoom level controlled by hand open/close
let hands = null;
let videoElement = null;
let handCanvas = null;
let handCtx = null;
let isHandDetected = false;

// Parallax Background
let currentBgIndex = 0;
let lastBgIndex = -1;
let bgLayers = [];
let parallaxOffset = { x: 0, y: 0 };
const NUM_BACKGROUNDS = 4; // alps, desert, fields, forest

// ===== INITIALIZATION =====
function init() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(CONFIG.fixedCamera.fov, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.copy(CONFIG.fixedCamera.position);
    
    // Initialize targets to fixed camera values
    targetCameraPosition.copy(CONFIG.fixedCamera.position);
    targetCameraTarget.copy(CONFIG.fixedCamera.target);
    
    // Initialize aircraft to hero position (section 0)
    targetAircraftPosition.copy(CONFIG.aircraftPositions[0].position);
    targetAircraftRotation.copy(CONFIG.aircraftPositions[0].rotation);

    renderer = new THREE.WebGLRenderer({
        canvas: document.getElementById('webgl-canvas'),
        antialias: true,
        alpha: true
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enabled = false;

    createBlueBackground();
    createLighting();
    loadModel();
    setupHandControlUI();
    setupParallaxBackgrounds();

    window.addEventListener('resize', onWindowResize);
    window.addEventListener('scroll', onScroll);
    document.body.style.overflowY = 'auto';
    
    animate();
}

function createBlueBackground() {
    // Transparent background - let parallax images show through
    scene.background = null;
    renderer.setClearColor(0x000000, 0);
}

function setupParallaxBackgrounds() {
    bgLayers = document.querySelectorAll('.bg-layer');
    
    // Activate first background
    if (bgLayers.length > 0) {
        bgLayers[0].classList.add('active');
        currentBgIndex = 0;
    }
    
    // Add mouse move parallax effect
    document.addEventListener('mousemove', (e) => {
        const centerX = window.innerWidth / 2;
        const centerY = window.innerHeight / 2;
        parallaxOffset.x = (e.clientX - centerX) / centerX * 20;
        parallaxOffset.y = (e.clientY - centerY) / centerY * 20;
    });
}

function updateParallaxBackground(sectionIndex) {
    // Loop through 4 backgrounds for 7 sections
    const newBgIndex = sectionIndex % NUM_BACKGROUNDS;
    
    if (newBgIndex !== currentBgIndex) {
        const motionBlur = document.getElementById('motion-blur-overlay');
        
        // Add motion blur effect
        if (motionBlur) {
            motionBlur.classList.remove('active');
            void motionBlur.offsetWidth; // Force reflow
            motionBlur.classList.add('active');
        }
        
        // Add transitioning blur to current bg
        bgLayers.forEach((layer, i) => {
            if (i === currentBgIndex) {
                layer.classList.add('transitioning');
            }
        });
        
        // Transition backgrounds
        setTimeout(() => {
            bgLayers.forEach((layer, i) => {
                layer.classList.remove('active', 'transitioning');
                if (i === newBgIndex) {
                    layer.classList.add('active');
                }
            });
        }, 150);
        
        currentBgIndex = newBgIndex;
    }
    
    // Apply parallax offset to active background
    bgLayers.forEach((layer, i) => {
        if (layer.classList.contains('active')) {
            const scrollOffset = scrollProgress * 30;
            layer.style.transform = `scale(1.1) translate(${parallaxOffset.x}px, ${parallaxOffset.y + scrollOffset}px)`;
        }
    });
}

function createLighting() {
    scene.add(new THREE.AmbientLight(0x4488ff, 0.4));
    const mainLight = new THREE.DirectionalLight(0xffffff, 1.2);
    mainLight.position.set(50, 50, 50);
    scene.add(mainLight);
    const fillLight = new THREE.DirectionalLight(0x4488ff, 0.6);
    fillLight.position.set(-50, 30, -50);
    scene.add(fillLight);
    const rimLight = new THREE.DirectionalLight(0x00f0ff, 0.4);
    rimLight.position.set(0, -20, -50);
    scene.add(rimLight);
}

function loadModel() {
    const loader = new GLTFLoader();
    loader.load(CONFIG.modelPath, (gltf) => {
        aircraft = gltf.scene;
        aircraft.scale.set(1, 1, 1);
        aircraft.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                if (child.material) {
                    child.material.envMapIntensity = 1.5;
                    child.material.needsUpdate = true;
                }
            }
        });
        scene.add(aircraft);
        
        // Set initial position to hero (section 0) immediately
        aircraft.position.copy(CONFIG.aircraftPositions[0].position);
        aircraft.rotation.set(
            CONFIG.aircraftPositions[0].rotation.x,
            CONFIG.aircraftPositions[0].rotation.y,
            CONFIG.aircraftPositions[0].rotation.z
        );
        
        if (gltf.animations?.length > 0) {
            mixer = new THREE.AnimationMixer(aircraft);
            gltf.animations.forEach(clip => mixer.clipAction(clip).play());
        }
        completeLoading();
    }, (xhr) => {
        loadingProgress = (xhr.loaded / xhr.total) * 100;
        updateLoadingProgress(loadingProgress);
    }, () => loadModelAlternative());
}

function loadModelAlternative() {
    const loader = new GLTFLoader();
    loader.load('./sukhoi3d/source/scene.gltf', (gltf) => {
        aircraft = gltf.scene;
        aircraft.scale.set(1, 1, 1);
        aircraft.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; }});
        scene.add(aircraft);
        
        // Set initial position to hero (section 0) immediately
        aircraft.position.copy(CONFIG.aircraftPositions[0].position);
        aircraft.rotation.set(
            CONFIG.aircraftPositions[0].rotation.x,
            CONFIG.aircraftPositions[0].rotation.y,
            CONFIG.aircraftPositions[0].rotation.z
        );
        
        completeLoading();
    }, (xhr) => updateLoadingProgress((xhr.loaded / xhr.total) * 100), () => completeLoading());
}

function updateLoadingProgress(progress) {
    const fill = document.querySelector('.progress-fill');
    const percent = document.querySelector('.loading-percent');
    if (fill) fill.style.width = `${progress}%`;
    if (percent) percent.textContent = `${Math.round(progress)}%`;
}

function completeLoading() {
    updateLoadingProgress(100);
    setTimeout(() => {
        const loader = document.getElementById('loader');
        if (loader) loader.classList.add('hidden');
    }, 500);
}

// ===== HAND CONTROL =====
function setupHandControlUI() {
    const btn = document.createElement('button');
    btn.id = 'hand-control-btn';
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24"><path d="M18 11V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v1M14 10V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v6M10 10.5V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 0 1 2 2v7a5 5 0 0 1-5 5h-3.5a5 5 0 0 1-4-2l-4.4-5.8a2 2 0 0 1 .7-3 2 2 0 0 1 2.2.4L6 12V6"/></svg><span>HAND CONTROL</span>';
    btn.style.cssText = 'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:rgba(255,255,255,0.2);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.3);color:#1a1a2e;padding:12px 24px;font-family:"Orbitron",monospace;font-size:0.75rem;font-weight:600;letter-spacing:0.1em;cursor:pointer;display:flex;align-items:center;gap:10px;z-index:1000;border-radius:12px;transition:all 0.3s ease;';
    btn.addEventListener('click', toggleHandControl);
    document.body.appendChild(btn);

    videoElement = document.createElement('video');
    videoElement.id = 'webcam';
    videoElement.style.cssText = 'position:fixed;bottom:100px;right:20px;width:200px;height:150px;border:1px solid rgba(255,255,255,0.3);border-radius:12px;z-index:1000;display:none;transform:scaleX(-1);box-shadow:0 8px 32px rgba(0,0,0,0.1);';
    videoElement.autoplay = true;
    videoElement.playsinline = true;
    document.body.appendChild(videoElement);

    handCanvas = document.createElement('canvas');
    handCanvas.id = 'hand-canvas';
    handCanvas.style.cssText = 'position:fixed;bottom:100px;right:20px;width:200px;height:150px;z-index:1001;display:none;pointer-events:none;transform:scaleX(-1);';
    document.body.appendChild(handCanvas);
    handCtx = handCanvas.getContext('2d');

    const indicator = document.createElement('div');
    indicator.id = 'hand-indicator';
    indicator.style.cssText = 'position:fixed;width:30px;height:30px;border:3px solid #1a1a2e;border-radius:50%;pointer-events:none;z-index:1002;display:none;box-shadow:0 0 20px rgba(26,26,46,0.3);';
    indicator.innerHTML = '<div style="width:10px;height:10px;background:#1a1a2e;border-radius:50%;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);"></div>';
    document.body.appendChild(indicator);

    const status = document.createElement('div');
    status.id = 'hand-status';
    status.style.cssText = 'position:fixed;bottom:260px;right:20px;color:#1a1a2e;font-family:"Share Tech Mono",monospace;font-size:0.75rem;z-index:1000;display:none;text-align:center;width:200px;background:rgba(255,255,255,0.2);backdrop-filter:blur(10px);padding:8px;border-radius:8px;';
    status.textContent = 'SHOW HAND TO CONTROL';
    document.body.appendChild(status);
}

async function toggleHandControl() {
    const btn = document.getElementById('hand-control-btn');
    const video = document.getElementById('webcam');
    const canvas = document.getElementById('hand-canvas');
    const indicator = document.getElementById('hand-indicator');
    const status = document.getElementById('hand-status');

    if (!handControlEnabled) {
        try {
            btn.innerHTML = '<span>LOADING...</span>';
            await loadMediaPipe();
            const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' } });
            video.srcObject = stream;
            await video.play();
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            handControlEnabled = true;
            video.style.display = 'block';
            canvas.style.display = 'block';
            indicator.style.display = 'block';
            status.style.display = 'block';
            btn.innerHTML = '<span>STOP CONTROL</span>';
            btn.style.background = 'rgba(255,100,100,0.2)';
            btn.style.color = '#c44';
            detectHands();
        } catch (e) {
            console.error(e);
            alert('Camera access denied');
            btn.innerHTML = '<span>HAND CONTROL</span>';
        }
    } else {
        handControlEnabled = false;
        if (video.srcObject) video.srcObject.getTracks().forEach(t => t.stop());
        video.style.display = 'none';
        canvas.style.display = 'none';
        indicator.style.display = 'none';
        status.style.display = 'none';
        btn.innerHTML = '<span>HAND CONTROL</span>';
        btn.style.background = 'rgba(255,255,255,0.2)';
        btn.style.color = '#1a1a2e';
    }
}

async function loadMediaPipe() {
    return new Promise((resolve, reject) => {
        if (window.Hands) { initializeHands(); resolve(); return; }
        const scripts = [
            'https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js',
            'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js',
            'https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils/drawing_utils.js'
        ];
        let loaded = 0;
        scripts.forEach(src => {
            const s = document.createElement('script');
            s.src = src;
            s.crossOrigin = 'anonymous';
            s.onload = () => { loaded++; if (loaded === 3) { setTimeout(() => { initializeHands(); resolve(); }, 100); }};
            s.onerror = reject;
            document.head.appendChild(s);
        });
    });
}

function initializeHands() {
    hands = new window.Hands({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
    hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.7, minTrackingConfidence: 0.5 });
    hands.onResults(onHandResults);
}

async function detectHands() {
    if (!handControlEnabled || !hands || !videoElement) return;
    try { await hands.send({ image: videoElement }); } catch (e) {}
    requestAnimationFrame(detectHands);
}

function onHandResults(results) {
    if (!handCtx || !handCanvas) return;
    handCtx.clearRect(0, 0, handCanvas.width, handCanvas.height);

    if (results.multiHandLandmarks?.length > 0) {
        isHandDetected = true;
        const lm = results.multiHandLandmarks[0];
        if (window.drawConnectors && window.drawLandmarks) {
            window.drawConnectors(handCtx, lm, window.HAND_CONNECTIONS, { color: '#00f0ff', lineWidth: 2 });
            window.drawLandmarks(handCtx, lm, { color: '#ff3366', lineWidth: 1, radius: 3 });
        }
        const indexTip = lm[8], thumbTip = lm[4], wrist = lm[0], palm = lm[9], pinky = lm[20];
        const middleTip = lm[12], ringTip = lm[16];
        
        // Calculate hand openness (distance from fingertips to palm)
        const palmPos = { x: palm.x, y: palm.y };
        const avgFingerDist = (
            Math.hypot(indexTip.x - palmPos.x, indexTip.y - palmPos.y) +
            Math.hypot(middleTip.x - palmPos.x, middleTip.y - palmPos.y) +
            Math.hypot(ringTip.x - palmPos.x, ringTip.y - palmPos.y) +
            Math.hypot(pinky.x - palmPos.x, pinky.y - palmPos.y)
        ) / 4;
        
        // Map hand openness to zoom (closed = zoom in, open = zoom out)
        // avgFingerDist typically ranges from 0.05 (closed) to 0.25 (open)
        const normalizedOpen = Math.max(0, Math.min(1, (avgFingerDist - 0.08) / 0.15));
        const targetZoom = 0.5 + normalizedOpen * 1.5; // Zoom range: 0.5x to 2.0x (1.5x enhanced)
        handZoom += (targetZoom - handZoom) * 0.1;
        
        handPosition.x += (indexTip.x - handPosition.x) * 0.15;
        handPosition.y += (indexTip.y - handPosition.y) * 0.15;
        handPosition.z += (indexTip.z - handPosition.z) * 0.15;
        handRotation.x += ((palm.y - wrist.y) * 2 - handRotation.x) * 0.15;
        handRotation.y += ((indexTip.x - 0.5) * 2 - handRotation.y) * 0.15;
        handRotation.z += ((thumbTip.y - pinky.y) * 2 - handRotation.z) * 0.15;

        const indicator = document.getElementById('hand-indicator');
        if (indicator) {
            indicator.style.left = `${(1 - indexTip.x) * window.innerWidth - 15}px`;
            indicator.style.top = `${indexTip.y * window.innerHeight - 15}px`;
            indicator.style.borderColor = '#1a1a2e';
            // Scale indicator based on zoom
            const scale = 0.8 + handZoom * 0.4;
            indicator.style.transform = `scale(${scale})`;
        }
        const status = document.getElementById('hand-status');
        if (status) { 
            status.textContent = `ZOOM: ${(handZoom * 100).toFixed(0)}%`; 
            status.style.color = '#1a1a2e'; 
        }
    } else {
        isHandDetected = false;
        const indicator = document.getElementById('hand-indicator');
        if (indicator) indicator.style.borderColor = '#c44';
        const status = document.getElementById('hand-status');
        if (status) { status.textContent = 'SHOW HAND'; status.style.color = '#c44'; }
    }
}

// ===== SCROLL =====
function onScroll() {
    const scrollTop = window.scrollY;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    scrollProgress = scrollTop / docHeight;

    const total = CONFIG.aircraftPositions.length;
    const secProg = scrollProgress * (total - 1);
    currentSection = Math.floor(secProg);
    const blend = secProg - currentSection;
    const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    updateScrollProgress(scrollProgress, currentSection);
    updateNavigation(currentSection);

    // Camera is FIXED - never changes
    targetCameraPosition.copy(CONFIG.fixedCamera.position);
    targetCameraTarget.copy(CONFIG.fixedCamera.target);
    camera.fov = CONFIG.fixedCamera.fov;

    // Only aircraft position/rotation changes based on scroll
    if (currentSection < total - 1) {
        const cAir = CONFIG.aircraftPositions[currentSection];
        const nAir = CONFIG.aircraftPositions[currentSection + 1];
        const e = ease(blend);
        targetAircraftPosition.lerpVectors(cAir.position, nAir.position, e);
        targetAircraftRotation.lerpVectors(cAir.rotation, nAir.rotation, e);
    } else {
        const lastAir = CONFIG.aircraftPositions[total - 1];
        targetAircraftPosition.copy(lastAir.position);
        targetAircraftRotation.copy(lastAir.rotation);
    }
    camera.updateProjectionMatrix();
    updateHUD(scrollProgress);
    animateInfoCards(currentSection);
    updateParallaxBackground(currentSection);
}

function updateScrollProgress(p, s) {
    const thumb = document.getElementById('scroll-thumb');
    if (thumb) thumb.style.top = `${p * 80}%`;
    document.querySelectorAll('.section-marker').forEach((m, i) => m.classList.toggle('active', i <= s));
}

function updateNavigation(s) {
    document.querySelectorAll('.nav-link').forEach((l, i) => l.classList.toggle('active', i === s));
}

function updateHUD(p) {
    const alt = document.getElementById('altitude-display');
    const vel = document.getElementById('velocity-display');
    if (alt) alt.textContent = `${Math.floor(p * 59000).toLocaleString()} FT`;
    if (vel) vel.textContent = `MACH ${(p * 2.25).toFixed(2)}`;
}

function animateInfoCards(s) {
    document.querySelectorAll('.feature-card').forEach((c, i) => c.classList.toggle('visible', i === s - 1));
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    const ar = window.innerWidth / window.innerHeight;
    if (ar < 16 / 9) camera.fov = Math.min(camera.fov * (1 + (16 / 9 - ar) * 0.15), 65);
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// ===== ANIMATE =====
function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    const elapsed = clock.getElapsedTime();

    if (mixer) mixer.update(delta);
    camera.position.lerp(targetCameraPosition, 0.05);
    controls.target.lerp(targetCameraTarget, 0.05);
    controls.update();

    if (aircraft) {
        if (handControlEnabled && isHandDetected) {
            // Hand position controls aircraft position
            const hx = (0.5 - handPosition.x) * 10;
            const hy = (0.5 - handPosition.y) * 6;
            const hz = handPosition.z * -5;
            aircraft.position.lerp(new THREE.Vector3(hx, hy, hz), 0.08);
            
            // Hand tilt controls aircraft rotation
            aircraft.rotation.x += (handRotation.x * 0.8 - aircraft.rotation.x) * 0.06;
            aircraft.rotation.y += (handRotation.y * 1.5 - aircraft.rotation.y) * 0.06;
            aircraft.rotation.z += (handRotation.z * 0.6 - aircraft.rotation.z) * 0.06;
            
            // Hand open/close controls camera zoom (FOV)
            const targetFov = 50 / handZoom; // Smaller FOV = more zoom
            camera.fov += (targetFov - camera.fov) * 0.1;
            camera.updateProjectionMatrix();
        } else {
            const tp = targetAircraftPosition.clone();
            tp.x += Math.sin(elapsed * 0.5 + scrollProgress * Math.PI * 2) * 0.5;
            tp.y += Math.cos(elapsed * 0.7 + scrollProgress * Math.PI) * 0.3;
            tp.z += Math.sin(elapsed * 0.4 + scrollProgress * Math.PI * 1.5) * 0.4;
            // No clamping - allow full range of positions
            aircraft.position.lerp(tp, 0.04);
            
            // Add continuous rotation animation for more dynamic feel
            const rotY = targetAircraftRotation.y + Math.sin(elapsed * 0.3) * 0.1;
            aircraft.rotation.x += (targetAircraftRotation.x + Math.cos(elapsed * 0.6) * 0.03 - aircraft.rotation.x) * 0.04;
            aircraft.rotation.y += (rotY - aircraft.rotation.y) * 0.04;
            aircraft.rotation.z += (targetAircraftRotation.z + Math.sin(elapsed * 0.8) * 0.05 - aircraft.rotation.z) * 0.04;
        }
        aircraft.position.y += Math.sin(elapsed * 0.8) * 0.003;
    }
    
    // Update parallax background position smoothly
    updateParallaxPosition();
    
    renderer.render(scene, camera);
}

function updateParallaxPosition() {
    bgLayers.forEach((layer) => {
        if (layer.classList.contains('active')) {
            const scrollOffset = scrollProgress * 30;
            layer.style.transform = `scale(1.1) translate(${parallaxOffset.x}px, ${parallaxOffset.y + scrollOffset}px)`;
        }
    });
}

// ===== EVENTS =====
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.section-marker').forEach(m => {
        m.addEventListener('click', () => {
            const s = parseInt(m.dataset.section);
            document.querySelectorAll('.content-section')[s]?.scrollIntoView({ behavior: 'smooth' });
        });
    });
    document.querySelectorAll('.nav-link').forEach(l => {
        l.addEventListener('click', e => {
            e.preventDefault();
            const s = parseInt(l.dataset.section);
            document.querySelectorAll('.content-section')[s]?.scrollIntoView({ behavior: 'smooth' });
        });
    });
});

init();
