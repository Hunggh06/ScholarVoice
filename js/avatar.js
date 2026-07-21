import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const AVATAR_URL = '1347496417698417678.vrm';

class TeacherAvatar {
  constructor(container) {
    this._container = container;
    this._canvas = document.getElementById('avatar-canvas');
    this._scene = new THREE.Scene();
    this._isTalking = false;
    this._visible = true;
    this._model = null;
    this._mouthTargets = [];
    this._armBones = { left: [], right: [] };
    this._init();
  }

  _init() {
    const w = this._container.clientWidth || window.innerWidth / 2;
    const h = this._container.clientHeight || window.innerHeight - 60;

    this._renderer = new THREE.WebGLRenderer({ canvas: this._canvas, alpha: true, antialias: true });
    this._renderer.setSize(w, h);
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.outputColorSpace = THREE.SRGBColorSpace;
    this._renderer.setClearColor(0x000000, 0);

    this._camera = new THREE.PerspectiveCamera(20, w / h, 0.1, 50);
    this._camera.position.set(0, 1.5, 5);
    this._camera.lookAt(0, 0.9, 0);

    this._scene.add(new THREE.AmbientLight(0xffffff, 2));
    const key = new THREE.DirectionalLight(0xffffff, 4);
    key.position.set(1, 3, 3);
    this._scene.add(key);
    const fill = new THREE.DirectionalLight(0xccddff, 2);
    fill.position.set(-1, 1.5, -1);
    this._scene.add(fill);

    const loader = new GLTFLoader();
    loader.load(AVATAR_URL, (gltf) => {
      this._model = gltf.scene;
      this._model.position.set(0, -0.7, 0);
      this._model.scale.set(1.15, 1.15, 1.15);
      this._model.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = true;
          node.frustumCulled = false;
          if (node.morphTargetDictionary && node.morphTargetInfluences) {
            for (const [name, idx] of Object.entries(node.morphTargetDictionary)) {
              const lo = name.toLowerCase();
              if (lo.includes('mouth') || lo.includes('aa') || lo.includes('jaw') ||
                  lo.includes('open') || lo.includes('fcl') || lo.includes('a')) {
                this._mouthTargets.push({ node, index: idx, influences: node.morphTargetInfluences });
              }
            }
          }
        }
        if (node.isBone) {
          const lo = node.name.toLowerCase();
          if (lo.includes('upperarm') || lo.includes('upper_arm') || lo.includes('shoulder')) {
            if (lo.includes('left')) this._armBones.left.push(node);
            if (lo.includes('right')) this._armBones.right.push(node);
          }
          if (lo.includes('lowerarm') || lo.includes('lower_arm') || lo.includes('forearm') || lo.includes('elbow')) {
            if (lo.includes('left')) this._armBones.left.push(node);
            if (lo.includes('right')) this._armBones.right.push(node);
          }
          if (lo.includes('hand') || lo.includes('wrist')) {
            if (lo.includes('left')) this._armBones.left.push(node);
            if (lo.includes('right')) this._armBones.right.push(node);
          }
        }
      });

      console.log('[avatar] bones L:', this._armBones.left.map(b=>b.name),
                  'R:', this._armBones.right.map(b=>b.name),
                  'mouth:', this._mouthTargets.length);

      if (this._armBones.left.length > 0 && this._armBones.right.length > 0) {
        this._poseArms();
      } else {
        this._tryPoseAllBones();
      }

      this._scene.add(this._model);
    }, undefined, () => {});

    this._animate();
    window.addEventListener('resize', () => this._onResize());
  }

  _poseArms() {
    const leftShoulder = this._armBones.left.find(b => b.name.toLowerCase().includes('upper') || b.name.toLowerCase().includes('shoulder'));
    const rightShoulder = this._armBones.right.find(b => b.name.toLowerCase().includes('upper') || b.name.toLowerCase().includes('shoulder'));
    const leftElbow = this._armBones.left.find(b => b.name.toLowerCase().includes('lower') || b.name.toLowerCase().includes('forearm'));
    const rightElbow = this._armBones.right.find(b => b.name.toLowerCase().includes('lower') || b.name.toLowerCase().includes('forearm'));

    if (leftShoulder) { leftShoulder.rotation.z = 0.35; leftShoulder.rotation.x = -0.15; }
    if (rightShoulder) { rightShoulder.rotation.z = -0.35; rightShoulder.rotation.x = -0.15; }
    if (leftElbow) { leftElbow.rotation.x = -0.5; leftElbow.rotation.z = -0.1; }
    if (rightElbow) { rightElbow.rotation.x = -0.5; rightElbow.rotation.z = 0.1; }
  }

  _tryPoseAllBones() {
    this._model.traverse((node) => {
      if (!node.isBone) return;
      const n = node.name.toLowerCase();
      if ((n.includes('upper') || n.includes('shoulder')) && n.includes('arm')) {
        if (n.includes('left')) { node.rotation.z = 0.35; node.rotation.x = -0.15; }
        if (n.includes('right')) { node.rotation.z = -0.35; node.rotation.x = -0.15; }
      }
      if ((n.includes('lower') || n.includes('fore') || n.includes('elbow')) && n.includes('arm')) {
        if (n.includes('left')) { node.rotation.x = -0.5; node.rotation.z = -0.1; }
        if (n.includes('right')) { node.rotation.x = -0.5; node.rotation.z = 0.1; }
      }
    });
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    this._renderer.render(this._scene, this._camera);
    if (this._isTalking) {
      const t = performance.now() * 0.001;
      const v = 0.2 + Math.sin(t * 8) * 0.3 + Math.sin(t * 13) * 0.2 + Math.sin(t * 17) * 0.2;
      const val = Math.max(0, Math.min(1, v));
      for (const mt of this._mouthTargets) mt.influences[mt.index] = val;
    } else {
      for (const mt of this._mouthTargets) mt.influences[mt.index] = 0;
    }
  }

  startTalking() { this._isTalking = true; }
  stopTalking() { this._isTalking = false; }

  toggle() {
    this._visible = !this._visible;
    this._container.style.display = this._visible ? 'block' : 'none';
  }

  _onResize() {
    const w = this._container.clientWidth || window.innerWidth / 2;
    const h = this._container.clientHeight || window.innerHeight - 60;
    if (w && h) {
      this._renderer.setSize(w, h);
      this._camera.aspect = w / h;
      this._camera.updateProjectionMatrix();
    }
  }
}

let _instance = null;

function getAvatar() {
  if (!_instance) {
    const c = document.getElementById('avatar-box');
    if (!c) return null;
    _instance = new TeacherAvatar(c);
    document.getElementById('avatar-toggle')?.addEventListener('click', () => _instance.toggle());
  }
  return _instance;
}

window.ScholarAvatar = { getAvatar };
