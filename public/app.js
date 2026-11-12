const state = {
  cases: [],
  activeCaseId: null,
  messages: [],
  checklistProgress: [],
  timerSeconds: 480,
  timerInterval: null,
  timerRunning: false,
  autoTTS: false,
  aiConfig: {
    mode: 'offline',
    provider: 'gemini',
    apiKey: '',
    model: 'gemini-2.5-flash',
    baseUrl: 'https://api.openai.com/v1'
  }
};

// DOM Elements
const el = {
  caseList: document.getElementById('caseList'),
  checklistItems: document.getElementById('checklistItems'),
  checklistCount: document.getElementById('checklistCount'),
  checklistBody: document.getElementById('checklistBody'),
  toggleChecklistBtn: document.getElementById('toggleChecklistBtn'),
  modeStatusText: document.getElementById('modeStatusText'),
  patientAvatar: document.getElementById('patientAvatar'),
  patientName: document.getElementById('patientName'),
  patientDemographics: document.getElementById('patientDemographics'),
  patientOccupation: document.getElementById('patientOccupation'),
  patientPersonality: document.getElementById('patientPersonality'),
  chatStream: document.getElementById('chatStream'),
  chatInput: document.getElementById('chatInput'),
  sendBtn: document.getElementById('sendBtn'),
  micBtn: document.getElementById('micBtn'),
  ttsToggleBtn: document.getElementById('ttsToggleBtn'),
  timerDisplay: document.getElementById('timerDisplay'),
  timerToggleBtn: document.getElementById('timerToggleBtn'),
  timerResetBtn: document.getElementById('timerResetBtn'),
  resetChatBtn: document.getElementById('resetChatBtn'),
  finishExamBtn: document.getElementById('finishExamBtn'),
  newCaseBtn: document.getElementById('newCaseBtn'),
  openSettingsBtn: document.getElementById('openSettingsBtn'),
  saveSettingsBtn: document.getElementById('saveSettingsBtn'),
  aiModeSelect: document.getElementById('aiModeSelect'),
  aiConfigFields: document.getElementById('aiConfigFields'),
  aiProviderSelect: document.getElementById('aiProviderSelect'),
  aiApiKeyInput: document.getElementById('aiApiKeyInput'),
  aiModelInput: document.getElementById('aiModelInput'),
  aiBaseUrlInput: document.getElementById('aiBaseUrlInput'),
  openaiBaseUrlGroup: document.getElementById('openaiBaseUrlGroup'),
  saveCaseBtn: document.getElementById('saveCaseBtn'),
  addScriptRowBtn: document.getElementById('addScriptRowBtn'),
  addChecklistRowBtn: document.getElementById('addChecklistRowBtn'),
  scriptRowsContainer: document.getElementById('scriptRowsContainer'),
  checklistRowsContainer: document.getElementById('checklistRowsContainer'),
  submitEvalBtn: document.getElementById('submitEvalBtn')
};

function loadSettings() {
  try {
    const saved = localStorage.getItem('osce_ai_config');
    if (saved) {
      state.aiConfig = { ...state.aiConfig, ...JSON.parse(saved) };
    }
  } catch {}
  updateModeUI();
}

function updateModeUI() {
  const { mode, provider } = state.aiConfig;
  if (mode === 'ai') {
    el.modeStatusText.textContent = `AI Mode (${provider === 'openai' ? 'OpenAI' : 'Gemini'})`;
  } else {
    el.modeStatusText.textContent = 'Offline (ตามบท/คีย์เวิร์ด)';
  }
}

async function fetchCases() {
  const res = await fetch('/api/cases');
  const data = await res.json();
  state.cases = data.cases || [];
  renderCaseList();
  if (state.cases.length && !state.activeCaseId) {
    selectCase(state.cases[0].id);
  }
}

function getActiveCase() {
  return state.cases.find((c) => c.id === state.activeCaseId);
}

