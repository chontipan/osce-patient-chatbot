const http = require('http');
const fs = require('fs/promises');
const path = require('path');

const PORT = process.env.PORT || 3456;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = path.join(__dirname, 'data', 'cases.json');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

async function readCases() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function writeCases(cases) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(cases, null, 2), 'utf-8');
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf-8');
  return text ? JSON.parse(text) : {};
}

function normalizeText(str = '') {
  return String(str).toLowerCase().trim();
}

function matchChecklist(caseData, messages) {
  const doctorTexts = messages
    .filter((m) => m.role === 'user')
    .map((m) => normalizeText(m.content))
    .join(' ');

  return (caseData.checklist || []).map((item) => {
    const hit = (item.keywords || []).some((kw) =>
      doctorTexts.includes(normalizeText(kw))
    );
    return { id: item.id, label: item.label, checked: hit };
  });
}

function matchOfflineResponse(caseData, userMessage) {
  const q = normalizeText(userMessage);
  const { patient, medicalData, scripts = [] } = caseData;

  // 1. Check custom user-defined scripts first (บทพูดตามเงื่อนไขที่กำหนด)
  let bestScript = null;
  let bestScore = 0;
  for (const sc of scripts) {
    const keywords = sc.keywords || [];
    let score = 0;
    for (const kw of keywords) {
      if (kw && q.includes(normalizeText(kw))) {
        score += 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestScript = sc;
    }
  }
  if (bestScript && bestScore > 0) {
    return { reply: bestScript.response, source: 'script' };
  }

  // 2. Standard OSCE history-taking intent matching
  const rules = [
    {
      keywords: ['สวัสดี', 'เชิญ', 'นั่ง', 'หมอชื่อ', 'ขออนุญาต', 'แนะนำตัว'],
      reply: `สวัสดีครับ/ค่ะหมอ ขอบคุณครับ/ค่ะ (${patient.openingLine})`
    },
    {
      keywords: ['ชื่ออะไร', 'ชื่อ', 'อายุ', 'กี่ปี', 'อาชีพ', 'ทำงาน'],
      reply: `ผม/ดิฉันชื่อ ${patient.name} อายุ ${patient.age} ปี อาชีพ ${patient.occupation} ครับ/ค่ะ`
    },
    {
      keywords: ['เป็นอะไรมา', 'อาการสำคัญ', 'มาด้วยเรื่อง', 'ช่วยอะไร', 'ไม่สบาย'],
      reply: medicalData.cc || 'มีอาการผิดปกติตามที่เล่าไปเลยครับ/ค่ะหมอ'
    },
    {
      keywords: ['เริ่ม', 'ตั้งแต่เมื่อไหร่', 'นานแค่ไหน', 'ลักษณะ', 'ปวดยังไง', 'เจ็บยังไง', 'กี่คะแนน', 'รุนแรง', 'ดีขึ้น', 'แย่ลง', 'ประวัติปัจจุบัน'],
      reply: medicalData.hpi || 'อาการเป็นต่อเนื่องมาตั้งแต่เมื่อวานครับ/ค่ะ'
    },
    {
      keywords: ['โรคประจำตัว', 'เคยป่วย', 'ผ่าตัด', 'นอนโรงพยาบาล', 'ความดัน', 'เบาหวาน'],
      reply: medicalData.pmh || 'ไม่มีโรคประจำตัวครับ/ค่ะ'
    },
    {
      keywords: ['กินยา', 'ใช้ยา', 'ยาประจำ', 'สมุนไพร', 'อาหารเสริม'],
      reply: medicalData.meds || 'ไม่ได้กินยาอะไรเป็นประจำครับ/ค่ะ'
    },
    {
      keywords: ['แพ้ยา', 'แพ้อาหาร', 'แพ้อะไร'],
      reply: medicalData.allergies || 'ไม่มีประวัติแพ้ยาหรือแพ้อาหารครับ/ค่ะ'
    },
    {
      keywords: ['ครอบครัว', 'พ่อ', 'แม่', 'พี่น้อง', 'ญาติ', 'กรรมพันธุ์'],
      reply: medicalData.fh || 'คนในครอบครัวแข็งแรงดีครับ/ค่ะ'
    },
    {
      keywords: ['บุหรี่', 'สูบ', 'เหล้า', 'เบียร์', 'แอลกอฮอล์', 'สารเสพติด', 'พักผ่อน', 'อยู่กับใคร', 'ที่บ้าน'],
      reply: medicalData.sh || 'ใช้ชีวิตปกติครับ/ค่ะ'
    },
    {
      keywords: ['ไข้', 'ไอ', 'เหนื่อย', 'หอบ', 'คลื่นไส้', 'อาเจียน', 'ปัสสาวะ', 'อุจจาระ', 'ขับถ่าย', 'ประจำเดือน', 'น้ำหนัก', 'อาการอื่น'],
      reply: medicalData.ros || 'นอกจากอาการหลักแล้ว อย่างอื่นยังปกติดีครับ/ค่ะ'
    },
    {
      keywords: ['กังวล', 'กลัว', 'คิดว่าเป็น', 'คาดหวัง', 'อยากให้หมอ', 'สงสัย'],
      reply: medicalData.ice || 'ก็กังวลนิดหน่อยครับ/ค่ะ อยากให้หมอช่วยตรวจให้แน่ใจ'
    }
  ];

  for (const rule of rules) {
    if (rule.keywords.some((kw) => q.includes(kw))) {
      return { reply: rule.reply, source: 'medical-data' };
    }
  }

  return {
    reply: 'เอ่อ... เรื่องนั้นไม่แน่ใจเหมือนกันครับ/ค่ะหมอ หมอช่วยถามเจาะจงอีกนิดได้ไหมครับ/ค่ะ?',
    source: 'fallback'
  };
}

function buildPatientSystemPrompt(caseData) {
  const { patient, medicalData, scripts = [] } = caseData;
  const scriptBlock = scripts.length
    ? scripts
        .map(
          (s, idx) =>
            `${idx + 1}. ถ้าหมอถามเกี่ยวกับ [${(s.keywords || []).join(', ')}] ให้ตอบตามบทนี้ (ปรับน้ำเสียงให้เข้ากับบริบทได้เล็กน้อยแต่ต้องคงใจความสำคัญ): "${s.response}"`
        )
        .join('\n')
    : 'ไม่มีบทพูดเฉพาะเพิ่มเติม';

  const extraRules = [];
  if (caseData.strictAskToAnswer) {
    extraRules.push('- ลักษณะการตอบ: "ถามคำ ตอบคำ" ห้ามเล่าประวัติเองถ้าหมอไม่ได้ถามตรงๆ');
  }
  if (caseData.specialCue) {
    extraRules.push(`- บทพิเศษระหว่างซักประวัติ: ให้ร้องขอเรื่องนี้แทรกขึ้นมาอย่างน้อย 1 ครั้ง (และหากหมอไม่ตอบสนอง ให้ขอซ้ำอีกครั้ง): "${caseData.specialCue}"`);
  }

  return `คุณคือ "ผู้ป่วยจำลอง (Standardized Patient)" สำหรับให้นักศึกษาแพทย์/แพทย์ฝึกซักประวัติก่อนสอบ OSCE
จงสวมบทบาทเป็นผู้ป่วยคนนี้อย่างเคร่งครัด ห้ามหลุดจากบทบาท ห้ามบอกการวินิจฉัยโรค (Diagnosis) และห้ามพูดจาเหมือน AI หรือแพทย์เด็ดขาด

[ข้อมูลตัวละคร]
- ชื่อ: ${patient.name}
- อายุ: ${patient.age} ปี | เพศ: ${patient.gender} | อาชีพ: ${patient.occupation}
- บุคลิกและท่าทาง: ${patient.personality}

[ข้อมูลทางการแพทย์ (เปิดเผยเฉพาะเมื่อหมอถามถึงหัวข้อนั้นๆ อย่าเล่าทั้งหมดรวดเดียว)]
- อาการสำคัญ (CC): ${medicalData.cc}
- ประวัติปัจจุบัน (HPI): ${medicalData.hpi}
- โรคประจำตัว (PMH): ${medicalData.pmh}
- ยาที่ใช้ประจำ (Medications): ${medicalData.meds}
- ประวัติแพ้ยา (Allergies): ${medicalData.allergies}
- ประวัติครอบครัว (FH): ${medicalData.fh}
- ประวัติส่วนตัว/สังคม (SH): ${medicalData.sh}
- อาการตามระบบอื่นๆ (ROS): ${medicalData.ros}
- ความคิด/ความกังวล/ความคาดหวัง (ICE): ${medicalData.ice}

[บทพูดบังคับ / เงื่อนไขพิเศษ (Scripted Cues)]
${scriptBlock}
${extraRules.length ? '\n' + extraRules.join('\n') : ''}

[กติกาการตอบ]
1. ตอบเป็นภาษาไทยที่เป็นธรรมชาติ สอดคล้องกับอายุ อาชีพ และอารมณ์ของผู้ป่วย (ใส่คำบรรยายท่าทางสั้นๆ ในวงเล็บได้ เช่น (เอามือกุมหน้าอก))
2. ตอบเฉพาะสิ่งที่หมอถาม อย่าชิงบอกข้อมูลลับทั้งหมดในประโยคเดียว เพื่อให้นักศึกษาแพทย์ได้ฝึกซักประวัติ
3. ถ้าหมอถามเรื่องที่ไม่มีในข้อมูล ให้ตอบอย่างสมเหตุสมผลในฐานะผู้ป่วย (เช่น "ไม่เคยสังเกตเลยครับหมอ" หรือ "ไม่มีนะครับ")`;
}

async function callGemini({ apiKey, model = 'gemini-2.5-flash', systemPrompt, messages }) {
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: { temperature: 0.7, maxOutputTokens: 600 }
    })
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data.error?.message || `Gemini API error (${resp.status})`);
  }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini API returned empty response');
  return text.trim();
}

