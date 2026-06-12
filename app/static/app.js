let providers = {};

async function api(path, opts) {
  const r = await fetch(path, opts);
  if (r.status === 401) { location.href = '/login'; throw new Error('401'); }
  return r;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

// ---------------------------------------------------------------- аккаунт

function pickBalanceNumber(data) {
  if (data == null) return null;
  if (typeof data === 'number') return data;
  if (typeof data === 'object') {
    for (const k of ['balance', 'amount', 'value', 'credits']) {
      if (typeof data[k] === 'number') return data[k];
      if (data[k] && typeof data[k] === 'object') {
        const inner = pickBalanceNumber(data[k]);
        if (inner !== null) return inner;
      }
    }
  }
  return null;
}

function templateList(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const k of ['templates', 'items', 'data', 'results']) {
      if (Array.isArray(data[k])) return data[k];
    }
  }
  return [];
}

async function loadAccount() {
  const r = await api('/api/account');
  const acc = await r.json();

  // бейдж баланса Voicer
  const balEl = document.getElementById('badge-balance');
  if (acc.voicer.balance.ok) {
    const n = pickBalanceNumber(acc.voicer.balance.data);
    balEl.textContent = 'Voicer: ' + (n !== null ? n.toLocaleString('ru') + ' симв.' : 'ок');
    balEl.classList.add('ok');
  } else {
    balEl.textContent = 'Voicer: ошибка';
    balEl.classList.add('no');
    balEl.title = acc.voicer.balance.error || '';
  }

  // бейдж доступности видео по подписке fast-gen
  const vidEl = document.getElementById('badge-video');
  const vs = acc.fastgen.video_support;
  if (vs && vs.available === true) {
    vidEl.textContent = 'Видео: доступно'; vidEl.classList.add('ok');
  } else if (vs && vs.available === false) {
    vidEl.textContent = 'Видео: нет в подписке'; vidEl.classList.add('no');
  } else {
    vidEl.textContent = 'Видео: неизвестно';
    vidEl.title = 'Не удалось однозначно определить по API — смотри блок «Аккаунт и лимиты»';
  }

  // голоса
  const tplSel = document.getElementById('template-select');
  for (const t of templateList(acc.voicer.templates.ok ? acc.voicer.templates.data : null)) {
    const opt = document.createElement('option');
    opt.value = t.uuid || t.id || t.template_id || '';
    opt.textContent = t.name || t.title || opt.value;
    tplSel.appendChild(opt);
  }

  // провайдеры/модели картинок
  providers = acc.image_providers;
  const provSel = document.getElementById('provider-select');
  provSel.innerHTML = '';
  for (const [name, p] of Object.entries(providers)) {
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = p.label;
    provSel.appendChild(opt);
  }
  provSel.onchange = () => {
    const modSel = document.getElementById('model-select');
    modSel.innerHTML = '';
    const models = providers[provSel.value].models;
    if (!models.length) {
      modSel.appendChild(new Option('— одна модель —', ''));
    } else {
      for (const m of models) modSel.appendChild(new Option(m, m));
    }
  };
  provSel.onchange();

  const aspSel = document.getElementById('aspect-select');
  for (const a of acc.aspect_ratios) aspSel.appendChild(new Option(a, a));

  // подробный блок аккаунта
  const accEl = document.getElementById('account');
  const section = (title, payload) =>
    `<h3>${esc(title)}</h3><pre>${esc(payload.ok
      ? JSON.stringify(payload.data, null, 2) : 'Ошибка: ' + payload.error)}</pre>`;
  accEl.innerHTML =
    section('Voicer — баланс', acc.voicer.balance) +
    section('Voicer — шаблоны голосов', acc.voicer.templates) +
    section('fast-gen — использование и лимиты (/api/v5/usage)', acc.fastgen.usage) +
    section('fast-gen — модели (/api/v5/models)', acc.fastgen.models) +
    section('fast-gen — возможности (/api/v5/capabilities)', acc.fastgen.capabilities);
}

// ---------------------------------------------------------------- задачи

let pollTimer = null;

async function loadJobs() {
  const r = await api('/api/jobs');
  const { jobs } = await r.json();
  const el = document.getElementById('jobs');
  if (!jobs.length) { el.textContent = 'Пока нет задач.'; return; }
  el.innerHTML = jobs.map(j => `
    <div class="job">
      <div class="top">
        <span><b>#${esc(j.id)}</b> · сцен: ${j.scenes}</span>
        <span class="status-${esc(j.status)}">${
          j.status === 'running' ? '⏳ ' + esc(j.step)
          : j.status === 'done' ? '✅ Готово'
          : j.status === 'error' ? '❌ Ошибка'
          : '🕐 В очереди'}</span>
      </div>
      ${j.error ? `<div class="error">${esc(j.error)}</div>` : ''}
      ${j.output ? `<a class="dl" href="/api/jobs/${esc(j.id)}/video">⬇ Скачать MP4</a>` : ''}
      <details><summary>Журнал</summary><pre>${esc(j.log.join('\n'))}</pre></details>
    </div>`).join('');

  const active = jobs.some(j => j.status === 'running' || j.status === 'queued');
  clearTimeout(pollTimer);
  if (active) pollTimer = setTimeout(loadJobs, 3000);
}

document.getElementById('job-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('submit-btn');
  const errEl = document.getElementById('form-error');
  errEl.textContent = '';
  btn.disabled = true;
  try {
    const fd = new FormData(e.target);
    const r = await api('/api/jobs', { method: 'POST', body: fd });
    const data = await r.json();
    if (!r.ok) { errEl.textContent = data.error || 'Ошибка'; return; }
    e.target.reset();
    document.getElementById('provider-select').onchange();
    loadJobs();
  } catch (err) {
    errEl.textContent = 'Сетевая ошибка: ' + err;
  } finally {
    btn.disabled = false;
  }
});

loadAccount().catch(err => {
  document.getElementById('account').textContent = 'Не удалось загрузить данные аккаунта: ' + err;
});
loadJobs();