function renderCaseList() {
  el.caseList.innerHTML = '';
  state.cases.forEach((c) => {
    const card = document.createElement('div');
    card.className = `case-card ${c.id === state.activeCaseId ? 'active' : ''}`;
    card.innerHTML = `
      <div class="case-card-top">
        <div class="case-card-title">${escapeHtml(c.title)}</div>
        <div class="case-card-actions">
          <button class="btn-icon edit-case-btn" title="แก้ไขตัวละคร/บท">✏️</button>
          <button class="btn-icon delete-case-btn" title="ลบเคส">🗑️</button>
        </div>
      </div>
      <div class="case-card-sub">${escapeHtml(c.patient.name)} • ${c.patient.age} ปี (${escapeHtml(c.patient.gender)})</div>
    `;
    card.addEventListener('click', (e) => {
      if (e.target.closest('.edit-case-btn')) {
        e.stopPropagation();
        openCaseEditor(c);
        return;
      }
      if (e.target.closest('.delete-case-btn')) {
        e.stopPropagation();
        deleteCase(c.id);
        return;
      }
      selectCase(c.id);
    });
    el.caseList.appendChild(card);
  });
}

function selectCase(caseId) {
  state.activeCaseId = caseId;
  const c = getActiveCase();
  if (!c) return;

  renderCaseList();
  updatePatientHeader(c);

  resetSession();
}

function updatePatientHeader(c) {
  const avatarUrl = getPatientAvatarUrl(c);
  el.patientAvatar.innerHTML = `<img src="${avatarUrl}" alt="${escapeHtml(c.patient.name)}" />`;
  el.patientName.textContent = c.patient.name;
  el.patientDemographics.textContent = `${c.patient.gender} • ${c.patient.age} ปี`;
  el.patientOccupation.textContent = `อาชีพ: ${c.patient.occupation || '-'}`;
  el.patientPersonality.textContent = c.patient.personality || '-';
}

function resetSession() {
  const c = getActiveCase();
  if (!c) return;

  stopTimer();
  state.timerSeconds = (c.stationMinutes || 8) * 60;
  updateTimerDisplay();

  state.messages = [
    { role: 'assistant', content: c.patient.openingLine || 'สวัสดีครับ/ค่ะคุณหมอ' }
  ];
  state.checklistProgress = (c.checklist || []).map((item) => ({
    id: item.id,
    label: item.label,
    checked: false
  }));

  renderChat();
  renderChecklist();
}

function renderChat() {
  el.chatStream.innerHTML = '';
  const activeCase = getActiveCase();
  const avatarUrl = activeCase ? getPatientAvatarUrl(activeCase) : '';
  state.messages.forEach((m) => {
    const row = document.createElement('div');
    row.className = `msg-row ${m.role}`;
    const senderHtml =
      m.role === 'user'
        ? '<span>🩺 คุณหมอ (ผู้เข้าสอบ)</span>'
        : `<img class="msg-avatar" src="${avatarUrl}" alt="patient" /><span>${escapeHtml(activeCase?.patient.name || 'ผู้ป่วย')}</span>`;
    row.innerHTML = `
      <div class="msg-sender">
        ${senderHtml}
        ${m.role === 'assistant' ? `<button class="btn-icon speak-btn" title="ฟังเสียง">🔊</button>` : ''}
      </div>
      <div class="msg-bubble">${escapeHtml(m.content)}</div>
    `;
    const speakBtn = row.querySelector('.speak-btn');
    if (speakBtn) {
      speakBtn.addEventListener('click', () => speakThai(m.content));
    }
    el.chatStream.appendChild(row);
  });
  el.chatStream.scrollTop = el.chatStream.scrollHeight;
}

function renderChecklist() {
  const total = state.checklistProgress.length;
  const done = state.checklistProgress.filter((i) => i.checked).length;
  el.checklistCount.textContent = `${done}/${total}`;
  el.checklistItems.innerHTML = '';
  state.checklistProgress.forEach((item) => {
    const li = document.createElement('li');
    li.className = item.checked ? 'done' : '';
    li.innerHTML = `<span>${item.checked ? '✅' : '⬜'}</span><span>${escapeHtml(item.label)}</span>`;
    el.checklistItems.appendChild(li);
  });
}

