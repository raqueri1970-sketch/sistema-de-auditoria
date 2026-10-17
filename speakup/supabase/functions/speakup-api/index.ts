// SpeakUp IA: API do app de conversação por voz.
// Sem login: o aparelho recebe um token aleatório; o servidor cria o usuário no Supabase Auth e guarda só o hash.
// IA gratuita: Gemini (GEMINI_API_KEY) e Groq de reserva (GROQ_API_KEY). Sem chave, o app funciona no modo roteirizado.
import postgres from "npm:postgres@3.4.5";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const GROQ_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const GEMINI_MODELS = [Deno.env.get("GEMINI_MODEL"), "gemini-2.5-flash", "gemini-flash-latest", "gemini-2.0-flash"]
  .filter((m): m is string => !!m);

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 3, idle_timeout: 20 });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,x-client-info,apikey,content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};
const json = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { ...CORS, "Content-Type": "application/json" } });

class HttpError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}

async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function randomToken() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const aiAvailable = () => !!(GEMINI_KEY || GROQ_KEY);

// ---------- usuário / aparelho ----------
async function createUser(displayName: string) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `aluno-${crypto.randomUUID()}@speakup.invalid`,
      password: randomToken(),
      email_confirm: true,
      user_metadata: { speakup: true, display_name: displayName },
    }),
  });
  const d = await r.json();
  if (!r.ok || !d?.id) throw new HttpError(500, "Não consegui criar o aluno: " + (d?.msg || d?.message || r.status));
  return d.id as string;
}

async function userFromToken(token: unknown): Promise<string> {
  if (typeof token !== "string" || token.length < 32) throw new HttpError(401, "token inválido");
  const h = await sha256(token);
  const rows = await sql`update english_ai.devices set last_seen_at = now() where token_hash = ${h} returning user_id`;
  if (!rows.length) throw new HttpError(401, "token inválido");
  return rows[0].user_id;
}

async function aiLimits(userId: string) {
  const [flag] = await sql`select enabled, config from english_ai.feature_flags where key = 'ai_conversation'`;
  const cfg = flag?.config ?? {};
  const [u] = await sql`
    select count(*) filter (where user_id = ${userId})::int as mine, count(*)::int as total
      from english_ai.usage_events
     where event_type = 'ai_call' and created_at >= date_trunc('day', now())`;
  return {
    enabled: !!flag?.enabled && aiAvailable(),
    userLeft: (cfg.daily_user_limit ?? 300) - u.mine,
    globalLeft: (cfg.daily_global_limit ?? 1200) - u.total,
  };
}

// ---------- IA ----------
const SCHEMA_DESC = `Return ONLY a JSON object with these keys:
reply_en: what you say now, in English (max 2 short sentences; end with ONE simple question unless the conversation is over),
reply_pt: Brazilian Portuguese translation of reply_en,
correction_en: if the student's last message had an error or was in Portuguese, the correct natural English sentence they should say; otherwise "",
tip_pt: one very short explanation in Portuguese of the correction, or "",
suggested_answer_en: a short easy answer the student could give to reply_en,
suggested_answer_pt: Portuguese translation of suggested_answer_en,
score: 0-100, how clear and correct the student's last message was (100 if there is no student message yet),
new_phrases: array (max 2) of {en, pt} useful phrases from this turn worth reviewing later.`;

