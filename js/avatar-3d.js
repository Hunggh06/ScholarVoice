/**
 * Avatar3D - 3D VRM avatar lecturer module
 * Uses Three.js + @pixiv/three-vrm for model rendering and animation
 */
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
    this._animFrameId = null;
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

    // Morph target & bone references (discovered on load)
    this._morphMap = {};
    this._hasBlendShapes = false;
    this._jawBone = null;
    this._armBones = null;
    this._headBone = null;
    this._spineBone = null;
    this._mouthTarget = 0;

    // ResizeObserver for panel-divider
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
      this._showError('Trình duyệt không hỗ trợ WebGL');
      return;
    }

    this.scene = new THREE.Scene();
    this.scene.background = null;

    this.camera = new THREE.PerspectiveCamera(35, 2, 0.1, 100);
    this.camera.position.set(0, 1.0, 3.5);
    this.camera.lookAt(0, 0.9, 0);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight.position.set(1, 2, 2);
    this.scene.add(dirLight);
    const backLight = new THREE.DirectionalLight(0xffffff, 0.3);
    backLight.position.set(-0.5, 1, -1);
    this.scene.add(backLight);

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

    this._startAnimationLoop();
  }

  _startAnimationLoop() {
    const animate = () => {
      if (this._disposed) return;
      this._animFrameId = requestAnimationFrame(animate);
      const delta = Math.min(this.clock.getDelta(), 0.1);
      if (this._loaded) {
        this._animateIdle(delta);
        this._animateMouth(delta);
        this._animateGesture(delta);
        if (this.vrm) this.vrm.update(delta);
      }
      this.renderer.render(this.scene, this.camera);
    };
    this._animFrameId = requestAnimationFrame(animate);
  }

  async loadModel(path) {
    if (!this._webglSupported) return;

    this._showLoading();
    try {
      const loader = new GLTFLoader();
      loader.register(parser => new VRMLoaderPlugin(parser));

      const gltf = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Tải model quá lâu. Kiểm tra kết nối mạng.')), 30000);
        loader.load(path,
          result => { clearTimeout(timeout); resolve(result); },
          progress => {
            const pct = progress.total > 0 ? Math.round(progress.loaded / progress.total * 100) : 0;
            this._updateLoadingPct(pct);
          },
          err => { clearTimeout(timeout); reject(err); }
        );
      });

      this.vrm = gltf.userData.vrm;
      if (!this.vrm) throw new Error('File model không hợp lệ hoặc bị hỏng');

      try { VRMUtils.removeUnnecessaryVertices(gltf.scene); } catch (e) {}
      try { VRMUtils.combineSkeletons(gltf.scene); } catch (e) {}

      this.scene.add(this.vrm.scene);
      this._discoverBonesAndMorphs();
      this._calibratePosition();
      this._hideLoading();
      this._loaded = true;
    } catch (err) {
      this._hideLoading();
      if (err.message.includes('404') || err.message.includes('Not Found')) {
        this._showError('Không tìm thấy file model. Vui lòng tải từ VRoid Hub và đặt vào models/');
      } else {
        this._showError(err.message || 'Model không tải được');
      }
      throw err;
    }
  }

  _discoverBonesAndMorphs() {
    if (!this.vrm) return;

    const exprMgr = this.vrm.expressionManager;
    if (exprMgr) {
      this._hasBlendShapes = true;
      const exprNames = exprMgr.expressionNames || [];
      for (let i = 0; i < exprNames.length; i++) {
        this._morphMap[exprNames[i].toLowerCase()] = i;
      }
      // Map common mouth names
      for (const key of ['a', 'i', 'u', 'e', 'o', 'mouthopen', 'jawopen', 'aa', 'ih', 'ou', 'ee', 'oh']) {
        if (this._morphMap[key] !== undefined) {
          this._mouthTarget = this._morphMap[key];
          break;
        }
      }
    }

    // Bone discovery
    const humanoid = this.vrm.humanoid;
    if (humanoid) {
      const bones = humanoid.humanBones || {};
      const tryBone = (names) => {
        for (const n of names) {
          const bone = bones[n];
          if (bone && bone.node) return bone.node;
        }
        return null;
      };

      this._jawBone = tryBone(['jaw', 'Jaw']);
      this._headBone = tryBone(['head', 'Head', 'neck', 'Neck']);
      this._spineBone = tryBone(['spine', 'Spine', 'chest', 'Chest', 'upperChest', 'UpperChest']);

      const upperArm = tryBone(['rightUpperArm', 'RightUpperArm', 'upperArmR', 'UpperArmR']);
      const lowerArm = tryBone(['rightLowerArm', 'RightLowerArm', 'lowerArmR', 'LowerArmR']);
      const hand = tryBone(['rightHand', 'RightHand', 'handR', 'HandR']);
      if (upperArm || lowerArm || hand) {
        this._armBones = { upper: upperArm, lower: lowerArm, hand: hand };
      }
    }

    // Fallback: search scene for bones by name pattern
    if (!this._jawBone) this._jawBone = this._findBoneByPattern(/jaw/i);
    if (!this._armBones) {
      const upper = this._findBoneByPattern(/upper.?arm.*r/i) || this._findBoneByPattern(/right.?upper.?arm/i) || this._findBoneByPattern(/arm.*r/i);
      const lower = this._findBoneByPattern(/lower.?arm.*r/i) || this._findBoneByPattern(/right.?lower.?arm/i) || this._findBoneByPattern(/forearm.*r/i);
      const hand = this._findBoneByPattern(/hand.*r/i) || this._findBoneByPattern(/right.?hand/i);
      if (upper || lower || hand) this._armBones = { upper, lower, hand };
    }

    // Log bone map for debugging
    console.log('[Avatar3D] Bone map:', {
      jaw: this._jawBone ? this._jawBone.name : 'NOT FOUND',
      arm: this._armBones ? { upper: this._armBones.upper?.name, lower: this._armBones.lower?.name, hand: this._armBones.hand?.name } : 'NOT FOUND',
      head: this._headBone ? this._headBone.name : 'NOT FOUND',
      spine: this._spineBone ? this._spineBone.name : 'NOT FOUND',
    });
    console.log('[Avatar3D] Morph targets:', {
      hasBlendShapes: this._hasBlendShapes,
      mouthTarget: this._mouthTarget,
      names: Object.keys(this._morphMap).slice(0, 20),
    });
  }

  _findBoneByPattern(pattern) {
    if (!this.vrm || !this.vrm.scene) return null;
    let found = null;
    this.vrm.scene.traverse(node => {
      if (node.isBone && pattern.test(node.name)) {
        if (!found) found = node;
      }
    });
    return found;
  }

  _calibratePosition() {
    if (!this.vrm || !this.vrm.scene) return;
    const box = new THREE.Box3().setFromObject(this.vrm.scene);
    const size = new THREE.Vector3();
    box.getSize(size);
    const modelHeight = size.y;
    const scale = Math.min(1.2, 1.0 / Math.max(modelHeight, 0.5));
    this.vrm.scene.scale.setScalar(scale * 0.85);

    // Position so feet sit at bottom
    box.setFromObject(this.vrm.scene);
    const minY = box.min.y;
    this.vrm.scene.position.set(0, -minY - 0.05, 0);
    this.vrm.scene.rotation.y = 0;
  }

  _animateIdle(delta) {
    this._idleTime += delta;
    const t = this._idleTime;

    // Body sway (Y rotation)
    if (this._spineBone) {
      this._spineBone.rotation.y = Math.sin(t * 1.8) * 0.05;
    } else if (this.vrm && this.vrm.scene) {
      this.vrm.scene.rotation.y = Math.sin(t * 1.8) * 0.04;
    }

    // Head tilt (X rotation)
    if (this._headBone) {
      this._headBone.rotation.x = Math.sin(t * 1.2 + 2) * 0.03;
    }

    // Blink
    this._blinkTimer += delta;
    if (this._blinkTimer >= this._blinkInterval) {
      this._blinkTimer = 0;
      this._blinkInterval = 2 + Math.random() * 3;
      this._triggerBlink();
    }
  }

  _triggerBlink() {
    if (!this._hasBlendShapes || !this.vrm) return;
    const exprMgr = this.vrm.expressionManager;
    if (!exprMgr) return;
    const blinkIdx = this._morphMap['blink'] !== undefined ? this._morphMap['blink'] : this._morphMap['blink_l'] !== undefined ? this._morphMap['blink_l'] : this._morphMap['blink_r'];
    if (blinkIdx === undefined && exprMgr.expressionNames) {
      for (const name of exprMgr.expressionNames) {
        if (/blink/i.test(name)) {
          const idx = exprMgr.expressionNames.indexOf(name);
          exprMgr.setValue(name, 1);
          setTimeout(() => { try { exprMgr.setValue(name, 0); } catch (e) {} }, 120);
          return;
        }
      }
      return;
    }
    if (blinkIdx !== undefined) {
      exprMgr.setValue(exprMgr.expressionNames[blinkIdx], 1);
      setTimeout(() => {
        try { exprMgr.setValue(exprMgr.expressionNames[blinkIdx], 0); } catch (e) {}
      }, 120);
    }
  }

  _animateMouth(delta) {
    const targetValue = this._isSpeaking ? 0.45 : 0;
    if (this._hasBlendShapes && this.vrm && this._mouthTarget !== undefined) {
      const exprMgr = this.vrm.expressionManager;
      if (!exprMgr || !exprMgr.expressionNames) return;
      const name = exprMgr.expressionNames[this._mouthTarget];
      if (name) {
        const current = exprMgr.getValue(name) || 0;
        const next = current + (targetValue - current) * Math.min(delta * 8, 1);
        try { exprMgr.setValue(name, next); } catch (e) {}
      }
    } else if (this._jawBone) {
      const current = this._jawBone.rotation.z || 0;
      const jawTarget = this._isSpeaking ? 0.25 : 0;
      this._jawBone.rotation.z = current + (jawTarget - current) * Math.min(delta * 8, 1);
    }
  }

  _animateGesture(delta) {
    if (!this._isSpeaking || !this._armBones) {
      this._gestureTimer = 0;
      this._gestureActive = false;
      return;
    }
    this._gestureTimer += delta;
    if (this._gestureActive) {
      this._gestureElapsed += delta;
      const total = 2.5;
      const phase = this._gestureElapsed / total;
      if (phase >= 1) {
        this._resetArmPose();
        this._gestureActive = false;
        this._gestureInterval = 8 + Math.random() * 4;
      } else {
        const ease = phase < 0.2 ? phase / 0.2 : phase > 0.8 ? (1 - phase) / 0.2 : 1;
        const arm = this._armBones;
        if (arm.upper) arm.upper.rotation.z = -0.8 * ease;
        if (arm.lower) arm.lower.rotation.z = -0.3 * ease;
        if (arm.hand) arm.hand.rotation.x = -0.4 * ease;
      }
    } else if (this._gestureTimer >= this._gestureInterval) {
      this._gestureTimer = 0;
      this._gestureActive = true;
      this._gestureElapsed = 0;
    }
  }

  _resetArmPose() {
    const arm = this._armBones;
    if (!arm) return;
    if (arm.upper) arm.upper.rotation.z = 0;
    if (arm.lower) arm.lower.rotation.z = 0;
    if (arm.hand) arm.hand.rotation.x = 0;
  }

  setSpeaking(speaking) {
    this._isSpeaking = !!speaking;
    if (!speaking) {
      this._gestureTimer = 0;
      this._gestureActive = false;
      this._resetArmPose();
    }
  }

  _showLoading() {
    const el = document.getElementById('avatar-loading');
    if (el) {
      el.style.display = 'flex';
      el.innerHTML = '<div class="avatar-spinner"></div>';
    }
    const errEl = document.getElementById('avatar-error');
    if (errEl) errEl.style.display = 'none';
  }

  _updateLoadingPct(pct) {
    const el = document.getElementById('avatar-loading');
    if (el && el.querySelector('.avatar-spinner')) {
      el.querySelector('.avatar-spinner').textContent = pct + '%';
    }
  }

  _hideLoading() {
    const el = document.getElementById('avatar-loading');
    if (el) el.style.display = 'none';
  }

  _showError(msg) {
    this._hideLoading();
    const errEl = document.getElementById('avatar-error');
    if (errEl) {
      errEl.style.display = 'flex';
      errEl.textContent = '⚠️ ' + msg;
    }
    const canvas = this.renderer?.domElement;
    if (canvas) canvas.style.display = 'none';
  }

  dispose() {
    this._disposed = true;
    if (this._animFrameId) {
      cancelAnimationFrame(this._animFrameId);
      this._animFrameId = null;
    }
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
    if (this.scene) {
      this.scene.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
          } else {
            child.material.dispose();
          }
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
    this._morphMap = {};
  }
}