async function sendMessage(textOverride) {
  const c = getActiveCase();
  if (!c) return;

  const text = (textOverride ?? el.chatInput.value).trim();
  if (!text) return;

  if (!textOverride) el.chatInput.value = '';
  if (!state.timerRunning) startTimer();

  state.messages.push({ role: 'user', content: text });
  renderChat();

  el.sendBtn.disabled = true;
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseData: c,
        messages: state.messages,
        aiConfig: state.aiConfig
      })
    });
    const data = await res.json();
    if (!res.ok) {
      state.messages.push({ role: 'assistant', content: `⚠️ ${data.error || 'เกิดข้อผิดพลาด'}` });
    } else {
      state.messages.push({ role: 'assistant', content: data.reply });
      if (data.checklistProgress) {
        state.checklistProgress = data.checklistProgress;
        renderChecklist();
      }
      if (state.autoTTS) speakThai(data.reply);
    }
  } catch (err) {
    state.messages.push({ role: 'assistant', content: `⚠️ เชื่อมต่อเซิร์ฟเวอร์ไม่ได้: ${err.message}` });
  } finally {
    el.sendBtn.disabled = false;
    renderChat();
  }
}

// Timer
function updateTimerDisplay() {
  const mins = String(Math.floor(state.timerSeconds / 60)).padStart(2, '0');
  const secs = String(state.timerSeconds % 60).padStart(2, '0');
  el.timerDisplay.textContent = `${mins}:${secs}`;
  el.timerDisplay.parentElement.classList.toggle('warning', state.timerSeconds <= 60);
}

function startTimer() {
  if (state.timerRunning) return;
  state.timerRunning = true;
  el.timerToggleBtn.textContent = '⏸️';
  state.timerInterval = setInterval(() => {
    if (state.timerSeconds > 0) {
      state.timerSeconds -= 1;
      updateTimerDisplay();
    } else {
      stopTimer();
    }
  }, 1000);
}

function stopTimer() {
  state.timerRunning = false;
  el.timerToggleBtn.textContent = '▶️';
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
}

// Speech (TTS & STT)
function speakThai(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const clean = text.replace(/\([^)]*\)/g, '').trim();
  const utter = new SpeechSynthesisUtterance(clean);
  utter.lang = 'th-TH';
  utter.rate = 1.0;
  window.speechSynthesis.speak(utter);
}

function setupSpeechRecognition() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    el.micBtn.style.display = 'none';
    return;
  }
  const recognition = new SpeechRec();
  recognition.lang = 'th-TH';
  recognition.interimResults = false;
  let active = false;

  el.micBtn.addEventListener('click', () => {
    if (active) {
      recognition.stop();
    } else {
      active = true;
      el.micBtn.classList.add('recording');
      recognition.start();
    }
  });

  recognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    el.chatInput.value = (el.chatInput.value ? el.chatInput.value + ' ' : '') + transcript;
  };
  recognition.onend = () => {
    active = false;
    el.micBtn.classList.remove('recording');
  };
}

// Modals
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

// Settings Modal
el.openSettingsBtn.addEventListener('click', () => {
  el.aiModeSelect.value = state.aiConfig.mode;
  el.aiProviderSelect.value = state.aiConfig.provider;
  el.aiApiKeyInput.value = state.aiConfig.apiKey;
  el.aiModelInput.value = state.aiConfig.model;
  el.aiBaseUrlInput.value = state.aiConfig.baseUrl;
  toggleSettingsFields();
  openModal('settingsModal');
});

function toggleSettingsFields() {
  el.aiConfigFields.classList.toggle('hidden', el.aiModeSelect.value !== 'ai');
  el.openaiBaseUrlGroup.classList.toggle('hidden', el.aiProviderSelect.value !== 'openai');
}

el.aiModeSelect.addEventListener('change', toggleSettingsFields);
el.aiProviderSelect.addEventListener('change', () => {
  toggleSettingsFields();
  if (el.aiProviderSelect.value === 'gemini' && el.aiModelInput.value === 'gpt-4o-mini') {
    el.aiModelInput.value = 'gemini-2.5-flash';
  } else if (el.aiProviderSelect.value === 'openai' && el.aiModelInput.value === 'gemini-2.5-flash') {
    el.aiModelInput.value = 'gpt-4o-mini';
  }
});