function systemPrompt(p: { name: string; level: string; lesson: any; ptPct: number; weak: string[] }) {
  const c = p.lesson?.content ?? {};
  const phrases = (c.chunks ?? []).map((x: any) => x.en).join(" | ");
  return `You are Alex, a warm, patient private English teacher for a Brazilian adult who wants to learn to SPEAK.
Student name: ${p.name || "student"}. Level: ${p.level}. Portuguese support: ${p.ptPct}%.
Lesson: "${p.lesson?.title ?? "Conversa livre"}" — goal: ${p.lesson?.objective ?? "talk freely"}.
Role-play: ${c.scenario ?? "Friendly free conversation about the student's life."}
Target phrases: ${phrases || "any simple everyday English"}.
Phrases this student struggled with before (weave 1 or 2 into the conversation naturally): ${p.weak.join(" | ") || "none yet"}.
Method (the easiest way to learn to converse):
- Teach speech blocks (whole useful sentences), never isolated words or grammar rules.
- Portuguese support ${p.ptPct}% means: at 80% put a full translation and explain in Portuguese; at 20% use English almost only.
- Speak VERY simply: short sentences, common words, present tense for beginners. Never lecture.
- Keep the student talking: one question at a time, about their real life when possible. reply_en has at most 20 words.
- Correct by recasting: give the natural sentence in correction_en and a tiny tip in Portuguese. Praise effort.
- Correct at most ONE mistake per turn: the one that most blocks understanding.
- If the student is silent or says they don't know, offer two short options to choose from.
- If the student asks for something unrelated to learning English, answer in one short sentence and return to the lesson.
- If the student writes or speaks Portuguese, it means they don't know how to say it: put the English version in correction_en, then continue the conversation.
- If the student says they don't understand, say it again more slowly with simpler words.
- Reuse the target phrases naturally so the student practices them.
- Never mention that you are an AI model, and never output anything except the JSON.
${SCHEMA_DESC}`;
}

const GEMINI_SCHEMA = {
  type: "OBJECT",
  properties: {
    reply_en: { type: "STRING" }, reply_pt: { type: "STRING" },
    correction_en: { type: "STRING" }, tip_pt: { type: "STRING" },
    suggested_answer_en: { type: "STRING" }, suggested_answer_pt: { type: "STRING" },
    score: { type: "INTEGER" },
    new_phrases: { type: "ARRAY", items: { type: "OBJECT", properties: { en: { type: "STRING" }, pt: { type: "STRING" } } } },
  },
  required: ["reply_en", "reply_pt", "correction_en", "tip_pt", "suggested_answer_en", "suggested_answer_pt", "score"],
};

type Msg = { role: "user" | "model"; text: string };

async function callGemini(system: string, msgs: Msg[]) {
  let last = "";
  for (const model of GEMINI_MODELS) {
    const gen: Record<string, unknown> = {
      responseMimeType: "application/json", responseSchema: GEMINI_SCHEMA, temperature: 0.7, maxOutputTokens: 1024,
    };
    if (model.startsWith("gemini-2.5")) gen.thinkingConfig = { thinkingBudget: 0 };
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: msgs.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
        generationConfig: gen,
      }),
    });
    // 429 = limite grátis daquele modelo; os limites são por modelo, então tenta o próximo
    if (r.status === 404 || r.status === 400 || r.status === 429) { last = `${model}: ${r.status} ${(await r.text()).slice(0, 200)}`; continue; }
    if (!r.ok) throw new Error(`gemini ${r.status} ${(await r.text()).slice(0, 300)}`);
    const d = await r.json();
    const text = d?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
    return { data: JSON.parse(text), provider: `gemini:${model}` };
  }
  throw new Error("gemini sem modelo disponível: " + last);
}

