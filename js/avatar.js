import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

class TeacherAvatar {
  constructor(container) {
    this._c = container;
    this._cv = document.getElementById('avatar-canvas');
    this._s = new THREE.Scene();
    this._isTalking = false;
    this._mouth = [];
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

    this._s.add(new THREE.AmbientLight(0xffffff, 2.5));
    const dl = new THREE.DirectionalLight(0xffffff, 5);
    dl.position.set(1, 4, 4);
    this._s.add(dl);
    const fl = new THREE.DirectionalLight(0xaaccff, 2);
    fl.position.set(-1, 1, -1);
    this._s.add(fl);

    const loader = new GLTFLoader();
    loader.load('1347496417698417678.vrm', gltf => {
      const model = gltf.scene;
      model.position.set(0, -0.7, 0);
      model.scale.set(1.2, 1.2, 1.2);
      model.rotation.y = Math.PI; // face camera

      // Collect ALL bones and ALL morph targets
      const bones = {};
      model.traverse(n => {
        // VRM bones often stored as regular Object3D, not THREE.Bone
        if (n.name && n.name.startsWith('joint_')) {
          bones[n.name] = n;
        }
        // Mouth morphs — search ALL names
        if (n.isMesh && n.morphTargetDictionary && n.morphTargetInfluences) {
          for (const [name, idx] of Object.entries(n.morphTargetDictionary)) {
            const lo = name.toLowerCase();
            if (lo.includes('mouth') || lo.includes('mth') || lo.includes('jaw') || lo.includes('aa') || lo.includes('ih') || lo.includes('ou') || lo.includes('ee') || lo.includes('oh') || lo.includes('blink')) {
              this._mouth.push({ node: n, index: idx, infl: n.morphTargetInfluences });
            }
          }
        }
      });

      console.log('[avatar] arm bones:', Object.keys(bones).filter(k => k.includes('Arm') || k.includes('Elbow')));
      console.log('[avatar] mouth targets:', this._mouth.length);

      // Pose: rotate upper arms down
      const la = bones['joint_LeftArm'];
      const ra = bones['joint_RightArm'];
      const le = bones['joint_LeftElbow'];
      const re = bones['joint_RightElbow'];

      if (la) la.rotation.set(-0.2, 0, 0.5);
      if (ra) ra.rotation.set(-0.2, 0, -0.5);
      if (le) le.rotation.set(-0.5, 0, 0);
      if (re) re.rotation.set(-0.5, 0, 0);

      console.log('[avatar] posed:', !!la, !!ra, !!le, !!re);

      this._s.add(model);
    }, p => {
      if (p.total) console.log('[avatar]', Math.round(p.loaded / p.total * 100) + '%');
    }, e => console.error('[avatar] err:', e));

    this._loop();
    addEventListener('resize', () => this._rs());
  }

  _loop() {
    requestAnimationFrame(() => this._loop());
    if (this._mouth.length && this._isTalking) {
      const t = performance.now() * 0.001;
      const v = 0.3 + Math.sin(t * 8) * 0.3 + Math.sin(t * 13) * 0.2;
      const val = Math.max(0, Math.min(1, v));
      for (const m of this._mouth) m.infl[m.index] = val;
    } else if (this._mouth.length) {
      for (const m of this._mouth) m.infl[m.index] = 0;
    }
    this._r.render(this._s, this._cam);
  }

  startTalking() { this._isTalking = true; }
  stopTalking() { this._isTalking = false; }
  toggle() { this._c.style.display = this._c.style.display === 'none' ? 'block' : 'none'; }
  _rs() {
    const w = this._c.clientWidth || 280, h = this._c.clientHeight || 500;
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