el.saveSettingsBtn.addEventListener('click', () => {
  state.aiConfig = {
    mode: el.aiModeSelect.value,
    provider: el.aiProviderSelect.value,
    apiKey: el.aiApiKeyInput.value.trim(),
    model: el.aiModelInput.value.trim() || (el.aiProviderSelect.value === 'openai' ? 'gpt-4o-mini' : 'gemini-2.5-flash'),
    baseUrl: el.aiBaseUrlInput.value.trim() || 'https://api.openai.com/v1'
  };
  localStorage.setItem('osce_ai_config', JSON.stringify(state.aiConfig));
  updateModeUI();
  closeModal('settingsModal');
});

// Case Editor Modal
function addScriptRow(keywords = '', response = '') {
  const div = document.createElement('div');
  div.className = 'dynamic-row script-row';
  div.innerHTML = `
    <div class="dynamic-row-header">
      <span>เงื่อนไขบทพูด</span>
      <button type="button" class="btn-link remove-row-btn">ลบ</button>
    </div>
    <div class="form-group">
      <label>คำสำคัญที่หมอถาม (คั่นด้วยลูกน้ำ เช่น ร้าว, ไหล่, แขน)</label>
      <input type="text" class="sc-keywords" value="${escapeHtml(keywords)}" />
    </div>
    <div class="form-group">
      <label>บทพูดที่ผู้ป่วยต้องตอบ</label>
      <textarea class="sc-response" rows="2">${escapeHtml(response)}</textarea>
    </div>
  `;
  div.querySelector('.remove-row-btn').addEventListener('click', () => div.remove());
  el.scriptRowsContainer.appendChild(div);
}

function addChecklistRow(label = '', keywords = '') {
  const div = document.createElement('div');
  div.className = 'dynamic-row checklist-row';
  div.innerHTML = `
    <div class="dynamic-row-header">
      <span>หัวข้อประเมิน</span>
      <button type="button" class="btn-link remove-row-btn">ลบ</button>
    </div>
    <div class="form-grid">
      <div class="form-group">
        <label>ชื่อหัวข้อ Checklist</label>
        <input type="text" class="chk-label" value="${escapeHtml(label)}" placeholder="เช่น ถามประวัติแพ้ยา" />
      </div>
      <div class="form-group">
        <label>คำสำคัญตรวจจับ (คั่นด้วยลูกน้ำ)</label>
        <input type="text" class="chk-keywords" value="${escapeHtml(keywords)}" placeholder="แพ้ยา, แพ้อาหาร" />
      </div>
    </div>
  `;
  div.querySelector('.remove-row-btn').addEventListener('click', () => div.remove());
  el.checklistRowsContainer.appendChild(div);
}

function openCaseEditor(caseObj = null) {
  document.getElementById('editorModalTitle').textContent = caseObj
    ? 'แก้ไขตัวละครและบทผู้ป่วย'
    : 'สร้างตัวละครผู้ป่วยจำลองใหม่';

  document.getElementById('editCaseId').value = caseObj?.id || '';
  document.getElementById('editTitle').value = caseObj?.title || '';
  document.getElementById('editMinutes').value = caseObj?.stationMinutes || 8;
  document.getElementById('editName').value = caseObj?.patient?.name || '';
  document.getElementById('editAge').value = caseObj?.patient?.age || 35;
  document.getElementById('editGender').value = caseObj?.patient?.gender || 'หญิง';
  document.getElementById('editOccupation').value = caseObj?.patient?.occupation || '';
  document.getElementById('editDiagnosis').value = caseObj?.diagnosis || '';
  document.getElementById('editPersonality').value = caseObj?.patient?.personality || '';
  document.getElementById('editOpeningLine').value = caseObj?.patient?.openingLine || '';

  const m = caseObj?.medicalData || {};
  document.getElementById('editCC').value = m.cc || '';
  document.getElementById('editHPI').value = m.hpi || '';
  document.getElementById('editPMH').value = m.pmh || '';
  document.getElementById('editMeds').value = m.meds || '';
  document.getElementById('editAllergies').value = m.allergies || '';
  document.getElementById('editFH').value = m.fh || '';
  document.getElementById('editSH').value = m.sh || '';
  document.getElementById('editROS').value = m.ros || '';
  document.getElementById('editICE').value = m.ice || '';

  el.scriptRowsContainer.innerHTML = '';
  (caseObj?.scripts || []).forEach((s) =>
    addScriptRow((s.keywords || []).join(', '), s.response || '')
  );

  el.checklistRowsContainer.innerHTML = '';
  (caseObj?.checklist || []).forEach((chk) =>
    addChecklistRow(chk.label || '', (chk.keywords || []).join(', '))
  );

  openModal('caseEditorModal');
}