async function callGroq(system: string, msgs: Msg[]) {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_KEY}` },
    body: JSON.stringify({
      model: Deno.env.get("GROQ_MODEL") ?? "llama-3.3-70b-versatile",
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system },
        ...msgs.map((m) => ({ role: m.role === "model" ? "assistant" : "user", content: m.text }))],
    }),
  });
  if (!r.ok) throw new Error(`groq ${r.status} ${(await r.text()).slice(0, 300)}`);
  const d = await r.json();
  return { data: JSON.parse(d.choices[0].message.content), provider: "groq" };
}

async function askTeacher(system: string, msgs: Msg[]) {
  const errors: string[] = [];
  if (GEMINI_KEY) { try { return await callGemini(system, msgs); } catch (e) { errors.push(String(e)); } }
  if (GROQ_KEY) { try { return await callGroq(system, msgs); } catch (e) { errors.push(String(e)); } }
  throw new HttpError(503, "IA indisponível agora: " + errors.join(" | ").slice(0, 400));
}

const str = (v: unknown, max = 600) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function normalizeReply(d: any) {
  const score = Math.max(0, Math.min(100, Math.round(Number(d?.score) || 0)));
  return {
    reply_en: str(d?.reply_en) || "Sorry, can you say that again?",
    reply_pt: str(d?.reply_pt),
    correction_en: str(d?.correction_en),
    tip_pt: str(d?.tip_pt),
    suggested_answer_en: str(d?.suggested_answer_en),
    suggested_answer_pt: str(d?.suggested_answer_pt),
    score,
    new_phrases: Array.isArray(d?.new_phrases)
      ? d.new_phrases.slice(0, 2).map((p: any) => ({ en: str(p?.en, 200), pt: str(p?.pt, 200) })).filter((p: any) => p.en)
      : [],
  };
}

// ---------- repetição espaçada (SM-2 simplificado) ----------
async function practiceItem(userId: string, en: string, pt: string, score: number, lessonId: string | null) {
  en = en.slice(0, 200);
  if (!en) return;
  const q = score >= 85 ? 5 : score >= 70 ? 4 : score >= 50 ? 3 : 2;
  const [cur] = await sql`select ease, interval_days, reps, mastery, attempts, correct_attempts
                            from english_ai.learning_items where user_id = ${userId} and phrase_en = ${en}`;
  let ease = Number(cur?.ease ?? 2.5), interval = Number(cur?.interval_days ?? 0), reps = Number(cur?.reps ?? 0);
  let mastery = Number(cur?.mastery ?? 0);
  if (q < 3) { reps = 0; interval = 0.007; mastery = Math.max(0, mastery - 20); } // ~10 minutos
  else {
    reps += 1;
    interval = reps === 1 ? 1 : reps === 2 ? 3 : Math.round(interval * ease);
    mastery = Math.min(100, mastery + (q === 5 ? 30 : q === 4 ? 20 : 10));
  }
  ease = Math.max(1.3, ease + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  const next = new Date(Date.now() + interval * 86400000);
  const ok = q >= 4 ? 1 : 0;
  await sql`
    insert into english_ai.learning_items
      (user_id, phrase_en, meaning_pt, category, mastery, attempts, correct_attempts, pronunciation_best,
       next_review_at, last_seen_at, ease, interval_days, reps, lesson_id)
    values (${userId}, ${en}, ${pt.slice(0, 200)}, 'phrase', ${mastery}, 1, ${ok}, ${score}, ${next}, now(),
            ${ease}, ${interval}, ${reps}, ${lessonId})
    on conflict (user_id, phrase_en) do update set
      meaning_pt = coalesce(nullif(excluded.meaning_pt, ''), english_ai.learning_items.meaning_pt),
      mastery = excluded.mastery,
      attempts = english_ai.learning_items.attempts + 1,
      correct_attempts = english_ai.learning_items.correct_attempts + ${ok},
      pronunciation_best = greatest(coalesce(english_ai.learning_items.pronunciation_best, 0), excluded.pronunciation_best),
      next_review_at = excluded.next_review_at, last_seen_at = now(),
      ease = excluded.ease, interval_days = excluded.interval_days, reps = excluded.reps,
      lesson_id = coalesce(english_ai.learning_items.lesson_id, excluded.lesson_id)`;
}

// ---------- ações ----------
async function stats(userId: string) {
  const [s] = await sql`
    select
      coalesce(sum(duration_seconds) filter (where started_at >= (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')), 0)::int as today_seconds,
      coalesce(sum(duration_seconds), 0)::int as total_seconds,
      coalesce(max(duration_seconds) filter (where scenario = 'free_01'), 0)::int as best_free_seconds
    from english_ai.sessions where user_id = ${userId}`;
  const days = await sql`
    select distinct to_char(started_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as d
      from english_ai.sessions where user_id = ${userId} and duration_seconds > 30
     order by d desc limit 120`;
  const set = new Set(days.map((x: any) => x.d));
  const day = (offset: number) =>
    new Date(Date.now() - offset * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  let streak = 0;
  let i = set.has(day(0)) ? 0 : 1; // sequência continua viva se praticou ontem
  while (set.has(day(i))) { streak++; i++; }
  const [r] = await sql`select count(*)::int as due from english_ai.learning_items
                         where user_id = ${userId} and next_review_at <= now()`;
  const [l] = await sql`select count(*)::int as learned from english_ai.learning_items where user_id = ${userId}`;
  const [pp] = await sql`select portuguese_support_pct from english_ai.profiles where user_id = ${userId}`;
  return { ...s, streak, review_due: r.due, phrases: l.learned, portuguese_support_pct: pp?.portuguese_support_pct ?? 80 };
}

async function hello(b: any) {
  let token = typeof b.token === "string" ? b.token : "";
  let userId: string | null = null;
  if (token) { try { userId = await userFromToken(token); } catch { userId = null; } }
  if (!userId) {
    const [recent] = await sql`select count(*)::int as n from english_ai.devices where created_at > now() - interval '1 hour'`;
    if (recent.n >= 60) throw new HttpError(429, "muitos cadastros novos agora; tente de novo mais tarde");
    const name = str(b.name, 60) || "Aluno";
    userId = await createUser(name);
    token = randomToken();
    await sql`insert into english_ai.devices (token_hash, user_id) values (${await sha256(token)}, ${userId})`;
    await sql`insert into english_ai.profiles (user_id, display_name, level) values (${userId}, ${name}, 'iniciante_zero')
              on conflict (user_id) do nothing`;
  }
  const [profile] = await sql`select display_name, level, daily_goal_minutes, portuguese_support_pct, conversation_goal_minutes
                                from english_ai.profiles where user_id = ${userId}`;
  const modules = await sql`select id, title, description, icon, sort_order from english_ai.modules where active order by sort_order`;
  const lessons = await sql`select id, module_id, title, objective, sort_order, estimated_minutes, difficulty, content
                              from english_ai.lessons where active order by sort_order`;
  const progress = await sql`select lesson_id, status, best_score, attempts, completed_at
                               from english_ai.lesson_progress where user_id = ${userId}`;
  const lim = await aiLimits(userId);
  return { token, profile, modules, lessons, progress, stats: await stats(userId), ai: { enabled: lim.enabled } };
}

async function saveProfile(userId: string, b: any) {
  const level = ["iniciante_zero", "iniciante", "basico", "intermediario", "avancado"].includes(b.level) ? b.level : null;
  const goal = Number.isFinite(+b.daily_goal_minutes) ? Math.max(5, Math.min(120, Math.round(+b.daily_goal_minutes))) : null;
  const pt = Number.isFinite(+b.portuguese_support_pct) ? Math.max(0, Math.min(100, Math.round(+b.portuguese_support_pct))) : null;
  const name = str(b.display_name, 60) || null;
  await sql`update english_ai.profiles set
      display_name = coalesce(${name}, display_name), level = coalesce(${level}, level),
      daily_goal_minutes = coalesce(${goal}, daily_goal_minutes),
      portuguese_support_pct = coalesce(${pt}, portuguese_support_pct), updated_at = now()
    where user_id = ${userId}`;
  const [p] = await sql`select display_name, level, daily_goal_minutes, portuguese_support_pct from english_ai.profiles where user_id = ${userId}`;
  return { profile: p };
}

async function start(userId: string, b: any) {
  const lessonId = str(b.lesson_id, 60) || "free_01";
  const [s] = await sql`insert into english_ai.sessions (user_id, scenario, status)
                        values (${userId}, ${lessonId}, 'em_andamento') returning id`;
  await sql`insert into english_ai.lesson_progress (user_id, lesson_id, status, attempts, last_seen_at)
            select ${userId}, ${lessonId}, 'em_andamento', 1, now() where exists (select 1 from english_ai.lessons where id = ${lessonId})
            on conflict (user_id, lesson_id) do update set attempts = english_ai.lesson_progress.attempts + 1, last_seen_at = now(),
              status = case when english_ai.lesson_progress.status = 'concluida' then 'concluida' else 'em_andamento' end`;
  return { session_id: s.id };
}

async function ownSession(userId: string, sessionId: unknown) {
  if (typeof sessionId !== "string") throw new HttpError(400, "session_id obrigatório");
  const [s] = await sql`select id, scenario from english_ai.sessions where id = ${sessionId}::uuid and user_id = ${userId}`;
  if (!s) throw new HttpError(404, "sessão não encontrada");
  return s;
}

async function turn(userId: string, b: any) {
  const s = await ownSession(userId, b.session_id);
  const lim = await aiLimits(userId);
  if (!lim.enabled) throw new HttpError(503, "conversa com IA desligada");
  if (lim.userLeft <= 0 || lim.globalLeft <= 0) throw new HttpError(429, "limite diário da IA gratuita atingido; volte amanhã");

  const text = str(b.text, 500);
  const lang = b.lang === "pt" ? "pt" : "en";
  const [lesson] = await sql`select id, title, objective, content from english_ai.lessons where id = ${s.scenario}`;
  const [p] = await sql`select display_name, level, portuguese_support_pct from english_ai.profiles where user_id = ${userId}`;
  const hist = await sql`select speaker, text_content from english_ai.turns
                          where session_id = ${s.id} order by id desc limit 16`;
  const msgs: Msg[] = hist.reverse().map((t: any) => ({ role: t.speaker === "aluno" ? "user" : "model", text: t.text_content }));
  if (text) msgs.push({ role: "user", text: lang === "pt" ? `[em português] ${text}` : text });
  else msgs.push({ role: "user", text: "(The lesson starts now. Greet me by name and start the role-play.)" });
  // Gemini exige começar com "user"
  while (msgs.length && msgs[0].role !== "user") msgs.shift();

  const weak = await sql`select phrase_en from english_ai.learning_items
                          where user_id = ${userId} and (next_review_at <= now() + interval '1 day' or mastery < 50)
                          order by mastery, next_review_at limit 5`;
  const system = systemPrompt({ name: p?.display_name, level: p?.level ?? "iniciante_zero", lesson, ptPct: p?.portuguese_support_pct ?? 50,
    weak: weak.map((w: any) => w.phrase_en) });
  const { data, provider } = await askTeacher(system, msgs);
  const r = normalizeReply(data);

  await sql`insert into english_ai.usage_events (user_id, event_type, units, metadata)
            values (${userId}, 'ai_call', 1, ${sql.json({ provider, lesson: s.scenario })})`;
  if (text) {
    await sql`insert into english_ai.turns (session_id, user_id, speaker, text_content, pronunciation_score, correction, needed_portuguese_help)
              values (${s.id}, ${userId}, 'aluno', ${text}, ${r.score}, ${r.correction_en || null}, ${lang === "pt"})`;
  }
  await sql`insert into english_ai.turns (session_id, user_id, speaker, text_content, expected_phrase, translation_pt)
            values (${s.id}, ${userId}, 'professor', ${r.reply_en}, ${r.suggested_answer_en || null}, ${r.reply_pt || null})`;
  if (r.correction_en) await practiceItem(userId, r.correction_en, r.tip_pt || r.suggested_answer_pt || "", lang === "pt" ? 40 : Math.min(r.score, 60), s.scenario);
  for (const ph of r.new_phrases) {
    await sql`insert into english_ai.learning_items (user_id, phrase_en, meaning_pt, category, next_review_at, lesson_id)
              values (${userId}, ${ph.en}, ${ph.pt}, 'phrase', now() + interval '1 day', ${s.scenario})
              on conflict (user_id, phrase_en) do nothing`;
  }
  return { ...r, provider };
}

async function practice(userId: string, b: any) {
  const score = Math.max(0, Math.min(100, Math.round(Number(b.score) || 0)));
  const en = str(b.phrase_en, 200), pt = str(b.meaning_pt, 200), heard = str(b.heard, 300);
  const lessonId = str(b.lesson_id, 60) || null;
  if (b.session_id && heard) {
    const s = await ownSession(userId, b.session_id);
    await sql`insert into english_ai.turns (session_id, user_id, speaker, text_content, expected_phrase, translation_pt, pronunciation_score)
              values (${s.id}, ${userId}, 'aluno', ${heard}, ${en}, ${pt || null}, ${score})`;
  }
  if (b.track !== false) await practiceItem(userId, en, pt, score, lessonId);
  return { ok: true };
}

async function finish(userId: string, b: any) {
  const s = await ownSession(userId, b.session_id);
  const dur = Math.max(0, Math.min(4 * 3600, Math.round(Number(b.duration_seconds) || 0)));
  const score = Math.max(0, Math.min(100, Math.round(Number(b.score) || 0)));
  const done = b.completed !== false;
  await sql`update english_ai.sessions set status = ${done ? "concluida" : "abandonada"}, ended_at = now(),
              duration_seconds = ${dur}, speaking_score = ${score}, pronunciation_score = ${score},
              summary = ${sql.json(b.summary && typeof b.summary === "object" ? b.summary : {})}
            where id = ${s.id}`;
  if (done) {
    await sql`update english_ai.lesson_progress set status = 'concluida', completed_at = coalesce(completed_at, now()),
                best_score = greatest(coalesce(best_score, 0), ${score}), last_seen_at = now()
              where user_id = ${userId} and lesson_id = ${s.scenario}`;
    // o apoio em português começa alto e diminui a cada aula boa, até 20%
    if (score >= 60) await sql`update english_ai.profiles set portuguese_support_pct = greatest(20, portuguese_support_pct - 3), updated_at = now()
                               where user_id = ${userId}`;
  }
  await sql`insert into english_ai.usage_events (user_id, event_type, units, metadata)
            values (${userId}, 'practice_seconds', ${dur}, ${sql.json({ lesson: s.scenario })})`;
  return { stats: await stats(userId) };
}

async function review(userId: string) {
  const items = await sql`select phrase_en as en, meaning_pt as pt, mastery from english_ai.learning_items
                           where user_id = ${userId} and next_review_at <= now()
                           order by next_review_at limit 12`;
  return { items };
}

async function transcribe(userId: string, b: any) {
  const lim = await aiLimits(userId);
  if (!lim.enabled || lim.userLeft <= 0 || lim.globalLeft <= 0) throw new HttpError(503, "transcrição indisponível");
  const audio = typeof b.audio_b64 === "string" ? b.audio_b64 : "";
  if (!audio || audio.length > 4_000_000) throw new HttpError(400, "áudio inválido");
  const mime = str(b.mime, 60).split(";")[0] || "audio/webm";
  const lang = b.lang === "pt" ? "Portuguese" : "English";
  let text = "";
  if (GEMINI_KEY) {
    for (const model of GEMINI_MODELS) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [
            { inline_data: { mime_type: mime, data: audio } },
            { text: `Transcribe exactly what the speaker says (${lang}). Output only the transcription, no comments. If there is no speech, output nothing.` },
          ] }],
          generationConfig: { temperature: 0, maxOutputTokens: 300, ...(model.startsWith("gemini-2.5") ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
        }),
      });
      if (r.status === 404) continue;
      if (r.ok) { const d = await r.json(); text = d?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? ""; }
      break;
    }
  } else if (GROQ_KEY) {
    const bytes = Uint8Array.from(atob(audio), (c) => c.charCodeAt(0));
    const fd = new FormData();
    fd.append("file", new Blob([bytes], { type: mime }), "audio." + (mime.split("/")[1] || "webm"));
    fd.append("model", "whisper-large-v3-turbo");
    fd.append("language", b.lang === "pt" ? "pt" : "en");
    const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST", headers: { Authorization: `Bearer ${GROQ_KEY}` }, body: fd,
    });
    if (r.ok) text = (await r.json()).text ?? "";
  }
  await sql`insert into english_ai.usage_events (user_id, event_type, units, metadata)
            values (${userId}, 'ai_call', 1, ${sql.json({ kind: "transcribe" })})`;
  return { text: text.trim() };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ ok: true, service: "speakup-api", ai: aiAvailable() });
  try {
    const b = await req.json().catch(() => ({}));
    if (b.action === "hello") return json(await hello(b));
    const userId = await userFromToken(b.token);
    switch (b.action) {
      case "profile": return json(await saveProfile(userId, b));
      case "start": return json(await start(userId, b));
      case "turn": return json(await turn(userId, b));
      case "practice": return json(await practice(userId, b));
      case "finish": return json(await finish(userId, b));
      case "review": return json(await review(userId));
      case "transcribe": return json(await transcribe(userId, b));
      default: return json({ error: "ação desconhecida" }, 400);
    }
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, status);
  }
});
