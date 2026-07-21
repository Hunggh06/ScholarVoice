import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';

class TeacherAvatar {
  constructor(c) {
    this._c=c; this._cv=document.getElementById('avatar-canvas');
    this._s=new THREE.Scene(); this._vrm=null; this._isTalking=false;
    this._init();
  }
  _init(){
    const w=this._c.clientWidth||280, h=this._c.clientHeight||500;
    this._r=new THREE.WebGLRenderer({canvas:this._cv,alpha:true,antialias:true});
    this._r.setSize(w,h); this._r.setPixelRatio(Math.min(devicePixelRatio,2));
    this._r.outputColorSpace=THREE.SRGBColorSpace; this._r.setClearColor(0,0);
    this._cam=new THREE.PerspectiveCamera(35,w/h,0.1,50);
    this._cam.position.set(0,1.3,3); this._cam.lookAt(0,0.8,0);
    this._s.add(new THREE.AmbientLight(0xffffff,2.5));
    const dl=new THREE.DirectionalLight(0xffffff,5);
    dl.position.set(1,4,3); this._s.add(dl);

    const loader=new GLTFLoader();
    loader.register(parser=>new VRMLoaderPlugin(parser));

    loader.load('1347496417698417678.vrm',
      gltf=>{
        this._vrm=gltf.userData.vrm;
        console.log('[avatar] VRM loaded, meta:',this._vrm?.meta?.title);
        if(this._vrm){
          this._vrm.scene.position.set(0,-0.5,0);
          this._vrm.scene.scale.set(0.8,0.8,0.8);
          this._s.add(this._vrm.scene);
        }
      },
      p=>{if(p.total)console.log('[avatar]',Math.round(p.loaded/p.total*100)+'%')},
      e=>console.error('[avatar]',e)
    );

    this._loop(); addEventListener('resize',()=>this._rs());
  }
  _loop(){
    requestAnimationFrame(()=>this._loop());
    if(this._vrm){ this._vrm.update(0.016);
      if(this._isTalking&&this._vrm.expressionController){
        const t=performance.now()*0.001,v=0.3+Math.sin(t*8)*0.3+Math.sin(t*13)*0.2;
        this._vrm.expressionController.setValue('aa',Math.max(0,v));
        this._vrm.expressionController.setValue('ih',Math.max(0,v*0.5));
      } else if(this._vrm.expressionController){
        this._vrm.expressionController.setValue('aa',0);
        this._vrm.expressionController.setValue('ih',0);
      }
    }
    this._r.render(this._s,this._cam);
  }
  startTalking(){this._isTalking=true} stopTalking(){this._isTalking=false}
  toggle(){this._c.style.display=this._c.style.display==='none'?'block':'none'}
  _rs(){const w=this._c.clientWidth||280,h=this._c.clientHeight||500;this._r.setSize(w,h);this._cam.aspect=w/h;this._cam.updateProjectionMatrix()}
}
let _inst;function getAvatar(){if(!_inst){const c=document.getElementById('avatar-box');if(!c)return null;_inst=new TeacherAvatar(c);document.getElementById('avatar-toggle')?.addEventListener('click',()=>_inst.toggle())}return _inst}
window.ScholarAvatar={getAvatar};