async function callOpenAI({ apiKey, baseUrl = 'https://api.openai.com/v1', model = 'gpt-4o-mini', systemPrompt, messages }) {
  const formatted = [
    { role: 'system', content: systemPrompt },
    ...messages.map((m) => ({ role: m.role, content: m.content }))
  ];

  const cleanBase = baseUrl.replace(/\/+$/, '');
  const resp = await fetch(`${cleanBase}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: formatted,
      temperature: 0.7,
      max_tokens: 600
    })
  });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data.error?.message || `OpenAI API error (${resp.status})`);
  }
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenAI API returned empty response');
  return text.trim();
}

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = reqUrl.pathname;

    // API: Get all cases
    if (req.method === 'GET' && pathname === '/api/cases') {
      const cases = await readCases();
      return sendJson(res, 200, { cases });
    }

    // API: Save (create or update) a case
    if (req.method === 'POST' && pathname === '/api/cases') {
      const body = await readBody(req);
      if (!body.id || !body.title || !body.patient?.name) {
        return sendJson(res, 400, { error: 'Missing required case fields' });
      }
      const cases = await readCases();
      const idx = cases.findIndex((c) => c.id === body.id);
      if (idx >= 0) {
        cases[idx] = body;
      } else {
        cases.push(body);
      }
      await writeCases(cases);
      return sendJson(res, 200, { ok: true, case: body });
    }

    // API: Delete a case
    if (req.method === 'DELETE' && pathname.startsWith('/api/cases/')) {
      const id = decodeURIComponent(pathname.replace('/api/cases/', ''));
      const cases = await readCases();
      const filtered = cases.filter((c) => c.id !== id);
      await writeCases(filtered);
      return sendJson(res, 200, { ok: true });
    }

    // API: Chat with simulated patient
    if (req.method === 'POST' && pathname === '/api/chat') {
      const { caseData, messages = [], aiConfig = {} } = await readBody(req);
      if (!caseData || !messages.length) {
        return sendJson(res, 400, { error: 'Missing caseData or messages' });
      }

      const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
      const checklistProgress = matchChecklist(caseData, messages);

      const apiKey = aiConfig.apiKey || process.env.GEMINI_API_KEY || '';
      const useAI = aiConfig.mode === 'ai' && Boolean(apiKey);

      if (useAI) {
        try {
          const systemPrompt = buildPatientSystemPrompt(caseData);
          const reply =
            aiConfig.provider === 'openai'
              ? await callOpenAI({
                  apiKey,
                  baseUrl: aiConfig.baseUrl,
                  model: aiConfig.model || 'gpt-4o-mini',
                  systemPrompt,
                  messages
                })
              : await callGemini({
                  apiKey,
                  model: aiConfig.model || 'gemini-2.5-flash',
                  systemPrompt,
                  messages
                });

          return sendJson(res, 200, {
            reply,
            mode: 'ai',
            checklistProgress
          });
        } catch (aiErr) {
          // Return error clearly so user knows if API key/model failed
          return sendJson(res, 502, {
            error: `AI Error: ${aiErr.message}`,
            checklistProgress
          });
        }
      }

      // Offline / Scripted Mode
      const offline = matchOfflineResponse(caseData, lastUserMsg?.content || '');
      let finalReply = offline.reply;
      if (caseData.specialCue) {
        const userMsgCount = messages.filter((m) => m.role === 'user').length;
        const alreadyAskedCue = messages.some(
          (m) => m.role === 'assistant' && m.content.includes(caseData.specialCue)
        );
        if (userMsgCount >= 3 && !alreadyAskedCue) {
          finalReply += `\n\n(ทำสีหน้าเจ็บปวดมาก) "${caseData.specialCue}"`;
        }
      }
      return sendJson(res, 200, {
        reply: finalReply,
        mode: 'offline',
        source: offline.source,
        checklistProgress
      });
    }

    // API: Evaluate OSCE session
    if (req.method === 'POST' && pathname === '/api/evaluate') {
      const { caseData, messages = [], studentDiagnosis = '', studentPlan = '', aiConfig = {} } = await readBody(req);
      if (!caseData) {
        return sendJson(res, 400, { error: 'Missing caseData' });
      }

      const checklistProgress = matchChecklist(caseData, messages);
      const checkedCount = checklistProgress.filter((c) => c.checked).length;
      const totalCount = checklistProgress.length || 1;
      const scorePercent = Math.round((checkedCount / totalCount) * 100);

      let aiFeedback = null;
      const apiKey = aiConfig.apiKey || process.env.GEMINI_API_KEY || '';
      if (aiConfig.mode === 'ai' && apiKey) {
        try {
          const transcript = messages
            .map((m) => `${m.role === 'user' ? 'นักศึกษาแพทย์' : 'ผู้ป่วย'}: ${m.content}`)
            .join('\n');

          const examinerPrompt = `คุณคืออาจารย์แพทย์ผู้คุมสอบ OSCE จงประเมินการซักประวัติของนักศึกษาแพทย์จากบทสนทนาต่อไปนี้อย่างสร้างสรรค์และตรงประเด็น (ตอบเป็นภาษาไทยแบบอ่านง่าย ใช้หัวข้อย่อย)

[เฉลยเคส]
- การวินิจฉัยที่ถูกต้อง: ${caseData.diagnosis}
- Checklist สำคัญ: ${(caseData.checklist || []).map((c) => c.label).join(', ')}

[คำตอบของนักศึกษา]
- Differential / Working Diagnosis: ${studentDiagnosis || '(ไม่ได้ระบุ)'}
- แผนการตรวจ/รักษาเบื้องต้น: ${studentPlan || '(ไม่ได้ระบุ)'}

[บทสนทนา]
${transcript}

กรุณาประเมิน 4 หัวข้อ:
1. ความครบถ้วนของการซักประวัติ (สิ่งที่ถามได้ดี และสิ่งที่ควรซักเพิ่ม)
2. ทักษะการสื่อสารและ Empathy
3. ความแม่นยำของการวินิจฉัยและแผนการรักษา
4. คำแนะนำสั้นๆ สำหรับการสอบจริง`;

          aiFeedback =
            aiConfig.provider === 'openai'
              ? await callOpenAI({
                  apiKey,
                  baseUrl: aiConfig.baseUrl,
                  model: aiConfig.model || 'gpt-4o-mini',
                  systemPrompt: 'คุณคืออาจารย์แพทย์ผู้เชี่ยวชาญการประเมิน OSCE',
                  messages: [{ role: 'user', content: examinerPrompt }]
                })
              : await callGemini({
                  apiKey,
                  model: aiConfig.model || 'gemini-2.5-flash',
                  systemPrompt: 'คุณคืออาจารย์แพทย์ผู้เชี่ยวชาญการประเมิน OSCE',
                  messages: [{ role: 'user', content: examinerPrompt }]
                });
        } catch (err) {
          aiFeedback = `ไม่สามารถเรียก AI Examiner ได้: ${err.message}`;
        }
      }

      return sendJson(res, 200, {
        checklistProgress,
        checkedCount,
        totalCount,
        scorePercent,
        actualDiagnosis: caseData.diagnosis,
        aiFeedback
      });
    }

    // Serve static files
    let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    try {
      const content = await fs.readFile(resolved);
      const ext = path.extname(resolved);
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end('Not Found');
    }
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: err.message || 'Internal Server Error' });
  }
});

server.listen(PORT, () => {
  console.log(`OSCE Simulated Patient Chatbot running at http://localhost:${PORT}`);
});
