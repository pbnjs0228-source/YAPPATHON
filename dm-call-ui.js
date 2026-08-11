(() => {
  'use strict';

  const C = () => window.YappathonVoiceContext || {};
  const $ = id => document.getElementById(id);
  let timer = null;
  let inviteUnsub = null;
  let currentCallKey = '';
  const ringing = new Set();

  function convo() {
    const c = C();
    if (c.currentConvoType === 'channel' && c.currentChannel) {
      return { type: 'channel', id: c.currentChannel, name: '#' + c.currentChannel, members: [] };
    }
    if (c.currentConvoType === 'dm' && c.currentDmId) {
      const d = c.dmCache?.[c.currentDmId];
      if (!d) return null;
      return {
        type: d.type === 'group' ? 'group' : 'dm',
        id: c.currentDmId,
        name: d.name || null,
        members: Array.isArray(d.members) ? d.members : []
      };
    }
    return null;
  }

  function callId(c) {
    return (c.type === 'channel' ? 'channel_' : 'call_') + c.id;
  }

  function isVoiceActive() {
    const panel = $('voice-panel');
    return !!panel && !panel.hidden;
  }

  function injectStyle() {
    if ($('yappathon-call-stage-style')) return;
    const s = document.createElement('style');
    s.id = 'yappathon-call-stage-style';
    s.textContent = `
      /* The floating call widget is now only the internal controller.
         All calls are displayed in the in-app stage. */
      #voice-panel { display:none !important; }
      .voice-dm-stage { position:absolute; left:0; right:0; top:56px; height:300px; z-index:20; background:linear-gradient(180deg,var(--bg-alt),var(--bg)); border-bottom:1px solid var(--border); box-shadow:0 16px 45px rgba(0,0,0,.18); display:flex; flex-direction:column; overflow:hidden; }
      .voice-dm-stage[hidden] { display:none !important; }
      .voice-dm-stage-head { display:flex; align-items:center; gap:10px; padding:11px 16px; border-bottom:1px solid var(--border); background:var(--bg-alt); flex:0 0 auto; }
      .voice-dm-live { width:8px; height:8px; border-radius:50%; background:var(--online); box-shadow:0 0 12px var(--online); }
      .voice-dm-title { font-weight:800; font-size:13px; }
      .voice-dm-sub { font-size:11px; color:var(--text-muted); margin-left:auto; }
      .voice-dm-grid { flex:1; min-height:0; display:grid; grid-template-columns:repeat(auto-fit,minmax(145px,1fr)); gap:10px; padding:12px 16px; overflow:auto; }
      .voice-dm-tile { position:relative; min-height:125px; border:1px solid var(--border); border-radius:14px; background:var(--bg-elevated); display:flex; align-items:center; justify-content:center; overflow:hidden; box-shadow:0 8px 28px rgba(0,0,0,.12); }
      .voice-dm-tile.me { border-color:var(--accent); box-shadow:0 0 0 1px var(--accent-soft),0 8px 28px rgba(0,0,0,.14); }
      .voice-dm-tile.ringing { border-color:var(--accent); animation: yvRingPulse 1.2s ease-in-out infinite; }
      @keyframes yvRingPulse { 0%,100%{box-shadow:0 0 0 0 var(--accent-soft)} 50%{box-shadow:0 0 0 5px var(--accent-soft)} }
      .voice-dm-avatar { width:62px; height:62px; border-radius:50%; object-fit:cover; background:var(--accent); display:grid; place-items:center; color:#fff; font-weight:800; font-size:20px; }
      .voice-dm-label { position:absolute; left:8px; bottom:8px; right:8px; display:flex; align-items:center; gap:6px; padding:5px 7px; border-radius:7px; background:rgba(0,0,0,.48); color:#fff; font-size:11px; font-weight:700; backdrop-filter:blur(5px); }
      .voice-dm-status { margin-left:auto; color:#8ff0bd; font-size:10px; white-space:nowrap; }
      .voice-dm-status.ringing { color:#ffd27a; }
      .voice-dm-controls { display:flex; align-items:center; justify-content:center; gap:8px; padding:9px 14px; border-top:1px solid var(--border); background:var(--bg-alt); flex:0 0 auto; }
      .voice-dm-control { width:40px; height:36px; border:1px solid var(--border); border-radius:10px; background:var(--bg-input); color:var(--text); font-size:15px; cursor:pointer; }
      .voice-dm-control:hover { border-color:var(--accent); background:var(--accent-soft); }
      .voice-dm-control.leave { width:auto; padding:0 15px; background:var(--danger); border-color:var(--danger); color:#fff; font-size:12px; font-weight:800; }
      .main.voice-dm-active .messages { padding-top:314px; }
      @media(max-width:860px){.voice-dm-stage{top:52px;height:270px}.main.voice-dm-active .messages{padding-top:284px}.voice-dm-grid{grid-template-columns:repeat(auto-fit,minmax(120px,1fr));padding:9px}.voice-dm-tile{min-height:105px}.voice-dm-avatar{width:52px;height:52px;font-size:16px}.voice-dm-sub{display:none}}
      @media(max-width:600px){.voice-dm-stage{height:245px}.main.voice-dm-active .messages{padding-top:258px}.voice-dm-grid{gap:6px;padding:7px}.voice-dm-tile{min-height:88px;border-radius:10px}.voice-dm-avatar{width:44px;height:44px}.voice-dm-controls{padding:7px}}
    `;
    document.head.appendChild(s);
  }

  function ensureStage() {
    const main = document.querySelector('.main');
    if (!main) return null;
    let stage = $('voice-dm-stage');
    if (stage) return stage;
    stage = document.createElement('section');
    stage.id = 'voice-dm-stage';
    stage.className = 'voice-dm-stage';
    stage.hidden = true;
    stage.innerHTML = `
      <div class="voice-dm-stage-head">
        <span class="voice-dm-live"></span>
        <div class="voice-dm-title" id="voice-dm-title">Voice call</div>
        <div class="voice-dm-sub" id="voice-dm-sub">Voice Connected</div>
      </div>
      <div class="voice-dm-grid" id="voice-dm-grid"></div>
      <div class="voice-dm-controls">
        <button class="voice-dm-control" id="voice-dm-mute" title="Mute microphone">🎙</button>
        <button class="voice-dm-control" id="voice-dm-deafen" title="Toggle speaker">🔊</button>
        <button class="voice-dm-control leave" id="voice-dm-leave">Leave Call</button>
      </div>`;
    main.appendChild(stage);
    $('voice-dm-mute').onclick = () => $('voice-mute')?.click();
    $('voice-dm-leave').onclick = () => $('voice-leave')?.click();
    $('voice-dm-deafen').onclick = () => {
      document.querySelectorAll('audio[data-yv]').forEach(a => { a.muted = !a.muted; });
      $('voice-dm-deafen').textContent = document.querySelector('audio[data-yv][muted]') ? '🔇' : '🔊';
    };
    return stage;
  }

  function usersFor(c) {
    const me = C().currentUser?.uid;
    if (c.type === 'channel') return [];
    return c.members.filter(x => x !== me).map(uid => C().userCache?.[uid] || { uid, username: 'Member' });
  }

  function connectedNames() {
    const source = $('voice-people');
    const set = new Set();
    if (!source) return set;
    source.querySelectorAll('.voice-person strong').forEach(x => set.add(x.textContent.trim().toLowerCase()));
    return set;
  }

  function avatar(user) {
    if (user?.photoBase64) {
      const img = document.createElement('img');
      img.className = 'voice-dm-avatar';
      img.src = user.photoBase64;
      img.alt = '';
      return img;
    }
    const div = document.createElement('div');
    div.className = 'voice-dm-avatar';
    div.textContent = (user?.username || user?.name || '?').trim().split(/\s+/).map(x => x[0]).join('').slice(0,2).toUpperCase();
    return div;
  }

  function tile(user, status, me = false) {
    const t = document.createElement('div');
    t.className = 'voice-dm-tile' + (me ? ' me' : '') + (status === 'ringing' ? ' ringing' : '');
    t.appendChild(avatar(user));
    const label = document.createElement('div');
    label.className = 'voice-dm-label';
    const name = document.createElement('span');
    name.textContent = me ? ((C().profile?.username) || 'You') : (user?.username || user?.name || 'Member');
    const state = document.createElement('span');
    state.className = 'voice-dm-status' + (status === 'ringing' ? ' ringing' : '');
    state.textContent = status === 'ringing' ? '🔔 Ringing' : status === 'connected' ? 'Connected' : 'Waiting';
    label.append(name, state);
    t.appendChild(label);
    return t;
  }

  async function watchInvites(c) {
    const db = C().db;
    const uid = C().currentUser?.uid;
    if (!db || !uid || c.type === 'channel') return;
    const key = callId(c);
    if (key === currentCallKey && inviteUnsub) return;
    if (inviteUnsub) { inviteUnsub(); inviteUnsub = null; }
    currentCallKey = key;
    try {
      const { collection, onSnapshot } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      inviteUnsub = onSnapshot(collection(db, 'voiceCalls', key, 'invites'), snap => {
        ringing.clear();
        snap.forEach(d => {
          const x = d.data();
          if (x.status === 'ringing') ringing.add(d.id);
        });
        render();
      }, () => {});
    } catch (_) {}
  }

  function render() {
    const stage = $('voice-dm-stage');
    const c = convo();
    if (!stage || !c || !isVoiceActive()) return;
    const grid = $('voice-dm-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const me = C().currentUser?.uid;
    const connected = connectedNames();
    const selfName = (C().profile?.username || 'You').toLowerCase();
    grid.appendChild(tile({ username: C().profile?.username || 'You', photoBase64: C().profile?.photoBase64 }, 'connected', true));

    if (c.type === 'channel') {
      const source = $('voice-people');
      if (source) source.querySelectorAll('.voice-person').forEach(p => {
        const name = p.querySelector('strong')?.textContent?.trim();
        if (name && name.toLowerCase() !== selfName) grid.appendChild(tile({ username: name }, 'connected'));
      });
    } else {
      usersFor(c).forEach(user => {
        const name = (user.username || user.name || '').toLowerCase();
        const status = connected.has(name) ? 'connected' : (ringing.has(user.uid) ? 'ringing' : 'waiting');
        grid.appendChild(tile(user, status));
      });
    }

    const title = $('voice-dm-title');
    const sub = $('voice-dm-sub');
    if (title) title.textContent = c.type === 'channel' ? `${c.name} Voice` : c.type === 'group' ? (c.name || 'Group Voice') : 'Voice Call';
    if (sub) sub.textContent = c.type === 'channel' ? 'Everyone can join' : 'Voice Connected';
  }

  function update() {
    injectStyle();
    const stage = ensureStage();
    const c = convo();
    if (!stage) return;
    const show = !!c && isVoiceActive();
    stage.hidden = !show;
    document.querySelector('.main')?.classList.toggle('voice-dm-active', show);
    if (!show) {
      if (inviteUnsub) { inviteUnsub(); inviteUnsub = null; }
      currentCallKey = '';
      ringing.clear();
      return;
    }
    watchInvites(c);
    render();
  }

  function start() {
    if (timer) return;
    update();
    timer = setInterval(update, 500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();