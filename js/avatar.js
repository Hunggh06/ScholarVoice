import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

class TeacherAvatar {
  constructor(container) {
    this._c = container;
    this._cv = document.getElementById('avatar-canvas');
    this._s = new THREE.Scene();
    this._isTalking = false;
    this._mouthTargets = [];
    this._init();
  }

  _init() {
    const w = this._c.clientWidth || 400;
    const h = this._c.clientHeight || 500;
    this._r = new THREE.WebGLRenderer({ canvas: this._cv, alpha: true, antialias: true });
    this._r.setSize(w, h);
    this._r.setPixelRatio(Math.min(devicePixelRatio, 2));
    this._r.outputColorSpace = THREE.SRGBColorSpace;
    this._r.setClearColor(0, 0);

    this._cam = new THREE.PerspectiveCamera(25, w / h, 0.1, 50);
    this._cam.position.set(0, 1.3, 4.5);
    this._cam.lookAt(0, 0.9, 0);

    // Debug: add a visible ground plane + test cube
    const g = new THREE.PlaneGeometry(20, 20);
    const gm = new THREE.MeshBasicMaterial({ color: 0x336699, side: THREE.DoubleSide, transparent: true, opacity: 0.2 });
    const ground = new THREE.Mesh(g, gm);
    ground.rotation.x = -Math.PI/2;
    ground.position.y = -2;
    this._s.add(ground);

    const box = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xff4444 })
    );
    box.position.set(0, 1, 0);
    this._s.add(box);
    this._testBox = box;

    this._s.add(new THREE.AmbientLight(0xffffff, 2));
    const dl = new THREE.DirectionalLight(0xffffff, 4);
    dl.position.set(1, 3, 3);
    this._s.add(dl);

    const loader = new GLTFLoader();
    loader.load('1347496417698417678.vrm', gltf => {
      if (this._testBox) { this._s.remove(this._testBox); this._testBox = null; }
      const m = gltf.scene;
      m.position.set(0, -0.8, 0);
      m.scale.set(1.2, 1.2, 1.2);
      m.traverse(n => {
        if (n.isBone) {
          if (n.name === 'joint_LeftArm') { n.rotation.z = 0.45; n.rotation.x = -0.2; }
          if (n.name === 'joint_RightArm') { n.rotation.z = -0.45; n.rotation.x = -0.2; }
          if (n.name === 'joint_LeftElbow') n.rotation.x = -0.6;
          if (n.name === 'joint_RightElbow') n.rotation.x = -0.6;
        }
        if (n.isMesh && n.morphTargetDictionary && n.morphTargetInfluences) {
          for (const [name, idx] of Object.entries(n.morphTargetDictionary)) {
            if (name.toLowerCase().includes('aa') || name.toLowerCase().includes('mouth') || name.toLowerCase().includes('jaw'))
              this._mouthTargets.push({ node: n, index: idx, infl: n.morphTargetInfluences });
          }
        }
      });
      this._s.add(m);
      this._model = m;
      console.log('[avatar] VRM loaded, mouth:', this._mouthTargets.length);
    }, p => {
      if (p.total) console.log('[avatar] loading:', Math.round(p.loaded/p.total*100)+'%');
    }, e => console.warn('[avatar] load err:', e.message));

    this._loop();
    addEventListener('resize', () => this._rs());
  }

  _loop() {
    requestAnimationFrame(() => this._loop());
    if (this._testBox) { this._testBox.rotation.y += 0.02; this._testBox.rotation.x += 0.01; }
    this._r.render(this._s, this._cam);
    if (this._isTalking) {
      const t = performance.now() * 0.001;
      const v = 0.2 + Math.sin(t*8)*0.3 + Math.sin(t*13)*0.2 + Math.sin(t*17)*0.2;
      const val = Math.max(0, Math.min(1, v));
      this._mouthTargets.forEach(mt => { mt.infl[mt.index] = val; });
    } else {
      this._mouthTargets.forEach(mt => { mt.infl[mt.index] = 0; });
    }
  }

  startTalking() { this._isTalking = true; }
  stopTalking() { this._isTalking = false; }

  toggle() {
    this._c.style.display = this._c.style.display === 'none' ? 'block' : 'none';
  }

  _rs() {
    const w = this._c.clientWidth || 400;
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
    if (!c) { console.warn('[avatar] #avatar-box not found'); return null; }
    _inst = new TeacherAvatar(c);
    document.getElementById('avatar-toggle')?.addEventListener('click', () => _inst.toggle());
    console.log('[avatar] init, size:', c.clientWidth, 'x', c.clientHeight);
  }
  return _inst;
}
window.ScholarAvatar = { getAvatar };
