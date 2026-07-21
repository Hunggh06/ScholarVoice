import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

console.log('[avatar] THREE r' + THREE.REVISION);

const VRM_BONE_NAMES = {
  leftUpperArm: 'joint_LeftArm',
  rightUpperArm: 'joint_RightArm',
  leftLowerArm: 'joint_LeftElbow',
  rightLowerArm: 'joint_RightElbow',
};

class TeacherAvatar {
  constructor(container) {
    this._c = container;
    this._cv = document.getElementById('avatar-canvas');
    this._s = new THREE.Scene();
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

    const loader = new GLTFLoader();
    loader.load('1347496417698417678.vrm', gltf => {
      const model = gltf.scene;
      model.position.set(0, -0.8, 0);
      model.scale.set(1.2, 1.2, 1.2);

      // Find bones by name
      const boneMap = {};
      model.traverse(n => {
        if (n.isBone && n.name) boneMap[n.name] = n;
      });

      console.log('[avatar] bones found:', Object.keys(boneMap).filter(k => k.includes('Arm') || k.includes('Elbow')));

      // Pose arms using known bone names
      const la = boneMap[VRM_BONE_NAMES.leftUpperArm];
      const ra = boneMap[VRM_BONE_NAMES.rightUpperArm];
      const le = boneMap[VRM_BONE_NAMES.leftLowerArm];
      const re = boneMap[VRM_BONE_NAMES.rightLowerArm];

      if (la) { la.rotation.set(-0.2, -0.1, 0.5); console.log('[avatar] posed leftUpperArm'); }
      if (ra) { ra.rotation.set(-0.2, 0.1, -0.5); console.log('[avatar] posed rightUpperArm'); }
      if (le) { le.rotation.set(-0.5, 0, 0); console.log('[avatar] posed leftLowerArm'); }
      if (re) { re.rotation.set(-0.5, 0, 0); console.log('[avatar] posed rightLowerArm'); }

      // Fallback: try generic names
      if (!la && !ra) {
        console.log('[avatar] falling back to generic bone search...');
        model.traverse(n => {
          if (!n.isBone) return;
          const nm = n.name.toLowerCase();
          if (nm.includes('arm') && nm.includes('left') && !nm.includes('twist') && !nm.includes('elbow')) {
            n.rotation.set(-0.2, -0.1, 0.5);
          }
          if (nm.includes('arm') && nm.includes('right') && !nm.includes('twist') && !nm.includes('elbow')) {
            n.rotation.set(-0.2, 0.1, -0.5);
          }
          if ((nm.includes('elbow') || nm.includes('lowerarm')) && nm.includes('left')) {
            n.rotation.set(-0.5, 0, 0);
          }
          if ((nm.includes('elbow') || nm.includes('lowerarm')) && nm.includes('right')) {
            n.rotation.set(-0.5, 0, 0);
          }
        });
      }

      // Mouth morph targets
      this._mouth = [];
      model.traverse(n => {
        if (n.isMesh && n.morphTargetDictionary && n.morphTargetInfluences) {
          for (const [name, idx] of Object.entries(n.morphTargetDictionary)) {
            const lo = name.toLowerCase();
            if (lo.startsWith('fcl_mth_a') || lo.includes('aa')) {
              this._mouth.push({ node: n, index: idx, infl: n.morphTargetInfluences });
            }
          }
        }
      });
      console.log('[avatar] mouth targets:', this._mouth.length);

      this._s.add(model);
    }, p => {
      if (p.total) console.log('[avatar]', Math.round(p.loaded / p.total * 100) + '%');
    }, e => console.error('[avatar] err:', e));

    this._loop();
    addEventListener('resize', () => this._rs());
  }

  _loop() {
    requestAnimationFrame(() => this._loop());
    this._r.render(this._s, this._cam);
    if (this._mouth?.length && this._isTalking) {
      const t = performance.now() * 0.001;
      const v = 0.3 + Math.sin(t * 8) * 0.3 + Math.sin(t * 13) * 0.2;
      const val = Math.max(0, Math.min(1, v));
      for (const m of this._mouth) m.infl[m.index] = val;
    } else if (this._mouth) {
      for (const m of this._mouth) m.infl[m.index] = 0;
    }
  }

  startTalking() { this._isTalking = true; }
  stopTalking() { this._isTalking = false; }
  toggle() { this._c.style.display = this._c.style.display === 'none' ? 'block' : 'none'; }
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
