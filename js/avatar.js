import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

class TeacherAvatar {
  constructor(c) {
    this._c=c; this._cv=document.getElementById('avatar-canvas');
    this._s=new THREE.Scene(); this._isTalking=false; this._mouth=[];
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

    new GLTFLoader().load('1347496417698417678.vrm',gltf=>{
      const m=gltf.scene;
      m.position.set(0,-0.1,0); m.scale.set(0.7,0.7,0.7);
      m.rotation.y=Math.PI;

      const qL=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),0.6);
      const qR=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),-0.6);
      const qElbow=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-0.5);

      m.traverse(n=>{
        if(!n.isBone)return;
        const nm=n.name;
        if(nm.includes('Left')&&nm.includes('Arm')&&!nm.includes('Elbow')&&!nm.includes('Shoulder')){
          n.quaternion.multiply(qL); n.updateMatrixWorld();
        }
        if(nm.includes('Right')&&nm.includes('Arm')&&!nm.includes('Elbow')&&!nm.includes('Shoulder')){
          n.quaternion.multiply(qR); n.updateMatrixWorld();
        }
        if(nm.includes('Elbow')){
          n.quaternion.multiply(qElbow); n.updateMatrixWorld();
        }
        if(n.isMesh&&n.morphTargetDictionary)for(const[k,i]of Object.entries(n.morphTargetDictionary)){
          const lo=k.toLowerCase();if(lo.includes('mth')||lo.includes('aa'))this._mouth.push({node:n,index:i,infl:n.morphTargetInfluences});
        }
      });
      console.log('[avatar] mouth:',this._mouth.length);
      this._s.add(m);
    },p=>{if(p.total)console.log('[avatar]',Math.round(p.loaded/p.total*100)+'%')},e=>console.error('[avatar]',e));
    this._loop(); addEventListener('resize',()=>this._rs());
  }
  _loop(){
    requestAnimationFrame(()=>this._loop());
    if(this._mouth.length&&this._isTalking){const t=performance.now()*0.001,v=0.3+Math.sin(t*8)*0.3+Math.sin(t*13)*0.2,val=Math.max(0,Math.min(1,v));for(const m of this._mouth)m.infl[m.index]=val}else if(this._mouth.length)for(const m of this._mouth)m.infl[m.index]=0;
    this._r.render(this._s,this._cam);
  }
  startTalking(){this._isTalking=true} stopTalking(){this._isTalking=false}
  toggle(){this._c.style.display=this._c.style.display==='none'?'block':'none'}
  _rs(){const w=this._c.clientWidth||280,h=this._c.clientHeight||500;this._r.setSize(w,h);this._cam.aspect=w/h;this._cam.updateProjectionMatrix()}
}
let _inst;function getAvatar(){if(!_inst){const c=document.getElementById('avatar-box');if(!c)return null;_inst=new TeacherAvatar(c);document.getElementById('avatar-toggle')?.addEventListener('click',()=>_inst.toggle())}return _inst}
window.ScholarAvatar={getAvatar};
