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
    const w = this._container.clientWidth;
    const h = this._container.clientHeight;

    this._renderer = new THREE.WebGLRenderer({ canvas: this._canvas, alpha: true, antialias: true });
    this._renderer.setSize(w, h);
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.outputColorSpace = THREE.SRGBColorSpace;

    this._camera = new THREE.PerspectiveCamera(25, w / h, 0.1, 50);
    this._camera.position.set(0, 1.3, 4.5);
    this._camera.lookAt(0, 1.1, 0);

    this._scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 3);
    key.position.set(1, 2.5, 2);
    this._scene.add(key);
    const fill = new THREE.DirectionalLight(0xaaccff, 1.5);
    fill.position.set(-1, 1, -1);
    this._scene.add(fill);

    const loader = new GLTFLoader();
    loader.load(AVATAR_URL, (gltf) => {
      this._model = gltf.scene;
      this._model.position.set(0, -1.3, 0);
      this._model.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = true;
          if (node.morphTargetDictionary && node.morphTargetInfluences) {
            for (const [name, idx] of Object.entries(node.morphTargetDictionary)) {
              const lo = name.toLowerCase();
              if (lo.includes('mouth') || lo.includes('aa') || lo.includes('jaw') || lo.includes('open') || lo.includes('fcl')) {
                this._mouthTargets.push({ node, index: idx, influences: node.morphTargetInfluences });
              }
            }
          }
        }
        if (node.isBone) {
          const n = node.name.toLowerCase();
          if (n.includes('upperarm')) {
            if (n.includes('left')) { node.rotation.z = 0.5; node.rotation.x = -0.3; }
            if (n.includes('right')) { node.rotation.z = -0.5; node.rotation.x = -0.3; }
          }
          if (n.includes('lowerarm') || n.includes('forearm')) {
            if (n.includes('left')) node.rotation.x = -0.4;
            if (n.includes('right')) node.rotation.x = -0.4;
          }
        }
      });
      this._scene.add(this._model);
      console.log('[avatar] loaded, mouth:', this._mouthTargets.length);
    }, undefined, () => {});

    this._animate();
    window.addEventListener('resize', () => this._onResize());
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    this._renderer.render(this._scene, this._camera);
    if (this._isTalking) {
      const t = performance.now() * 0.001;
      const v = 0.3 + Math.sin(t * 8) * 0.3 + Math.sin(t * 13) * 0.2 + Math.sin(t * 17) * 0.2;
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
    const w = this._container.clientWidth;
    const h = this._container.clientHeight;
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
    const c = document.getElementById('avatar-float');
    if (!c) return null;
    _instance = new TeacherAvatar(c);
    document.getElementById('avatar-toggle')?.addEventListener('click', () => _instance.toggle());
  }
  return _instance;
}

window.ScholarAvatar = { getAvatar };
