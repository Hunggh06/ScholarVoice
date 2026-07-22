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
    this._resizeObserver = null;

    // Lip sync state
    this._hasBlendShapes = false;
    this._mouthMesh = null;
    this._mouthMorphIndex = -1;
    this._mouthMorphName = null;
    this._useExpressionManager = false;
    this._expressionName = null;
    this._jawBone = null;

    // Idle animation bones
    this._headBone = null;
    this._spineBone = null;

    // Gesture bones
    this._armBones = null;

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
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.6);
    fillLight.position.set(-1, 1, 1);
    this.scene.add(fillLight);

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

      try { VRMUtils.removeUnnecessaryVertices(gltf.scene); } catch (e) {}
      try { VRMUtils.combineSkeletons(gltf.scene); } catch (e) {}
      try { VRMUtils.combineMorphs(this.vrm); } catch (e) {}

      // Disable frustum culling for visibility
      this.vrm.scene.traverse(obj => { obj.frustumCulled = false; });

      this.scene.add(this.vrm.scene);
      this._discoverAll();
      this._calibrate();
      this._hideLoading();
      this._loaded = true;
      console.log('[Avatar3D] MODEL LOADED SUCCESSFULLY');
    } catch (err) {
      this._hideLoading();
      this._showError(err.message || 'Model khong tai duoc');
      console.error('[Avatar3D] LOAD FAILED:', err);
    }
  }

  _discoverAll() {
    console.log('[Avatar3D] === DISCOVERY START ===');
    this._discoverBones();
    this._discoverMorphTargets();
    console.log('[Avatar3D] === DISCOVERY END ===');
  }

  _discoverBones() {
    if (!this.vrm) return;

    // Try normalized names first (VRM 1.0 standard)
    const tryNormalized = (names) => {
      for (const n of names) {
        try {
          const node = this.vrm.humanoid.getNormalizedBoneNode(n);
          if (node) return node;
        } catch (e) {}
      }
      return null;
    };

    // Fallback: search all bones by pattern
    const tryPattern = (patterns) => {
      if (!this.vrm?.scene) return null;
      let found = null;
      this.vrm.scene.traverse(node => {
        if (!found && node.isBone) {
          for (const p of patterns) {
            if (p.test(node.name)) { found = node; break; }
          }
        }
      });
      return found;
    };

    // VRM standard normalized names + Japanese fallback patterns
    this._headBone =
      tryNormalized(['head', 'Head', 'neck', 'Neck']) ||
      tryPattern([/頭/, /head/i, /neck/i, /首/i]);

    this._spineBone =
      tryNormalized(['spine', 'Spine', 'chest', 'Chest', 'upperChest', 'UpperChest']) ||
      tryPattern([/spine/i, /chest/i, /上半身/, /下半身/i]);

    this._jawBone =
      tryNormalized(['jaw', 'Jaw']) ||
      tryPattern([/jaw/i, /あご/i, /Jaw_/]);

    const ua = tryNormalized(['rightUpperArm', 'RightUpperArm']) ||
               tryPattern([/右腕/, /upper.?arm.*r/i, /right.?upper/i, /Arm_R/i]);
    const la = tryNormalized(['rightLowerArm', 'RightLowerArm']) ||
               tryPattern([/右前腕/, /lower.?arm.*r/i, /right.?lower/i, /forearm.*r/i]);
    const ha = tryNormalized(['rightHand', 'RightHand']) ||
               tryPattern([/右手/, /hand.*r/i, /right.?hand/i, /Hand_R/i]);
    if (ua || la || ha) this._armBones = { upper: ua, lower: la, hand: ha };

    console.log('[Avatar3D] Bones:', {
      jaw: this._jawBone?.name || 'NONE',
      head: this._headBone?.name || 'NONE',
      spine: this._spineBone?.name || 'NONE',
      arm: this._armBones ? { upper: this._armBones.upper?.name, lower: this._armBones.lower?.name } : 'NONE'
    });
  }

  _discoverMorphTargets() {
    if (!this.vrm) return;
    const em = this.vrm.expressionManager;

    // Strategy 1: VRM 1.0 expression manager
    if (em && em.expressionNames && em.expressionNames.length > 0) {
      this._hasBlendShapes = true;
      this._useExpressionManager = true;
      const names = em.expressionNames;
      console.log('[Avatar3D] Expression manager found:', names.join(', '));

      // Find mouth expression (priority order)
      const mouthPatterns = ['aa', 'a', 'mouthOpen', 'jawOpen', 'A', 'あ', 'い', 'u', 'o', 'ih', 'ou', 'ee', 'oh'];
      for (const pattern of mouthPatterns) {
        const found = names.find(n => n.toLowerCase() === pattern.toLowerCase());
        if (found) {
          this._expressionName = found;
          console.log('[Avatar3D] Mouth expression:', found);
          break;
        }
      }
      if (!this._expressionName) {
        this._expressionName = names[0];
        console.log('[Avatar3D] Using first expression as mouth:', this._expressionName);
      }

      // Find blink expressions
      for (const name of names) {
        if (/blink/i.test(name)) {
          // stored for blink use
        }
      }
      return;
    }

    // Strategy 2: Direct morph target scan (VRM 0.0 or non-standard)
    console.log('[Avatar3D] No expression manager, scanning meshes...');
    let bestMorph = null;
    const mouthPatterns = [/mouth/i, /lip/i, /jaw/i, /\bA\b/, /\ba\b/, /\bI\b/, /\bi\b/, /\bU\b/, /\bu\b/, /\bE\b/, /\be\b/, /\bO\b/, /\bo\b/, /口/, /あ/];

    this.vrm.scene.traverse(obj => {
      if (obj.isMesh && obj.morphTargetInfluences && obj.morphTargetDictionary) {
        const dict = obj.morphTargetDictionary;
        for (const [name, idx] of Object.entries(dict)) {
          for (const p of mouthPatterns) {
            if (p.test(name)) {
              if (!bestMorph) {
                bestMorph = { mesh: obj, index: idx, name: name };
              }
              // Prefer explicit mouth names
              if (/mouth|lip|jaw/i.test(name)) {
                bestMorph = { mesh: obj, index: idx, name: name };
              }
            }
          }
        }
      }
    });

    if (bestMorph) {
      this._hasBlendShapes = true;
      this._useExpressionManager = false;
      this._mouthMesh = bestMorph.mesh;
      this._mouthMorphIndex = bestMorph.index;
      this._mouthMorphName = bestMorph.name;
      console.log('[Avatar3D] Direct morph target found:', bestMorph.name, 'at index', bestMorph.index);
    } else {
      console.log('[Avatar3D] NO morph targets found for lip sync');
    }
  }

  _calibrate() {
    if (!this.vrm?.scene) return;
    const box = new THREE.Box3().setFromObject(this.vrm.scene);
    const h = box.max.y - box.min.y;
    if (h <= 0) return;

    // Scale to fit nicely in container
    const targetHeight = 1.6;
    const scale = targetHeight / h;
    this.vrm.scene.scale.setScalar(scale);

    // Position feet at bottom
    const box2 = new THREE.Box3().setFromObject(this.vrm.scene);
    this.vrm.scene.position.set(0, -box2.min.y, 0);
    this.vrm.scene.rotation.y = 0;

    console.log('[Avatar3D] Calibrated: scale=' + scale.toFixed(3) + ' height=' + h.toFixed(2));
  }

  _animateIdle(dt) {
    this._idleTime += dt;
    const t = this._idleTime;

    // Body sway
    if (this.vrm?.scene) {
      this.vrm.scene.rotation.y = Math.sin(t * 1.2) * 0.04;
    }

    // Head movement
    if (this._headBone) {
      this._headBone.rotation.y = Math.sin(t * 0.8) * 0.1;
      this._headBone.rotation.x = Math.sin(t * 0.6 + 1) * 0.04;
    }

    // Subtle spine sway
    if (this._spineBone) {
      this._spineBone.rotation.y = Math.sin(t * 1.0) * 0.03;
    }
  }

  _animateMouth(dt) {
    const target = this._isSpeaking ? 0.6 : 0;
    const speed = Math.min(dt * 10, 1);

    // Method 1: Expression manager (VRM 1.0)
    if (this._useExpressionManager && this._expressionName && this.vrm) {
      const em = this.vrm.expressionManager;
      if (em) {
        try {
          const cur = em.getValue(this._expressionName) || 0;
          em.setValue(this._expressionName, cur + (target - cur) * speed);
        } catch (e) {}
        return;
      }
    }

    // Method 2: Direct morph target (VRM 0.0)
    if (this._mouthMesh && this._mouthMorphIndex >= 0) {
      const influences = this._mouthMesh.morphTargetInfluences;
      if (influences) {
        const cur = influences[this._mouthMorphIndex] || 0;
        influences[this._mouthMorphIndex] = cur + (target - cur) * speed;
        this._mouthMesh.morphTargetInfluences = influences;
        return;
      }
    }

    // Method 3: Jaw bone fallback
    if (this._jawBone) {
      const cur = this._jawBone.rotation.z || 0;
      this._jawBone.rotation.z = cur + ((this._isSpeaking ? 0.3 : 0) - cur) * speed;
      return;
    }

    // Method 4: Head bob fallback (subtle nod while speaking)
    if (this._headBone && this._isSpeaking) {
      this._headBone.rotation.x += Math.sin(this._idleTime * 15) * 0.005;
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
        if (a.upper) a.upper.rotation.x = -1.2 * ease;
        if (a.lower) a.lower.rotation.x = -0.4 * ease;
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
    if (a.upper) a.upper.rotation.set(0, 0, 0);
    if (a.lower) a.lower.rotation.set(0, 0, 0);
    if (a.hand) a.hand.rotation.set(0, 0, 0);
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
    const c = this.renderer?.domElement;
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
  }
}
