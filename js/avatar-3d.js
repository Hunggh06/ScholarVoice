import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

export class Avatar3D {
  constructor(containerEl) {
    this.container = containerEl;
    this.vrm = null;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.clock = new THREE.Clock();
    this._isSpeaking = false;
    this._idleTime = 0;
    this._blinkTimer = 0;
    this._blinkInterval = 2 + Math.random() * 3;
    this._gestureTimer = 0;
    this._gestureInterval = 8 + Math.random() * 4;
    this._gestureActive = false;
    this._gestureElapsed = 0;
    this._loaded = false;
    this._webglSupported = false;
    this._disposed = false;
    this._animFrameId = null;
    this._mouthName = null;
    this._blinkNames = [];
    this._hasBlendShapes = false;
    this._jawBone = null;
    this._armBones = null;
    this._headBone = null;
    this._spineBone = null;
    this._resizeObserver = null;
    this._initScene();
  }

  get webglSupported() { return this._webglSupported; }
  get isLoaded() { return this._loaded; }

  _initScene() {
    try {
      this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      this._webglSupported = true;
    } catch (e) {
      this._webglSupported = false;
      this._showError('Trinh duyet khong ho tro WebGL');
      return;
    }

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 2, 0.1, 20);
    this.camera.position.set(0, 1.0, 4.0);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
    dirLight.position.set(1, 2, 2);
    this.scene.add(dirLight);

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);

    this._resizeObserver = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        this.renderer.setSize(width, height);
        this.camera.aspect = width / Math.max(height, 1);
        this.camera.updateProjectionMatrix();
      }
    });
    this._resizeObserver.observe(this.container);

    const animate = () => {
      if (this._disposed) return;
      this._animFrameId = requestAnimationFrame(animate);
      const delta = this.clock.getDelta();
      if (this._loaded && this.vrm) {
        this._animateIdle(delta);
        this._animateMouth(delta);
        this._animateGesture(delta);
        this.vrm.update(delta);
      }
      if (this.renderer) this.renderer.render(this.scene, this.camera);
    };
    this._animFrameId = requestAnimationFrame(animate);
  }

  async loadModel(path) {
    if (!this._webglSupported) return;
    this._showLoading();
    try {
      const loader = new GLTFLoader();
      loader.register(parser => new VRMLoaderPlugin(parser));
      const gltf = await loader.loadAsync(path);
      this.vrm = gltf.userData.vrm;
      if (!this.vrm) throw new Error('File model khong hop le');

      VRMUtils.removeUnnecessaryVertices(gltf.scene);
      VRMUtils.combineSkeletons(gltf.scene);
      try { VRMUtils.combineMorphs(this.vrm); } catch (e) {}

      this.vrm.scene.traverse(obj => { obj.frustumCulled = false; });
      this.scene.add(this.vrm.scene);
      this._discoverBonesAndMorphs();
      this._calibrate();
      this._hideLoading();
      this._loaded = true;
    } catch (err) {
      this._hideLoading();
      this._showError(err.message || 'Model khong tai duoc');
      console.error('[Avatar3D]', err);
    }
  }

  _getBone(name) {
    if (!this.vrm || !this.vrm.humanoid) return null;
    try { return this.vrm.humanoid.getNormalizedBoneNode(name); } catch (e) { return null; }
  }

  _discoverBonesAndMorphs() {
    if (!this.vrm) return;
    const em = this.vrm.expressionManager;
    if (em) {
      const names = em.expressionNames || [];
      this._hasBlendShapes = names.length > 0;
      for (const name of names) {
        const lower = name.toLowerCase();
        if (/^(a|i|u|e|o|aa|ih|ou|ee|oh|mouthopen|jawopen)$/.test(lower) && !this._mouthName) {
          this._mouthName = name;
        }
        if (/blink/i.test(name)) this._blinkNames.push(name);
      }
      console.log('[Avatar3D] Blend shapes:', names.join(', '));
    }

    this._headBone = this._getBone('head') || this._getBone('neck');
    this._spineBone = this._getBone('spine') || this._getBone('chest') || this._getBone('upperChest');
    this._jawBone = this._getBone('jaw');
    const ua = this._getBone('rightUpperArm');
    const la = this._getBone('rightLowerArm');
    const ha = this._getBone('rightHand');
    if (ua || la || ha) this._armBones = { upper: ua, lower: la, hand: ha };

    console.log('[Avatar3D] Bones:', {
      jaw: this._jawBone ? this._jawBone.name : 'NONE',
      head: this._headBone ? this._headBone.name : 'NONE',
      spine: this._spineBone ? this._spineBone.name : 'NONE',
      arm: this._armBones ? 'OK' : 'NONE'
    });
  }

  _calibrate() {
    if (!this.vrm || !this.vrm.scene) return;
    const box = new THREE.Box3().setFromObject(this.vrm.scene);
    const h = box.max.y - box.min.y;
    if (h <= 0) return;
    const scale = Math.min(1.2, 1.5 / h);
    this.vrm.scene.scale.setScalar(scale);
    const box2 = new THREE.Box3().setFromObject(this.vrm.scene);
    this.vrm.scene.position.set(0, -box2.min.y - 0.02, 0);
    this.vrm.scene.rotation.y = 0;
  }

  _animateIdle(dt) {
    this._idleTime += dt;
    const t = this._idleTime;
    if (this._headBone) {
      this._headBone.rotation.y = Math.sin(t * 1.5) * 0.08;
      this._headBone.rotation.x = Math.sin(t * 0.9 + 2) * 0.03;
    }
    if (this.vrm && this.vrm.scene) {
      this.vrm.scene.rotation.y = Math.sin(t * 1.2) * 0.03;
    }
    this._blinkTimer += dt;
    if (this._blinkTimer >= this._blinkInterval) {
      this._blinkTimer = 0;
      this._blinkInterval = 2 + Math.random() * 3;
      this._doBlink();
    }
  }

  _doBlink() {
    if (!this.vrm || !this._hasBlendShapes || this._blinkNames.length === 0) return;
    const em = this.vrm.expressionManager;
    if (!em) return;
    const name = this._blinkNames[Math.floor(Math.random() * this._blinkNames.length)];
    try { em.setValue(name, 1); } catch (e) {}
    setTimeout(() => { try { em.setValue(name, 0); } catch (e) {} }, 150);
  }

  _animateMouth(dt) {
    const target = this._isSpeaking ? 0.5 : 0;
    const speed = Math.min(dt * 8, 1);
    if (this._mouthName && this.vrm) {
      const em = this.vrm.expressionManager;
      if (em) {
        try {
          const cur = em.getValue(this._mouthName) || 0;
          em.setValue(this._mouthName, cur + (target - cur) * speed);
        } catch (e) {}
        return;
      }
    }
    if (this._jawBone) {
      const cur = this._jawBone.rotation.z || 0;
      this._jawBone.rotation.z = cur + ((this._isSpeaking ? 0.3 : 0) - cur) * speed;
    }
  }

  _animateGesture(dt) {
    if (!this._isSpeaking || !this._armBones) {
      this._gestureTimer = 0;
      this._gestureActive = false;
      return;
    }
    this._gestureTimer += dt;
    if (this._gestureActive) {
      this._gestureElapsed += dt;
      const phase = this._gestureElapsed / 2.5;
      if (phase >= 1) {
        this._resetArm();
        this._gestureActive = false;
        this._gestureInterval = 8 + Math.random() * 4;
      } else {
        const ease = phase < 0.2 ? phase / 0.2 : phase > 0.8 ? (1 - phase) / 0.2 : 1;
        const a = this._armBones;
        if (a.upper) a.upper.rotation.x = -1.0 * ease;
        if (a.lower) a.lower.rotation.x = -0.3 * ease;
        if (a.hand) a.hand.rotation.z = -0.2 * ease;
      }
    } else if (this._gestureTimer >= this._gestureInterval) {
      this._gestureTimer = 0;
      this._gestureActive = true;
      this._gestureElapsed = 0;
    }
  }

  _resetArm() {
    const a = this._armBones;
    if (!a) return;
    if (a.upper) { a.upper.rotation.set(0, 0, 0); }
    if (a.lower) { a.lower.rotation.set(0, 0, 0); }
    if (a.hand) { a.hand.rotation.set(0, 0, 0); }
  }

  setSpeaking(v) {
    this._isSpeaking = !!v;
    if (!v) { this._gestureTimer = 0; this._gestureActive = false; this._resetArm(); }
  }

  _showLoading() {
    const el = document.getElementById('avatar-loading');
    if (el) { el.style.display = 'flex'; el.innerHTML = '<div class="avatar-spinner"></div>'; }
    const err = document.getElementById('avatar-error');
    if (err) err.style.display = 'none';
  }

  _hideLoading() {
    const el = document.getElementById('avatar-loading');
    if (el) el.style.display = 'none';
  }

  _showError(msg) {
    this._hideLoading();
    const el = document.getElementById('avatar-error');
    if (el) { el.style.display = 'flex'; el.textContent = '\u26a0\ufe0f ' + msg; }
    const c = this.renderer && this.renderer.domElement;
    if (c) c.style.display = 'none';
  }

  dispose() {
    this._disposed = true;
    if (this._animFrameId) { cancelAnimationFrame(this._animFrameId); this._animFrameId = null; }
    if (this._resizeObserver) { this._resizeObserver.disconnect(); this._resizeObserver = null; }
    if (this.renderer) { this.renderer.dispose(); this.renderer = null; }
    if (this.scene) {
      this.scene.traverse(c => {
        if (c.geometry) c.geometry.dispose();
        if (c.material) {
          if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
          else c.material.dispose();
        }
      });
      this.scene.clear();
      this.scene = null;
    }
    this.vrm = null;
    this._armBones = null;
    this._jawBone = null;
    this._headBone = null;
    this._spineBone = null;
  }
}
