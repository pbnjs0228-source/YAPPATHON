(() => {
  'use strict';

  const getContext = () => window.YappathonVoiceContext || {};
  const $ = id => document.getElementById(id);

  function isDmView() {
    const c = getContext();
    return c.currentConvoType === 'dm' && !!c.currentDmId;
  }

  function isVoiceActive() {
    const panel = $('voice-panel');
    return !!panel && !panel.hidden;
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
        <div class="voice-dm-title">Voice call</div>
        <div class="voice-dm-sub">Voice Connected</div>
      </div>
      <div class="voice-dm-grid" id="voice-dm-grid"></div>
      <div class="voice-dm-controls">
        <button class="voice-dm-control" id="dm-ui-mute" title="Mute microphone">🎙</button>
        <button class="voice-dm-control" id="dm-ui-deafen" title="Toggle speaker">🔊</button>
        <button class="voice-dm-control leave" id="dm-ui-leave">Leave Call</button>
      </div>`;
    main.appendChild(stage);

    $('dm-ui-mute')?.addEventListener('click', () => $('voice-mute')?.click());
    $('dm-ui-leave')?.addEventListener('click', () => $('voice-leave')?.click());
    $('dm-ui-deafen')?.addEventListener('click', () => {
      const b = $('voice-dm-deafen');
      if (b) b.click();
    });

    return stage;
  }

  function copyParticipants() {
    const source = $('voice-people');
    const target = $('voice-dm-grid');
    if (!source || !target) return;

    // voice.js may already render the Discord-style tiles here.
    if (target.children.length) return;

    [...source.children].forEach(person => {
      const tile = document.createElement('div');
      tile.className = 'voice-dm-tile';
      tile.innerHTML = `
        <div class="voice-dm-avatar">${person.querySelector('strong')?.textContent?.trim()?.charAt(0)?.toUpperCase() || '?'}</div>
        <div class="voice-dm-label">
          <span>${person.querySelector('strong')?.textContent || person.textContent || 'Member'}</span>
          <span class="voice-dm-status">Connected</span>
        </div>`;
      target.appendChild(tile);
    });
  }

  function update() {
    const panel = $('voice-panel');
    const stage = ensureStage();
    const main = document.querySelector('.main');
    if (!panel || !stage || !main) return;

    const show = isDmView() && isVoiceActive();

    if (show) {
      panel.hidden = true;
      stage.hidden = false;
      main.classList.add('voice-dm-active');

      const ctx = getContext();
      const dm = ctx.dmCache?.[ctx.currentDmId];
      const title = stage.querySelector('.voice-dm-title');
      if (title) title.textContent = dm?.type === 'group' ? (dm.name || 'Group voice') : 'Voice call';

      copyParticipants();
    } else {
      stage.hidden = true;
      main.classList.remove('voice-dm-active');
    }
  }

  function start() {
    update();
    setInterval(update, 250);
    new MutationObserver(update).observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class']});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, {once: true});
  } else {
    start();
  }
})();
