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
        if (node.isMesh && node.morphTargetDictionary && node.morphTargetInfluences) {
          for (const [name, idx] of Object.entries(node.morphTargetDictionary)) {
            const lo = name.toLowerCase();
            if (lo.includes('mouth') || lo.includes('aa') || lo.includes('jaw') ||
                lo.includes('open') || lo.includes('fcl') || lo.includes('a')) {
              this._mouthTargets.push({ node, index: idx, influences: node.morphTargetInfluences });
            }
          }
        }
        if (node.isBone) {
          // VRM humanoid bones: joint_LeftArm, joint_RightArm, joint_LeftElbow, joint_RightElbow, etc.
          const n = node.name;
          if (n === 'joint_LeftArm') { node.rotation.z = 0.45; node.rotation.x = -0.2; }
          if (n === 'joint_RightArm') { node.rotation.z = -0.45; node.rotation.x = -0.2; }
          if (n === 'joint_LeftElbow') { node.rotation.x = -0.6; }
          if (n === 'joint_RightElbow') { node.rotation.x = -0.6; }
          // Also try generic patterns for other VRM models
          const lo = n.toLowerCase();
          if (lo.includes('left') && lo.includes('arm') && !lo.includes('twist') && !lo.includes('elbow') && !lo.includes('wrist')) {
            if (!node.rotation.z) { node.rotation.z = 0.45; node.rotation.x = -0.2; }
          }
          if (lo.includes('right') && lo.includes('arm') && !lo.includes('twist') && !lo.includes('elbow') && !lo.includes('wrist')) {
            if (!node.rotation.z) { node.rotation.z = -0.45; node.rotation.x = -0.2; }
          }
          if ((lo.includes('elbow') || lo.includes('lowerarm') || lo.includes('forearm')) && lo.includes('arm')) {
            if (lo.includes('left')) node.rotation.x = -0.6;
            if (lo.includes('right')) node.rotation.x = -0.6;
          }
        }
      });
      this._scene.add(this._model);
      console.log('[avatar] ready, mouth:', this._mouthTargets.length);
    }, undefined, () => {});

    this._animate();
    window.addEventListener('resize', () => this._onResize());
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