el.newCaseBtn.addEventListener('click', () => openCaseEditor(null));
el.addScriptRowBtn.addEventListener('click', () => addScriptRow());
el.addChecklistRowBtn.addEventListener('click', () => addChecklistRow());

el.saveCaseBtn.addEventListener('click', async () => {
  const title = document.getElementById('editTitle').value.trim();
  const name = document.getElementById('editName').value.trim();
  if (!title || !name) {
    alert('กรุณากรอกชื่อเคสและชื่อตัวละครผู้ป่วย');
    return;
  }

  const id = document.getElementById('editCaseId').value || `case-${Date.now()}`;
  const scripts = [...el.scriptRowsContainer.querySelectorAll('.script-row')]
    .map((row, idx) => ({
      id: `sc-${idx + 1}`,
      keywords: row.querySelector('.sc-keywords').value.split(',').map((s) => s.trim()).filter(Boolean),
      response: row.querySelector('.sc-response').value.trim()
    }))
    .filter((s) => s.keywords.length && s.response);

  const checklist = [...el.checklistRowsContainer.querySelectorAll('.checklist-row')]
    .map((row, idx) => ({
      id: `chk-${idx + 1}`,
      label: row.querySelector('.chk-label').value.trim(),
      keywords: row.querySelector('.chk-keywords').value.split(',').map((s) => s.trim()).filter(Boolean)
    }))
    .filter((c) => c.label);

  const existingCase = state.cases.find((c) => c.id === id);
  const payload = {
    id,
    title,
    stationMinutes: Number(document.getElementById('editMinutes').value) || 8,
    diagnosis: document.getElementById('editDiagnosis').value.trim(),
    patient: {
      name,
      age: Number(document.getElementById('editAge').value) || 30,
      gender: document.getElementById('editGender').value.trim() || 'ไม่ระบุ',
      occupation: document.getElementById('editOccupation').value.trim(),
      personality: document.getElementById('editPersonality').value.trim(),
      openingLine: document.getElementById('editOpeningLine').value.trim(),
      avatarUrl: existingCase?.patient?.avatarUrl || ''
    },
    medicalData: {
      cc: document.getElementById('editCC').value.trim(),
      hpi: document.getElementById('editHPI').value.trim(),
      pmh: document.getElementById('editPMH').value.trim(),
      meds: document.getElementById('editMeds').value.trim(),
      allergies: document.getElementById('editAllergies').value.trim(),
      fh: document.getElementById('editFH').value.trim(),
      sh: document.getElementById('editSH').value.trim(),
      ros: document.getElementById('editROS').value.trim(),
      ice: document.getElementById('editICE').value.trim()
    },
    scripts,
    checklist
  };

  const res = await fetch('/api/cases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (res.ok) {
    closeModal('caseEditorModal');
    await fetchCases();
    selectCase(id);
  }
});

