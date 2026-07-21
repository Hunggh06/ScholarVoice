import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const AVATAR_URL = '1347496417698417678.vrm';

class TeacherAvatar {
  constructor(container) {
    this._container = container;
    this._canvas = document.getElementById('avatar-canvas');
    this._scene = null;
    this._camera = null;
    this._renderer = null;
    this._vrm = null;
    this._isTalking = false;
    this._visible = true;
    this._clock = new THREE.Clock();
    this._blinkTimer = 0;
    this._init();
  }

  _init() {
    const w = this._container.clientWidth || 240;
    const h = this._container.clientHeight || 300;
    this._renderer = new THREE.WebGLRenderer({
      canvas: this._canvas, alpha: true, antialias: true
    });
    this._renderer.setSize(w, h);
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.outputColorSpace = THREE.SRGBColorSpace;
    this._renderer.toneMapping = THREE.ACESFilmicToneMapping;

    this._scene = new THREE.Scene();
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
    loader.register(parser => new VRMLoaderPlugin(parser, { autoUpdateHumanBones: true }));

    loader.load(AVATAR_URL,
      (gltf) => {
        this._vrm = gltf.userData.vrm;
        if (this._vrm) {
          VRMUtils.removeUnnecessaryJoints(this._vrm.scene);
          this._scene.add(this._vrm.scene);
          this._vrm.scene.position.set(0, -0.05, 0);
          if (this._vrm.lookAt) {
            this._vrm.lookAt.target = new THREE.Object3D();
            this._vrm.lookAt.target.position.set(0, 1.5, 5);
            this._scene.add(this._vrm.lookAt.target);
          }
          console.log('[avatar] VRM loaded');
        }
      },
      undefined,
      (err) => console.warn('[avatar] Load failed:', err.message)
    );

    this._animate();
    window.addEventListener('resize', () => this._onResize());
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    const dt = Math.min(this._clock.getDelta(), 0.1);
    if (this._vrm) {
      this._vrm.update(dt);
      this._blinkTimer += dt;
      if (this._blinkTimer > 3 + Math.random() * 2 && this._vrm.expressionController) {
        this._blinkTimer = 0;
        this._vrm.expressionController.setValue('blink', 1);
        setTimeout(() => {
          if (this._vrm?.expressionController) this._vrm.expressionController.setValue('blink', 0);
        }, 120);
      }
      if (this._isTalking) {
        this._animateTalking();
      } else if (this._vrm.expressionController) {
        this._vrm.expressionController.setValue('aa', 0);
        this._vrm.expressionController.setValue('ih', 0);
        this._vrm.expressionController.setValue('ou', 0);
      }
    }
    this._renderer.render(this._scene, this._camera);
  }

  _animateTalking() {
    if (!this._vrm?.expressionController) return;
    const t = performance.now() * 0.001;
    const v1 = 0.3 + Math.sin(t * 8) * 0.3 + Math.sin(t * 13) * 0.2;
    const v2 = 0.2 + Math.sin(t * 11 + 1) * 0.3 + Math.cos(t * 15) * 0.2;
    this._vrm.expressionController.setValue('aa', Math.max(0, v1));
    this._vrm.expressionController.setValue('ih', Math.max(0, v2 * 0.5));
    this._vrm.expressionController.setValue('ou', Math.max(0, v1 * 0.3));
  }

  startTalking() { this._isTalking = true; }
  stopTalking() { this._isTalking = false; }

  toggle() {
    this._visible = !this._visible;
    this._container.style.display = this._visible ? 'block' : 'none';
  }

  _onResize() {
    const w = this._container.clientWidth || 240;
    const h = this._container.clientHeight || 300;
    this._renderer.setSize(w, h);
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
  }
}

let _instance = null;

export function getAvatar() {
  if (!_instance) {
    const container = document.getElementById('avatar-float');
    if (!container) return null;
    _instance = new TeacherAvatar(container);
    document.getElementById('avatar-toggle')?.addEventListener('click', () => {
      _instance.toggle();
    });
  }
  return _instance;
}
