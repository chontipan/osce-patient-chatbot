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
  el.patientAvatar.textContent = c.patient.gender === 'หญิง' ? '👩' : '👨';
  el.patientName.textContent = c.patient.name;
  el.patientDemographics.textContent = `${c.patient.gender} • ${c.patient.age} ปี`;
  el.patientOccupation.textContent = `อาชีพ: ${c.patient.occupation || '-'}`;
  el.patientPersonality.textContent = c.patient.personality || '-';

  resetSession();
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
  state.messages.forEach((m) => {
    const row = document.createElement('div');
    row.className = `msg-row ${m.role}`;
    const senderLabel = m.role === 'user' ? '🩺 คุณหมอ (ผู้เข้าสอบ)' : `🧑 ${getActiveCase()?.patient.name || 'ผู้ป่วย'}`;
    row.innerHTML = `
      <div class="msg-sender">
        <span>${escapeHtml(senderLabel)}</span>
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
      openingLine: document.getElementById('editOpeningLine').value.trim()
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

// Init
loadSettings();
setupSpeechRecognition();
fetchCases();
