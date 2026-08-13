(() => {
  'use strict';
  const C=()=>window.YappathonVoiceContext||{};
  const FIREBASE='https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
  let fs=null,profileUnsub=null,profileUnsubUid='',callLogUnsub=null,incomingCallUnsub=null,inviteUnsubs=new Map(),started=false;
  const loadedProfiles=new Map(),callLogs=new Map();
  async function firestore(){if(!fs)fs=await import(FIREBASE);return fs}
  function current(){return C().currentUser||null} function profile(){return C().profile||{}}
  function msgPath(d){return d.kind==='channel'?['channels',d.contextId,'messages']:['dms',d.contextId,'messages']}
  function durationText(ms){const s=Math.max(0,Math.round(ms/1000));if(s<60)return `${s} second${s===1?'':'s'}`;const m=Math.floor(s/60);if(m<60)return `${m} minute${m===1?'':'s'}`;const h=Math.floor(m/60);return `${h} hour${h===1?'':'s'}`}
  function ms(v){return v?.toMillis?.()||0}

  async function syncUserHistory(uid,username,photoBase64){
    const c=C();if(!c.db||!uid)return;
    try{const{collectionGroup,query,where,getDocs,writeBatch}=await firestore();const snap=await getDocs(query(collectionGroup(c.db,'messages'),where('uid','==',uid)));let batch=writeBatch(c.db),n=0;for(const d of snap.docs){const old=d.data()||{},changes={};if(old.username!==username)changes.username=username;const p=photoBase64||null;if((old.photoBase64||null)!==p)changes.photoBase64=p;if(!Object.keys(changes).length)continue;batch.update(d.ref,changes);n++;if(n>=400){await batch.commit();batch=writeBatch(c.db);n=0}}if(n)await batch.commit()}catch(e){console.warn('YAPPATHON profile history sync failed:',e)}}

  // Only the signed-in user's own profile doc is watched: the collection-group
  // rules only allow a user to update messages they authored, so watching
  // everyone's profile just produced silent permission-denied writes for
  // other people's changes.
  function watchProfiles(){
    const c=C(),uid=current()?.uid;if(!c.db||!uid)return;
    if(profileUnsub&&profileUnsubUid===uid)return;
    if(profileUnsub){profileUnsub();profileUnsub=null}
    profileUnsubUid=uid;
    firestore().then(({doc,onSnapshot})=>{
      let first=true;
      profileUnsub=onSnapshot(doc(c.db,'users',uid),snap=>{
        const p=snap.data()||{},key=JSON.stringify({username:p.username||'',photoBase64:p.photoBase64||null});
        if(first){first=false;loadedProfiles.set(uid,key);return}
        const old=loadedProfiles.get(uid);loadedProfiles.set(uid,key);
        if(old!==undefined&&old!==key)syncUserHistory(uid,p.username||'Someone',p.photoBase64||null);
      },()=>{});
    }).catch(e=>console.warn('Profile listener failed',e))
  }

  function incomingUi(){let el=document.getElementById('yap-incoming-call');if(el)return el;const s=document.createElement('style');s.textContent=`#yap-incoming-call{position:fixed;inset:0;z-index:20000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.58);backdrop-filter:blur(8px)}#yap-incoming-call[hidden]{display:none!important}.yap-in-card{width:min(430px,calc(100vw - 32px));padding:26px;border:1px solid var(--border);border-radius:20px;background:var(--bg-alt);box-shadow:0 25px 90px rgba(0,0,0,.45);text-align:center}.yap-in-icon{width:70px;height:70px;margin:0 auto 12px;border-radius:50%;display:grid;place-items:center;background:var(--accent-soft);font-size:32px;animation:yapRingIncoming 1s ease-in-out infinite}.yap-in-card h2{margin:8px 0}.yap-in-card p{color:var(--text-muted);margin:0}.yap-in-actions{display:flex;justify-content:center;gap:10px;margin-top:22px}.yap-in-actions button{border:0;border-radius:10px;padding:10px 18px;font-weight:800;cursor:pointer}.yap-in-decline{background:var(--danger);color:#fff}.yap-in-accept{background:var(--accent);color:var(--accent-contrast)}@keyframes yapRingIncoming{0%,100%{transform:scale(1);box-shadow:0 0 0 0 rgba(255,255,255,.08)}50%{transform:scale(1.08);box-shadow:0 0 0 12px rgba(255,255,255,.05)}}`;document.head.appendChild(s);el=document.createElement('div');el.id='yap-incoming-call';el.hidden=true;el.innerHTML='<div class="yap-in-card"><div class="yap-in-icon">📞</div><h2 id="yap-in-name">Incoming call</h2><p id="yap-in-text">Someone is calling you</p><div class="yap-in-actions"><button class="yap-in-decline">Decline</button><button class="yap-in-accept">Accept</button></div></div>';document.body.appendChild(el);return el}
  async function respond(callId,uid,status){try{const{doc,updateDoc,serverTimestamp}=await firestore();await updateDoc(doc(C().db,'voiceCalls',callId,'invites',uid),{status,respondedAt:serverTimestamp()});return true}catch(e){console.warn('Call response failed',e);return false}}
  function showIncoming(callId,call,inv){const uid=current()?.uid;if(!uid||uid!==inv.uid||call.createdBy===uid||inv.status!=='ringing')return;const t=inv.createdAt?.toMillis?.()||0;if(!t||Date.now()-t>30000)return;const el=incomingUi(),u=(C().userCache||{})[call.createdBy]||{};document.getElementById('yap-in-name').textContent=`${u.username||'Someone'} is calling you`;document.getElementById('yap-in-text').textContent=call.kind==='group'?(call.name||'Group call'):'Incoming voice call';el.hidden=false;
    el.querySelector('.yap-in-accept').onclick=async()=>{
      el.querySelector('.yap-in-accept').disabled=true;
      const ok=await respond(callId,uid,'accepted');
      el.hidden=true;el.querySelector('.yap-in-accept').disabled=false;
      if(ok&&window.YappathonVoice){
        const ctx={type:call.kind,id:call.contextId,name:call.name,members:call.members||[]};
        await window.YappathonVoice.join(callId,ctx);
      }
    };
    el.querySelector('.yap-in-decline').onclick=async()=>{await respond(callId,uid,'declined');el.hidden=true};
  }
  function watchOneInvite(callId,call){const uid=current()?.uid;if(!uid||call.createdBy===uid||inviteUnsubs.has(callId))return;firestore().then(({doc,onSnapshot})=>{const unsub=onSnapshot(doc(C().db,'voiceCalls',callId,'invites',uid),s=>{if(!s.exists()){return}const inv=s.data()||{};if(inv.status==='ringing')showIncoming(callId,call,{...inv,uid});else{const el=document.getElementById('yap-incoming-call');if(el)el.hidden=true}},()=>{});inviteUnsubs.set(callId,unsub)}).catch(()=>{})}
  function watchIncomingCalls(){const c=C(),uid=current()?.uid;if(!c.db||!uid)return;firestore().then(({collection,onSnapshot})=>{incomingCallUnsub=onSnapshot(collection(c.db,'voiceCalls'),snap=>{snap.docChanges().forEach(ch=>{const d=ch.doc.data()||{},k=ch.doc.id;if(d.active===true&&Array.isArray(d.members)&&d.members.includes(uid))watchOneInvite(k,d);else if(d.active!==true){const u=inviteUnsubs.get(k);if(u){u();inviteUnsubs.delete(k)}}})})}).catch(e=>console.warn('Incoming calls listener failed',e))}


  async function ensureCallLog(callId,d){const c=C(),uid=current()?.uid;if(!c.db||!uid||d.createdBy!==uid||callLogs.has(callId))return;try{const{doc,setDoc,serverTimestamp}=await firestore();const p=msgPath(d),ref=doc(c.db,...p,'call_'+callId),username=profile().username||'Someone';await setDoc(ref,{uid,username,role:profile().role||'member',photoBase64:profile().photoBase64||null,text:`${username} started a call`,imageBase64:null,mentions:[],timestamp:serverTimestamp(),callLog:true,callId},{merge:true});callLogs.set(callId,{ref,startedAt:ms(d.createdAt)||Date.now(),username})}catch(e){console.warn('Call log start failed',e)}}
  async function finishCallLog(callId,d){const st=callLogs.get(callId);if(!st)return;callLogs.delete(callId);try{const{updateDoc}=await firestore();const end=ms(d.endedAt)||ms(d.updatedAt)||Date.now();await updateDoc(st.ref,{text:`${st.username} started a call for ${durationText(Math.max(0,end-st.startedAt))}`})}catch(e){console.warn('Call log finish failed',e)}}
  function watchCallLogs(){const c=C(),uid=current()?.uid;if(!c.db||!uid)return;firestore().then(({collection,query,where,onSnapshot})=>{callLogUnsub=onSnapshot(query(collection(c.db,'voiceCalls'),where('createdBy','==',uid)),snap=>snap.docChanges().forEach(ch=>{const d=ch.doc.data()||{};if(d.active===true)ensureCallLog(ch.doc.id,d);else finishCallLog(ch.doc.id,d)}))}).catch(e=>console.warn('Call log listener failed',e))}
  function reset(){const uid=current()?.uid||'';if(uid===reset.uid)return;reset.uid=uid;if(profileUnsub){profileUnsub();profileUnsub=null;profileUnsubUid=''}if(callLogUnsub){callLogUnsub();callLogUnsub=null}if(incomingCallUnsub){incomingCallUnsub();incomingCallUnsub=null}inviteUnsubs.forEach(u=>u());inviteUnsubs.clear();loadedProfiles.clear();callLogs.clear();if(uid){watchProfiles();watchCallLogs();watchIncomingCalls()}}
  function start(){if(started)return;started=true;reset();setInterval(reset,1000)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
