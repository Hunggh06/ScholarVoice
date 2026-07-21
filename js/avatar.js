/**
 * ScholarVoice Avatar — 3D anime teacher with idle animation + lip-sync.
 * Uses Three.js + VRM loader via CDN.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const AVATAR_URL = '1347496417698417678.vrm';

class TeacherAvatar {
  constructor(container) {
    this._container = container;
    this._canvas = document.getElementById('avatar-canvas');
    this._scene = null;
    this._camera = null;
    this._renderer = null;
    this._model = null;
    this._mixer = null;
    this._isTalking = false;
    this._visible = true;
    this._clock = new THREE.Clock();
    this._mouthBones = [];
    this._jawBone = null;

    this._init();
  }

  _init() {
    const w = this._container.clientWidth || 400;
    const h = Math.max(300, w * 1.2);

    this._renderer = new THREE.WebGLRenderer({ canvas: this._canvas, alpha: true, antialias: true });
    this._renderer.setSize(w, h);
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.shadowMap.enabled = true;

    this._scene = new THREE.Scene();

    this._camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 100);
    this._camera.position.set(0, 1.2, 6);
    this._camera.lookAt(0, 1, 0);

    // Lighting
    this._scene.add(new THREE.AmbientLight(0xffffff, 1.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.5);
    key.position.set(2, 5, 3);
    this._scene.add(key);
    const rim = new THREE.DirectionalLight(0xccddff, 1.2);
    rim.position.set(-2, 2, -3);
    this._scene.add(rim);

    // Ground shadow
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 8),
      new THREE.ShadowMaterial({ opacity: 0.15 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.5;
    ground.receiveShadow = true;
    this._scene.add(ground);

    // Load VRM model
    const loader = new GLTFLoader();
    loader.load(AVATAR_URL, (gltf) => {
      this._model = gltf.scene;
      this._model.position.set(0, -1.2, 0);
      this._model.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = true;
        }
        if (node.isBone && (node.name.toLowerCase().includes('jaw') || node.name.toLowerCase().includes('mouth'))) {
          this._mouthBones.push(node);
          if (!this._jawBone) this._jawBone = node;
        }
      });
      this._scene.add(this._model);

      // Animations
      if (gltf.animations?.length) {
        this._mixer = new THREE.AnimationMixer(this._model);
        gltf.animations.forEach(clip => this._mixer.clipAction(clip).play());
      }

      // Morph targets for mouth
      this._findMorphTargets();
      console.log('[avatar] Model loaded ✓');
    }, undefined, (err) => {
      console.warn('[avatar] Model load failed:', err.message);
    });

    this._animate();
    window.addEventListener('resize', () => this._onResize());
  }

  _findMorphTargets() {
    this._morphTargets = {};
    this._model.traverse((node) => {
      if (node.isMesh && node.morphTargetDictionary && node.morphTargetInfluences) {
        const dict = node.morphTargetDictionary;
        const infl = node.morphTargetInfluences;
        for (const [name, idx] of Object.entries(dict)) {
          const lower = name.toLowerCase();
          if (lower.includes('mouth') || lower.includes('jaw') || lower.includes('aa') || lower.includes('ih') || lower.includes('ou') || lower.includes('ee') || lower.includes('oh') || lower.includes('a') && idx < 2) {
            this._morphTargets[name] = { node, index: idx, influences: infl };
          }
        }
      }
    });
    console.log('[avatar] Mouth morph targets:', Object.keys(this._morphTargets).length);
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    const dt = Math.min(this._clock.getDelta(), 0.1);
    if (this._mixer) this._mixer.update(dt);

    // Idle: gentle sway + breathe
    if (this._model) {
      const t = performance.now() * 0.001;
      this._model.rotation.y += dt * 0.15; // slow spin
      if (!this._isTalking) {
        this._model.position.y = -1.2 + Math.sin(t * 1.5) * 0.03;
      }
    }

    // Talking: mouth animation
    if (this._isTalking) {
      this._animateMouth(performance.now());
    } else {
      this._resetMouth();
    }

    if (this._renderer && this._camera) {
      this._renderer.render(this._scene, this._camera);
    }
  }

  _animateMouth(now) {
    const v = 0.3 + Math.sin(now * 0.015) * 0.3 + Math.sin(now * 0.023) * 0.2 + Math.sin(now * 0.037) * 0.2;
    const val = Math.max(0, Math.min(1, v));
    for (const [, mt] of Object.entries(this._morphTargets)) {
      mt.influences[mt.index] = val * (0.3 + Math.random() * 0.7);
    }
    if (this._jawBone) {
      this._jawBone.rotation.x = val * 0.15;
    }
  }

  _resetMouth() {
    for (const [, mt] of Object.entries(this._morphTargets)) {
      mt.influences[mt.index] = 0;
    }
    if (this._jawBone) {
      this._jawBone.rotation.x = 0;
    }
  }

  startTalking() { this._isTalking = true; }
  stopTalking() { this._isTalking = false; }

  toggle() {
    this._visible = !this._visible;
    this._container.style.display = this._visible ? 'block' : 'none';
  }

  _onResize() {
    const w = this._container.clientWidth || 400;
    const h = Math.max(300, w * 1.2);
    this._renderer.setSize(w, h);
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
  }
}

// Singleton
let _instance = null;

export function getAvatar() {
  if (!_instance) {
    const container = document.getElementById('avatar-container');
    if (!container) return null;
    _instance = new TeacherAvatar(container);

    document.getElementById('avatar-toggle')?.addEventListener('click', () => {
      _instance.toggle();
    });
  }
  return _instance;
}

export { TeacherAvatar };