async function deleteCase(id) {
  if (!confirm('ต้องการลบเคสผู้ป่วยจำลองนี้ใช่หรือไม่?')) return;
  await fetch(`/api/cases/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (state.activeCaseId === id) state.activeCaseId = null;
  await fetchCases();
}

// Evaluation Modal
el.finishExamBtn.addEventListener('click', () => {
  stopTimer();
  document.getElementById('evalInputPhase').classList.remove('hidden');
  document.getElementById('evalResultPhase').classList.add('hidden');
  document.getElementById('studentDiagnosisInput').value = '';
  document.getElementById('studentPlanInput').value = '';
  openModal('evalModal');
});

el.submitEvalBtn.addEventListener('click', async () => {
  const c = getActiveCase();
  if (!c) return;

  el.submitEvalBtn.disabled = true;
  el.submitEvalBtn.textContent = 'กำลังประเมินผล...';

  try {
    const res = await fetch('/api/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseData: c,
        messages: state.messages,
        studentDiagnosis: document.getElementById('studentDiagnosisInput').value.trim(),
        studentPlan: document.getElementById('studentPlanInput').value.trim(),
        aiConfig: state.aiConfig
      })
    });
    const data = await res.json();

    document.getElementById('evalInputPhase').classList.add('hidden');
    document.getElementById('evalResultPhase').classList.remove('hidden');

    document.getElementById('evalScoreText').textContent = `${data.scorePercent}% (${data.checkedCount}/${data.totalCount})`;
    document.getElementById('evalActualDiagnosis').textContent = data.actualDiagnosis || 'ไม่ได้ระบุเฉลย';

    const list = document.getElementById('evalChecklist');
    list.innerHTML = '';
    (data.checklistProgress || []).forEach((item) => {
      const li = document.createElement('li');
      li.className = item.checked ? 'pass' : 'miss';
      li.textContent = `${item.checked ? '✅ ถามแล้ว:' : '❌ ยังไม่ได้ถาม:'} ${item.label}`;
      list.appendChild(li);
    });

    const aiBox = document.getElementById('aiFeedbackBox');
    if (data.aiFeedback) {
      aiBox.classList.remove('hidden');
      document.getElementById('aiFeedbackContent').textContent = data.aiFeedback;
    } else {
      aiBox.classList.add('hidden');
    }
  } finally {
    el.submitEvalBtn.disabled = false;
    el.submitEvalBtn.textContent = 'ส่งคำตอบและดูผลประเมิน';
  }
});

// Event Listeners
el.sendBtn.addEventListener('click', () => sendMessage());
el.chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

document.querySelectorAll('.chip').forEach((chip) => {
  chip.addEventListener('click', () => sendMessage(chip.dataset.msg));
});

el.resetChatBtn.addEventListener('click', resetSession);
el.timerToggleBtn.addEventListener('click', () => {
  if (state.timerRunning) stopTimer();
  else startTimer();
});
el.timerResetBtn.addEventListener('click', () => {
  stopTimer();
  state.timerSeconds = (getActiveCase()?.stationMinutes || 8) * 60;
  updateTimerDisplay();
});

el.toggleChecklistBtn.addEventListener('click', () => {
  const hidden = el.checklistBody.classList.toggle('hidden');
  el.toggleChecklistBtn.textContent = hidden ? 'แสดง' : 'ซ่อน';
});

el.ttsToggleBtn.addEventListener('click', () => {
  state.autoTTS = !state.autoTTS;
  el.ttsToggleBtn.textContent = state.autoTTS ? '🔊' : '🔇';
});

document.querySelectorAll('.close-modal').forEach((btn) => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ==========================================
// Persona & Patient Face Generator
// ==========================================
let currentPersonaAvatarUrl = '';
let faceSeed = 1;

function hashString(str = '') {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function generateSvgPortrait({ name = 'Patient', age = 32, gender = 'หญิง', seed = 0 }) {
  const h = hashString(`${name}-${age}-${gender}-${seed}`);
  const skinTones = ['#f7d3b5', '#efc29e', '#e5b28a', '#d9a077'];
  const bgColors = ['#ccfbf1', '#e0f2fe', '#fef3c7', '#ede9fe', '#dcfce7'];
  const shirtColors = ['#0f766e', '#0369a1', '#4338ca', '#b45309', '#be123c', '#334155'];

  const skin = skinTones[h % skinTones.length];
  const bg = bgColors[(h >> 2) % bgColors.length];
  const shirt = shirtColors[(h >> 4) % shirtColors.length];
  const isFemale = gender === 'หญิง';
  const isElder = Number(age) >= 55;
  const isMiddle = Number(age) >= 38 && Number(age) < 55;

  const hairColors = isElder ? ['#94a3b8', '#cbd5e1', '#64748b'] : ['#1e293b', '#27272a', '#3f2e21'];
  const hair = hairColors[(h >> 3) % hairColors.length];
  const hasGlasses = (h % 3 === 0) || (isElder && h % 2 === 0);

  let hairBack = '';
  let hairFront = '';
  if (isFemale) {
    const style = h % 3;
    if (style === 0) {
      hairBack = `<path d="M55 92 Q50 155 62 175 L138 175 Q150 155 145 92 Z" fill="${hair}"/>`;
      hairFront = `<path d="M58 88 Q100 44 142 88 Q130 66 100 66 Q70 66 58 88 Z" fill="${hair}"/>`;
    } else if (style === 1) {
      hairBack = `<circle cx="100" cy="52" r="22" fill="${hair}"/><ellipse cx="100" cy="88" rx="46" ry="44" fill="${hair}"/>`;
      hairFront = `<path d="M60 84 Q100 50 140 84 Q115 62 100 68 Q85 62 60 84 Z" fill="${hair}"/>`;
    } else {
      hairBack = `<path d="M56 90 Q54 140 70 150 L130 150 Q146 140 144 90 Z" fill="${hair}"/>`;
      hairFront = `<path d="M58 86 Q100 46 142 86 Q120 68 85 74 Q68 78 58 86 Z" fill="${hair}"/>`;
    }
  } else {
    const style = h % 2;
    if (style === 0) {
      hairFront = `<path d="M60 88 Q62 48 100 46 Q138 48 140 88 Q125 64 100 64 Q75 64 60 88 Z" fill="${hair}"/>`;
    } else {
      hairFront = `<path d="M60 86 Q68 48 100 48 Q132 48 140 86 Q128 60 100 66 Q76 62 60 86 Z" fill="${hair}"/>`;
    }
  }

  const wrinkles = isElder
    ? `<path d="M78 122 Q74 128 77 134" stroke="#b9825c" stroke-width="1.5" fill="none"/>
       <path d="M122 122 Q126 128 123 134" stroke="#b9825c" stroke-width="1.5" fill="none"/>
       <path d="M84 82 Q100 79 116 82" stroke="#b9825c" stroke-width="1.2" fill="none"/>`
    : isMiddle
      ? `<path d="M80 124 Q77 129 79 133" stroke="#c28e6a" stroke-width="1.2" fill="none"/>
         <path d="M120 124 Q123 129 121 133" stroke="#c28e6a" stroke-width="1.2" fill="none"/>`
      : '';

  const glasses = hasGlasses
    ? `<rect x="70" y="96" width="24" height="16" rx="4" fill="none" stroke="#334155" stroke-width="2.2"/>
       <rect x="106" y="96" width="24" height="16" rx="4" fill="none" stroke="#334155" stroke-width="2.2"/>
       <line x1="94" y1="103" x2="106" y2="103" stroke="#334155" stroke-width="2"/>`
    : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
    <rect width="200" height="200" fill="${bg}"/>
    ${hairBack}
    <path d="M42 200 Q48 154 100 154 Q152 154 158 200 Z" fill="${shirt}"/>
    <rect x="86" y="135" width="28" height="26" rx="8" fill="${skin}"/>
    <circle cx="62" cy="108" r="8" fill="${skin}"/>
    <circle cx="138" cy="108" r="8" fill="${skin}"/>
    <ellipse cx="100" cy="104" rx="38" ry="44" fill="${skin}"/>
    ${hairFront}
    <path d="M74 92 Q82 88 90 93" stroke="#1e293b" stroke-width="2.6" stroke-linecap="round" fill="none"/>
    <path d="M110 93 Q118 88 126 92" stroke="#1e293b" stroke-width="2.6" stroke-linecap="round" fill="none"/>
    <circle cx="82" cy="104" r="4" fill="#1e293b"/>
    <circle cx="118" cy="104" r="4" fill="#1e293b"/>
    <circle cx="83.5" cy="102.5" r="1.3" fill="#ffffff"/>
    <circle cx="119.5" cy="102.5" r="1.3" fill="#ffffff"/>
    <path d="M100 105 L97 118 Q100 121 103 118" stroke="#b9825c" stroke-width="2" fill="none" stroke-linecap="round"/>
    <path d="M89 130 Q100 125 111 130" stroke="#9f1239" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    ${wrinkles}
    ${glasses}
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function getPatientAvatarUrl(c) {
  if (c?.patient?.avatarUrl) return c.patient.avatarUrl;
  return generateSvgPortrait({
    name: c?.patient?.name || 'Patient',
    age: c?.patient?.age || 32,
    gender: c?.patient?.gender || 'หญิง',
    seed: 1
  });
}

function openPersonaModal() {
  const c = getActiveCase();
  if (!c) return;

  document.getElementById('personaNameInput').value = c.patient.name || '';
  document.getElementById('personaAgeInput').value = c.patient.age || 32;
  document.getElementById('personaGenderInput').value = c.patient.gender === 'ชาย' ? 'ชาย' : 'หญิง';
  document.getElementById('personaOccupationInput').value = c.patient.occupation || '';
  document.getElementById('personaTraitInput').value = c.patient.personality || '';

  currentPersonaAvatarUrl = getPatientAvatarUrl(c);
  document.getElementById('personaFacePreview').src = currentPersonaAvatarUrl;
  document.getElementById('faceGenStatus').textContent = '';

  openModal('personaModal');
}

function refreshVectorFace(incrementSeed = false) {
  if (incrementSeed) faceSeed += 1;
  const name = document.getElementById('personaNameInput').value.trim() || 'Patient';
  const age = Number(document.getElementById('personaAgeInput').value) || 32;
  const gender = document.getElementById('personaGenderInput').value;
  currentPersonaAvatarUrl = generateSvgPortrait({ name, age, gender, seed: faceSeed });
  document.getElementById('personaFacePreview').src = currentPersonaAvatarUrl;
  document.getElementById('faceGenStatus').textContent = 'สร้างใบหน้าจำลองสำเร็จ';
}

function generateAiFace() {
  const age = Number(document.getElementById('personaAgeInput').value) || 32;
  const gender = document.getElementById('personaGenderInput').value === 'ชาย' ? 'Thai man' : 'Thai woman';
  const statusEl = document.getElementById('faceGenStatus');
  const btn = document.getElementById('genAiFaceBtn');

  faceSeed += 1;
  const prompt = `realistic headshot portrait of a ${age} year old ${gender} patient in hospital clinic, natural lighting, looking at camera, worried expression`;
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=384&height=384&nologo=true&seed=${faceSeed}`;

  statusEl.textContent = 'กำลังเจนภาพถ่ายใบหน้า AI...';
  btn.disabled = true;

  const img = new Image();
  img.onload = () => {
    currentPersonaAvatarUrl = url;
    document.getElementById('personaFacePreview').src = url;
    statusEl.textContent = 'เจนภาพถ่ายใบหน้าสำเร็จ!';
    btn.disabled = false;
  };
  img.onerror = () => {
    statusEl.textContent = 'ไม่สามารถเชื่อมต่อบริการเจนภาพ AI ได้ (ใช้ภาพจำลองแทน)';
    btn.disabled = false;
  };
  img.src = url;
}

document.getElementById('openPersonaBtn').addEventListener('click', openPersonaModal);
el.patientAvatar.addEventListener('click', openPersonaModal);
document.getElementById('genVectorFaceBtn').addEventListener('click', () => refreshVectorFace(true));
document.getElementById('genAiFaceBtn').addEventListener('click', generateAiFace);

['personaAgeInput', 'personaGenderInput'].forEach((id) => {
  document.getElementById(id).addEventListener('change', () => {
    if (!currentPersonaAvatarUrl.startsWith('http')) {
      refreshVectorFace(false);
    }
  });
});

document.getElementById('savePersonaBtn').addEventListener('click', async () => {
  const c = getActiveCase();
  if (!c) return;

  const name = document.getElementById('personaNameInput').value.trim();
  if (!name) {
    alert('กรุณากรอกชื่อผู้ป่วย');
    return;
  }

  c.patient.name = name;
  c.patient.age = Number(document.getElementById('personaAgeInput').value) || 32;
  c.patient.gender = document.getElementById('personaGenderInput').value;
  c.patient.occupation = document.getElementById('personaOccupationInput').value.trim();
  c.patient.personality = document.getElementById('personaTraitInput').value.trim();
  c.patient.avatarUrl = currentPersonaAvatarUrl;

  const res = await fetch('/api/cases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(c)
  });

  if (res.ok) {
    updatePatientHeader(c);
    renderCaseList();
    renderChat();
    closeModal('personaModal');
  }
});

// Init
loadSettings();
setupSpeechRecognition();
fetchCases();
