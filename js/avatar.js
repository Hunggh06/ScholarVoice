import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

class TeacherAvatar {
  constructor(container) {
    this._c = container;
    this._cv = document.getElementById('avatar-canvas');
    this._s = new THREE.Scene();
    this._vrm = null;
    this._isTalking = false;
    this._init();
  }

  _init() {
    const w = this._c.clientWidth || 280;
    const h = this._c.clientHeight || 500;

    this._r = new THREE.WebGLRenderer({ canvas: this._cv, alpha: true, antialias: true });
    this._r.setSize(w, h);
    this._r.setPixelRatio(Math.min(devicePixelRatio, 2));
    this._r.outputColorSpace = THREE.SRGBColorSpace;
    this._r.setClearColor(0, 0);

    this._cam = new THREE.PerspectiveCamera(25, w / h, 0.1, 50);
    this._cam.position.set(0, 1.3, 4);
    this._cam.lookAt(0, 0.9, 0);

    this._s.add(new THREE.AmbientLight(0xffffff, 2));
    const dl = new THREE.DirectionalLight(0xffffff, 4);
    dl.position.set(1, 3, 3);
    this._s.add(dl);
    const fl = new THREE.DirectionalLight(0xccddff, 2);
    fl.position.set(-1, 1.5, -1);
    this._s.add(fl);

    const loader = new GLTFLoader();
    loader.register(parser => new VRMLoaderPlugin(parser, { autoUpdateHumanBones: true }));

    loader.load('1347496417698417678.vrm',
      gltf => {
        this._vrm = gltf.userData.vrm;
        if (!this._vrm) { console.warn('[avatar] no VRM data'); return; }
        VRMUtils.removeUnnecessaryJoints(this._vrm.scene);
        this._s.add(this._vrm.scene);
        this._vrm.scene.position.set(0, -0.05, 0);

        if (this._vrm.lookAt) {
          this._vrm.lookAt.target = new THREE.Object3D();
          this._vrm.lookAt.target.position.set(0, 1.5, 10);
        }
        console.log('[avatar] VRM loaded ✓');
      },
      p => { if (p.total) console.log('[avatar]', Math.round(p.loaded/p.total*100)+'%'); },
      e => console.warn('[avatar] err:', e.message)
    );

    this._loop();
    addEventListener('resize', () => this._rs());
  }

  _loop() {
    requestAnimationFrame(() => this._loop());
    const dt = 0.016;
    if (this._vrm) {
      this._vrm.update(dt);
      if (this._isTalking && this._vrm.expressionController) {
        const t = performance.now() * 0.001;
        const v = 0.3 + Math.sin(t*8)*0.3 + Math.sin(t*13)*0.2 + Math.sin(t*17)*0.2;
        this._vrm.expressionController.setValue('aa', Math.max(0, v));
        this._vrm.expressionController.setValue('ih', Math.max(0, v*0.5));
        this._vrm.expressionController.setValue('ou', Math.max(0, v*0.3));
      } else if (this._vrm?.expressionController) {
        this._vrm.expressionController.setValue('aa', 0);
        this._vrm.expressionController.setValue('ih', 0);
        this._vrm.expressionController.setValue('ou', 0);
      }
    }
    this._r.render(this._s, this._cam);
  }

  startTalking() { this._isTalking = true; }
  stopTalking() { this._isTalking = false; }

  toggle() {
    this._c.style.display = this._c.style.display === 'none' ? 'block' : 'none';
  }

  _rs() {
    const w = this._c.clientWidth || 280;
    const h = this._c.clientHeight || 500;
    this._r.setSize(w, h);
    this._cam.aspect = w / h;
    this._cam.updateProjectionMatrix();
  }
}

let _inst;
function getAvatar() {
  if (!_inst) {
    const c = document.getElementById('avatar-box');
    if (!c) return null;
    _inst = new TeacherAvatar(c);
    document.getElementById('avatar-toggle')?.addEventListener('click', () => _inst.toggle());
  }
  return _inst;
}
window.ScholarAvatar = { getAvatar };
