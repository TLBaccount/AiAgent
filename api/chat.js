import { francAll } from 'franc';

const agentName = "Scoop";
const supabaseUrl = "https://pfmgkdpvqqvlznogfuzi.supabase.co";
const siteUrl = "https://ai-agent-tlb-agent.vercel.app";

// Ville par défaut ultime (si aucune ville principale enregistrée)
const VILLE_PRINCIPALE = "sidi bel abbes";

// Clés internes : jamais montrées au LLM comme "informations"
const INTERNAL_KEYS = ["pause_messages", "ville_principale"];

function checkAuth(req) {
    const code = process.env.SCOOP_WEB_CODE;
    if (!code) return true;
    return req.headers['x-scoop-code'] === code;
}

// ===== RÉGLAGES INTERNES (pause, ville principale...) =====
async function getInternalSetting(supabaseKey, key) {
    try {
        const r = await fetch(`${supabaseUrl}/rest/v1/secrets?key=eq.${key}&limit=1`, {
            headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` }
        });
        const d = await r.json();
        return (Array.isArray(d) && d.length > 0) ? String(d[0].value) : null;
    } catch (e) { return null; }
}

async function setInternalSetting(supabaseKey, key, value) {
    try {
        await fetch(`${supabaseUrl}/rest/v1/secrets?key=eq.${key}`, {
            method: "DELETE", headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` }
        });
        await fetch(`${supabaseUrl}/rest/v1/secrets`, {
            method: "POST",
            headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json", "Prefer": "return=minimal" },
            body: JSON.stringify({ user_id: "fatah", key: key, value: value, is_secret: false })
        });
    } catch (e) { console.error("Erreur setInternalSetting:", e.message); }
}

// Géocodage léger (validation du nom de ville)
async function geocodeCity(name) {
    try {
        const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=fr&format=json`);
        if (!r.ok) return null;
        const d = await r.json();
        if (Array.isArray(d.results) && d.results.length > 0) {
            const g = d.results[0];
            return { name: g.name, country: g.country || "", lat: g.latitude, lon: g.longitude };
        }
        return null;
    } catch (e) { return null; }
}

// ===== TEXTES DU WORKFLOW (multilingue) =====
const WF = {
    fr: {
        email: "📧 Email", calendar: "📅 Événement", share: "📊 Partage",
        confirmQ: "Confirmez-vous l'exécution ? Répondez oui ou non.",
        confirmed: "✅ Action exécutée avec succès !",
        cancelled: "❌ Brouillon annulé. Rien n'a été exécuté.",
        missing: "Il me manque :",
        pauseOn: "⏸️ Messages automatiques en pause. Dis « reprendre messages » pour les réactiver.",
        pauseOff: "▶️ Messages automatiques réactivés ! À demain matin ☀️",
        cityOk: "🏙️ Ville principale : {city} ✅",
        cityKo: "❌ Ville introuvable. Vérifie l'orthographe (ex: Oran, Tlemcen...).",
        lbl: { to: "À", subject: "Sujet", body: "Message", title: "Titre", date: "Date", time: "Heure", share_type: "Type", content: "Données" },
        fields: {
            to: "l'adresse email du destinataire", subject: "le sujet", body: "le contenu du message",
            title: "le titre de l'événement", date: "la date (ex: 30-09-26)", time: "l'heure (ex: 15:00)",
            share_type: "le type de partage (chart, json ou text)", content: "les données à partager"
        }
    },
    en: {
        email: "📧 Email", calendar: "📅 Event", share: "📊 Share",
        confirmQ: "Do you confirm execution? Reply yes or no.",
        confirmed: "✅ Action executed successfully!",
        cancelled: "❌ Draft cancelled. Nothing was executed.",
        missing: "I still need:",
        pauseOn: "⏸️ Automatic messages paused. Say \"resume messages\" to reactivate them.",
        pauseOff: "▶️ Automatic messages reactivated! See you tomorrow morning ☀️",
        cityOk: "🏙️ Main city: {city} ✅",
        cityKo: "❌ City not found. Check the spelling.",
        lbl: { to: "To", subject: "Subject", body: "Message", title: "Title", date: "Date", time: "Time", share_type: "Type", content: "Data" },
        fields: {
            to: "the recipient's email address", subject: "the subject", body: "the message content",
            title: "the event title", date: "the date (e.g. 30-09-26)", time: "the time (e.g. 15:00)",
            share_type: "the share type (chart, json or text)", content: "the data to share"
        }
    },
    ar: {
        email: "📧 بريد إلكتروني", calendar: "📅 حدث", share: "📊 مشاركة",
        confirmQ: "هل تؤكد التنفيذ؟ أجب بـ نعم أو لا.",
        confirmed: "✅ تم تنفيذ العملية بنجاح!",
        cancelled: "❌ تم إلغاء المسودة. لم يتم تنفيذ شيء.",
        missing: "ما زال ينقصني:",
        pauseOn: "⏸️ تم إيقاف الرسائل التلقائية مؤقتًا. قل « استئناف الرسائل » لإعادة تنشيطها.",
        pauseOff: "▶️ تمت إعادة تنشيط الرسائل التلقائية! إلى الغد صباحًا ☀️",
        cityOk: "🏙️ المدينة الرئيسية: {city} ✅",
        cityKo: "❌ لم يتم العثور على المدينة. تحقق من الإملاء.",
        lbl: { to: "إلى", subject: "الموضوع", body: "الرسالة", title: "العنوان", date: "التاريخ", time: "الوقت", share_type: "النوع", content: "البيانات" },
        fields: {
            to: "البريد الإلكتروني للمستلم", subject: "الموضوع", body: "محتوى الرسالة",
            title: "عنوان الحدث", date: "التاريخ (مثال: 30-09-26)", time: "الوقت (مثال: 15:00)",
            share_type: "نوع المشاركة (chart أو json أو text)", content: "البيانات للمشاركة"
        }
    }
};

const REQUIRED_FIELDS = {
    email: ["to", "subject", "body"],
    calendar: ["title", "date", "time"],
    share: ["share_type", "content"]
};

// Convertit une date saisie (30-09-26, 30/09/2026, 30.09.26, 2026-09-30) en YYYY-MM-DD pour Google Calendar
function normalizeDate(d) {
    if (!d) return d;
    const s = String(d).trim();
    let m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2}|\d{4})$/);
    if (m) {
        const dd = m[1].padStart(2, "0");
        const mm = m[2].padStart(2, "0");
        const yyyy = m[3].length === 2 ? "20" + m[3] : m[3];
        return `${yyyy}-${mm}-${dd}`;
    }
    m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
    if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    return s;
}

function missingFields(type, payload) {
    return (REQUIRED_FIELDS[type] || []).filter(f => !payload[f] || !String(payload[f]).trim());
}

function buildSummary(actionType, payload, lang) {
    const t = WF[lang] || WF.fr;
    const kind = t[actionType] || actionType;
    let lines = [];
    if (actionType === "email") {
        lines.push(`• ${t.lbl.to} : ${payload.to || ""}`);
        lines.push(`• ${t.lbl.subject} : ${payload.subject || ""}`);
        lines.push(`• ${t.lbl.body} : ${String(payload.body || "").substring(0, 150)}`);
    } else if (actionType === "calendar") {
        lines.push(`• ${t.lbl.title} : ${payload.title || ""}`);
        lines.push(`• ${t.lbl.date} : ${payload.date || ""}`);
        lines.push(`• ${t.lbl.time} : ${payload.time || ""}`);
    } else if (actionType === "share") {
        lines.push(`• ${t.lbl.share_type} : ${payload.share_type || ""}`);
        lines.push(`• ${t.lbl.content} : ${String(payload.content || "").substring(0, 100)}`);
    }
    return `${kind}\n${lines.join("\n")}\n\n${t.confirmQ}`;
}

function askMissing(actionType, payload, lang) {
    const t = WF[lang] || WF.fr;
    const missing = missingFields(actionType, payload);
    if (missing.length === 0) return buildSummary(actionType, payload, lang);
    const list = missing.map(f => t.fields[f]).join(", ");
    return `📝 ${t.missing} ${list}\n👉 ${t.fields[missing[0]]} ?`;
}

function isConfirmation(text) {
    return /^\s*(oui|yes|ok|d'accord|daccord|valide|validé|valider|confirme|confirmé|confirmer|confirm|go|exécute|execute)\s*[!.؟?]*\s*$/i.test(text.trim());
}

function isCancellation(text) {
    return /^\s*(non|no|annule|annuler|annulé|cancel|stop|abandonne|abandonner|arrête|arrete)\s*[!.؟?]*\s*$/i.test(text.trim());
}

// Commandes pause / reprise / ville principale (décidées par le SERVEUR)
function isPauseCmd(text) {
    return /^\s*(pause|stop|arrête|arrete|stoppe)(\s+(les\s+|le\s+)?(messages?|messagerie|auto(matiques)?))?\s*[!.]*\s*$/i.test(text.trim());
}
function isResumeCmd(text) {
    return /^\s*(reprends?|reprendre|réactive|reactive|resume|relance)(\s+(les\s+|le\s+)?(messages?|messagerie|auto(matiques)?))?\s*[!.]*\s*$/i.test(text.trim());
}
function matchCityCmd(text) {
    const m = text.trim().match(/^\s*(?:change(?:r|s|z)?(?:\s+ma)?\s+ville\s+principale(?:\s+(?:en|pour|à|:))?\s+|set\s+(?:my\s+)?(?:home|main)\s+city\s+(?:to)?\s*)([\p{L}\p{M}\s\-'’]+?)\s*[!.]*\s*$/iu);
    return m ? m[1].trim() : null;
}

// ===== CRUD BROUILLONS (pending_actions) =====
async function getPendingAction(supabaseKey) {
    try {
        const res = await fetch(`${supabaseUrl}/rest/v1/pending_actions?status=eq.draft&order=id.desc&limit=1`, {
            headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` }
        });
        const data = await res.json();
        if (!Array.isArray(data) || data.length === 0) return null;
        const row = data[0];
        const age = Date.now() - new Date(row.updated_at).getTime();
        if (age > 24 * 60 * 60 * 1000) {
            await deletePendingAction(supabaseKey, row.id);
            return null;
        }
        return row;
    } catch (e) { return null; }
}

async function savePendingAction(supabaseKey, actionType, payload) {
    try {
        await fetch(`${supabaseUrl}/rest/v1/pending_actions?status=eq.draft`, {
            method: "DELETE", headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` }
        });
        await fetch(`${supabaseUrl}/rest/v1/pending_actions`, {
            method: "POST",
            headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json", "Prefer": "return=minimal" },
            body: JSON.stringify({ action_type: actionType, payload: payload, status: "draft" })
        });
    } catch (e) { console.error("Erreur savePendingAction:", e.message); }
}

async function updatePendingAction(supabaseKey, id, payload) {
    try {
        await fetch(`${supabaseUrl}/rest/v1/pending_actions?id=eq.${id}`, {
            method: "PATCH",
            headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ payload: payload, updated_at: new Date().toISOString() })
        });
    } catch (e) { console.error("Erreur updatePendingAction:", e.message); }
}

async function deletePendingAction(supabaseKey, id) {
    try {
        await fetch(`${supabaseUrl}/rest/v1/pending_actions?id=eq.${id}`, {
            method: "DELETE", headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` }
        });
    } catch (e) { console.error("Erreur deletePendingAction:", e.message); }
}

// ===== EXÉCUTION (UNIQUEMENT après confirmation serveur) =====
async function executeWorkflowAction(actionType, payload) {
    try {
        if (actionType === "email") {
            const url = process.env.ACTIVEPIECES_EMAIL_URL;
            if (!url) return { ok: false, error: "URL email non configurée" };
            const r = await fetch(url, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: { to: payload.to, subject: payload.subject, body: payload.body }, type: "email", user: agentName })
            });
            let d = null; try { d = await r.json(); } catch (e) {}
            return { ok: r.ok, result: (d && d.result) || null };
        }
        if (actionType === "calendar") {
            const url = process.env.ACTIVEPIECES_CALENDAR_URL;
            if (!url) return { ok: false, error: "URL calendrier non configurée" };
            const r = await fetch(url, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: { title: payload.title, date: normalizeDate(payload.date), time: payload.time }, type: "calendar", user: agentName })
            });
            let d = null; try { d = await r.json(); } catch (e) {}
            return { ok: r.ok, result: (d && d.result) || null };
        }
        if (actionType === "share") {
            let parsed;
            try { parsed = JSON.parse(payload.content); } catch (e) { return { ok: false, error: "Données invalides (JSON)" }; }
            const r = await fetch(`${siteUrl}/api/share`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ type: payload.share_type, data: parsed, title: payload.title || "" })
            });
            const d = await r.json();
            if (d.share_url) {
                const s = await fetch(`${siteUrl}/api/shorten`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ url: d.share_url })
                });
                const sd = await s.json();
                return { ok: true, result: `Lien ${d.tool} : ${sd.short_url || d.share_url}` };
            }
            return { ok: false, error: d.error || "Échec du partage" };
        }
        return { ok: false, error: "Type d'action inconnu" };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

// ===== MÉTÉO : outil get_weather (lecture seule) =====
async function fetchWeatherData(req, args, currentChannel, savedPos, homeCity) {
    const params = new URLSearchParams();
    if (args && args.lat && args.lon) {
        params.set("lat", String(args.lat));
        params.set("lon", String(args.lon));
    } else if (args && args.place && String(args.place).trim()) {
        params.set("place", String(args.place).trim());
    } else if (savedPos) {
        // position partagée sur Telegram (la plus précise)
        params.set("lat", String(savedPos.lat));
        params.set("lon", String(savedPos.lon));
        params.set("place_name", "Position actuelle");
    } else {
        // "ici" : géoloc auto par Vercel (uniquement depuis le SITE WEB), sinon ville principale
        const vLat = currentChannel === "web" ? req.headers["x-vercel-ip-latitude"] : null;
        const vLon = currentChannel === "web" ? req.headers["x-vercel-ip-longitude"] : null;
        if (vLat && vLon) {
            params.set("lat", String(vLat));
            params.set("lon", String(vLon));
            let ville = "Position actuelle";
            try { ville = decodeURIComponent(String(req.headers["x-vercel-ip-city"] || ville)); } catch (e) {}
            params.set("place_name", ville);
        } else {
            params.set("place", homeCity || VILLE_PRINCIPALE);
        }
    }
    if (args && (args.want_air === true || args.want_air === "true")) params.set("air", "1");
    if (args && (args.want_marine === true || args.want_marine === "true")) params.set("marine", "1");
    const r = await fetch(`${siteUrl}/api/weather?${params.toString()}`);
    return await r.json();
}

function formatWeatherFallback(d) {
    if (!d || d.error || !Array.isArray(d.meteo) || d.meteo.length === 0) {
        return `❌ Météo indisponible${d && d.error ? " : " + d.error : ""}`;
    }
    const lines = [];
    for (const m of d.meteo) {
        lines.push(`📍 ${m.ville}${m.pays ? " (" + m.pays + ")" : ""} : ${m.maintenant.temp_c}°C, ${m.maintenant.temps}`);
        lines.push(`   Aujourd'hui : ${m.aujourdhui.min_c}–${m.aujourdhui.max_c}°C, pluie ${m.aujourdhui.pluie_pct}%, rafales ${m.aujourdhui.rafales_kmh} km/h, UV ${m.aujourdhui.uv_max}`);
        lines.push(`   Demain : ${m.demain.min_c}–${m.demain.max_c}°C, pluie ${m.demain.pluie_pct}%, ${m.demain.temps}`);
    }
    if (d.air) lines.push(`🌿 Air : indice ${d.air.aqi_europeen} — ${d.air.qualite}`);
    if (d.mer) lines.push(`🌊 Mer : vagues ${d.mer.hauteur_vagues_m} m — ${d.mer.etat}`);
    return lines.join("\n");
}

// Réponse naturelle dans la langue de l'utilisateur (2e passage LLM)
async function narrateWeather(d, userMessage, lang) {
    try {
        const groqKey = process.env.GROQ_API_KEY;
        if (!groqKey) return null;
        const langName = lang === 'ar' ? 'ARABE' : lang === 'en' ? 'ANGLAIS' : 'FRANÇAIS';
        const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${groqKey}` },
            body: JSON.stringify({
                model: "openai/gpt-oss-20b",
                reasoning_effort: "low",
                messages: [
                    { role: "system", content: `Tu es Scoop, l'assistant personnel dévoué de Fateh (utilisateur unique). Réponds EXCLUSIVEMENT en ${langName}. Utilise les données météo JSON fournies pour répondre naturellement à sa question : courte, chaleureuse, personnelle, avec UN conseil pratique basé sur air/vent/pluie/UV/vagues. Ne montre JAMAIS le JSON brut. Max 8 lignes.` },
                    { role: "user", content: `Données météo : ${JSON.stringify(d)}\n\nQuestion de Fateh : ${userMessage}` }
                ]
            })
        });
        if (!r.ok) return null;
        const txt = (await r.json()).choices[0].message.content.trim();
        return txt || null;
    } catch (e) { return null; }
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!checkAuth(req)) return res.status(401).json({ error: 'Accès refusé' });

    const { forcedLang, channel } = req.body;
    const currentChannel = channel === "telegram" ? "telegram" : "web";
    res.scoopChannel = currentChannel;
    let userMessage = String(req.body.message || '').trim();
    if (!userMessage) return res.status(400).json({ error: 'Message manquant' });

    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    await cleanupIfNeeded(supabaseUrl, supabaseKey);

    // DÉTECTION DE LA LANGUE
    let currentLang = forcedLang;
    const prefixMatch = userMessage.match(/^\[(fr|en|ar)\]\s*/i);
    if (prefixMatch) {
        currentLang = prefixMatch[1].toLowerCase();
        userMessage = userMessage.replace(/^\[(fr|en|ar)\]\s*/i, '').trim();
    }
    if (!currentLang) {
        if (/[\u0600-\u06FF]/.test(userMessage)) {
            currentLang = 'ar';
        } else {
            const guesses = francAll(userMessage, { minLength: 1 });
            const top = guesses.find(([code]) => code === 'fra' || code === 'eng');
            currentLang = top && top[0] === 'eng' ? 'en' : 'fr';
        }
    }

    // Raccourci "Scoop, quelle heure..."
    const lowerMsg = userMessage.toLowerCase();
    if (lowerMsg.includes(agentName.toLowerCase()) &&
        (lowerMsg.includes("quelle heure") || lowerMsg.includes("what time") || lowerMsg.includes("الساعة"))) {
        const heure = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Algiers' });
        return respond(res, supabaseKey, userMessage, `Il est actuellement ${heure}.`, "fr");
    }

    // Mots-clés Memo / Val
    const kwRegex = /(?<![\p{L}\p{N}_])(memo|val)(?![\p{L}\p{N}_])/giu;
    const kwMatches = userMessage.match(kwRegex) || [];
    const hasMemoKeyword = kwMatches.some(w => w.toLowerCase() === 'memo');
    const hasValKeyword = kwMatches.some(w => w.toLowerCase() === 'val');
    const shouldExtractSecrets = hasMemoKeyword || hasValKeyword;

    // Les secrets ne sortent QUE si l'utilisateur dit "Scoop"
    const wantsSecrets = /\bscoop\b/i.test(userMessage);

    const secrets = await getSecrets(supabaseKey);
    // Filtre des réglages internes : ce ne sont pas des "informations" à montrer
    const publicInfo = Array.isArray(secrets) ? secrets.filter(s => !s.is_secret && !INTERNAL_KEYS.includes(s.key)) : [];
    const privateSecrets = wantsSecrets && Array.isArray(secrets) ? secrets.filter(s => s.is_secret) : [];
    const publicText = publicInfo.length > 0 ? publicInfo.map(s => `${s.key}: ${s.value}`).join('\n') : "Aucune information connue.";
    const privateText = privateSecrets.length > 0 ? privateSecrets.map(s => `${s.key}: ${s.value}`).join('\n') : "Aucun secret enregistré.";

    // Historique côté serveur (20 derniers messages du canal)
    let fullHistory = [];
    try {
        const hRes = await fetch(`${supabaseUrl}/rest/v1/messages?select=*&order=id.desc&limit=20&channel=eq.${currentChannel}`, {
            headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` }
        });
        const hData = await hRes.json();
        if (Array.isArray(hData)) fullHistory = hData.reverse().map(m => ({ role: m.role, content: m.content }));
    } catch (e) { console.error("Erreur historique:", e.message); }

    try {
        if (shouldExtractSecrets) {
            const forceSecret = hasMemoKeyword ? true : false;
            await extractSecrets(userMessage, "", supabaseKey, forceSecret);
        }

        // ===== COMMANDES SYSTÈME (décidées par le SERVEUR, avant tout le reste) =====
        const t = WF[currentLang] || WF.fr;

        // PAUSE messages automatiques
        if (isPauseCmd(userMessage)) {
            await setInternalSetting(supabaseKey, "pause_messages", "true");
            return respond(res, supabaseKey, userMessage, t.pauseOn, currentLang);
        }
        // REPRISE messages automatiques
        if (isResumeCmd(userMessage)) {
            await setInternalSetting(supabaseKey, "pause_messages", "false");
            return respond(res, supabaseKey, userMessage, t.pauseOff, currentLang);
        }
        // VILLE PRINCIPALE
        const newCity = matchCityCmd(userMessage);
        if (newCity) {
            const g = await geocodeCity(newCity);
            if (g) {
                await setInternalSetting(supabaseKey, "ville_principale", g.name);
                return respond(res, supabaseKey, userMessage, t.cityOk.replace("{city}", `${g.name}${g.country ? ", " + g.country : ""}`), currentLang);
            }
            return respond(res, supabaseKey, userMessage, t.cityKo, currentLang);
        }

        // ===== WORKFLOW : BROUILLON EN COURS ? =====
        const pending = await getPendingAction(supabaseKey);

        // 1) ANNULATION (décidée par le SERVEUR, pas le LLM)
        if (pending && isCancellation(userMessage)) {
            await deletePendingAction(supabaseKey, pending.id);
            return respond(res, supabaseKey, userMessage, t.cancelled, currentLang);
        }

        // 2) CONFIRMATION (décidée par le SERVEUR, pas le LLM)
        if (pending && isConfirmation(userMessage)) {
            const missing = missingFields(pending.action_type, pending.payload || {});
            if (missing.length > 0) {
                return respond(res, supabaseKey, userMessage, askMissing(pending.action_type, pending.payload || {}, currentLang), currentLang);
            }
            const exec = await executeWorkflowAction(pending.action_type, pending.payload || {});
            await deletePendingAction(supabaseKey, pending.id);
            const reply = exec.ok ? (exec.result ? `✅ ${exec.result}` : t.confirmed) : `❌ ${exec.error || "Échec de l'action."}`;
            return respond(res, supabaseKey, userMessage, reply, currentLang);
        }

        const formatRules = currentChannel === "telegram"
            ? `
RÈGLE DE FORMATAGE POUR TELEGRAM (TRÈS STRICTE) :
- N'utilise JAMAIS de titres (###), de tableaux (| |), ni de HTML.
- Utilise *gras*, _italique_, \`code\`.
- Utilise des listes à puces avec "• ".
- Utilise des emojis pour structurer : 📌, ✅, ❌, 📊, 🔗, 🎯.
- Reste concis et aéré.`
            : `
RÈGLE DE FORMATAGE POUR LE WEB :
- Tu peux utiliser des tableaux Markdown (| |), des titres (###), du gras (**).
- Utilise des listes à puces et des sauts de ligne.`;

        const workflowRules = `
RÈGLE ABSOLUE DES ACTIONS (WORKFLOW) :
- send_email / create_event / share_data ne s'exécutent JAMAIS directement : l'outil CRÉE UN BROUILLON.
- Pour les dates, DEMANDE à l'utilisateur le format JJ-MM-AA (ex: 30-09-26).
- Pose UNE SEULE question à la fois pour obtenir les champs manquants. N'invente JAMAIS une valeur.
- Le système affiche le résumé et demande la confirmation (oui/non) : géré automatiquement.
- Les confirmations et annulations ("oui", "non", "annule") sont gérées par le système : ne les traite pas toi-même.`;

        const dataShareRules = `
🎯 RÈGLE POUR "share_data" :
Tu ne dois proposer un partage QUE si l'utilisateur demande EXPLICITEMENT un tableau, un graphique ou un partage (mots-clés : "tableau", "csv", "graphique", "camembert", "partage", "lien", "export").
FORMAT (data_json = chaîne JSON) :
- "chart" : {"chartType": "bar", "labels": ["Jan"], "datasets": [{"label": "Ventes", "data": [10]}]}
- "json" : {"headers": ["Col1"], "rows": [["a"]]}
- "text" : {"content": "Note 1\\nNote 2"}`;

        const systemPrompt = `Tu es Scoop, un assistant personnel multilingue.

RÈGLE DE LANGUE : Par défaut, réponds entièrement en ${currentLang === 'ar' ? 'ARABE' : currentLang === 'en' ? 'ANGLAIS' : 'FRANÇAIS'}.
EXCEPTION PRIORITAIRE : si l'utilisateur demande explicitement une autre langue (ex: "en AR", "réponds en anglais", "in English", "بالعربية", "en español"), sa demande est PRIORITAIRE : réponds alors entièrement dans cette langue, même si elle n'est pas dans ta liste. Ne dis JAMAIS que tu ne peux pas répondre dans une langue.

RÈGLE ANTI-RÉPÉTITION : Si l'utilisateur redemande la même chose, tu DOIS redonner la MÊME réponse. Ne dis JAMAIS "je ne peux pas répéter".

RÈGLE DES MOTS-CLÉS "MEMO" ET "VAL" :
- "Memo" = ENREGISTRER une information SECRÈTE. "Val" = ENREGISTRER une information PUBLIQUE.
- Si le message en contient un → CONFIRME l'enregistrement SANS répéter le mot-clé.

RÈGLE DES OUTILS :
- get_weather : OBLIGATOIRE pour toute question météo, temps, température, pluie, vent, UV, qualité de l'air, mer, vagues (pas besoin d'ordre explicite).
- send_email : UNIQUEMENT si "envoie un email à X" (crée un brouillon).
- create_event : UNIQUEMENT si "ajoute un événement" (crée un brouillon).
- search_web : UNIQUEMENT si "cherche", "recherche" (exécution directe, lecture seule).
- shorten_url : raccourcit une URL.
- share_data : UNIQUEMENT si demande EXPLICITE de tableau/graphique/partage (crée un brouillon).
- "mon adresse mail est X" → NE PAS appeler send_email.
- Ne mélange JAMAIS les langues.

RÈGLE DES SECRETS :
- Les informations NON-SECRÈTES ci-dessous sont PUBLIQUES : donne-les sans condition.
- Les SECRETS ne sont révélés QUE si l'utilisateur dit "Scoop".

INFORMATIONS (non-secrètes) :
${publicText}

SECRETS (protégés par "Scoop") :
${privateText}
${workflowRules}
${dataShareRules}
${formatRules}`;

        // Prompt spécial mode brouillon (l'utilisateur complète/modifie)
        const draftPrompt = pending ? `Tu es Scoop. Un BROUILLON est en cours : ${pending.action_type}.
Données actuelles du brouillon : ${JSON.stringify(pending.payload || {})}
Champs obligatoires : ${(REQUIRED_FIELDS[pending.action_type] || []).join(", ")}

TON RÔLE :
- Si l'utilisateur fournit une info ou modifie quelque chose → appelle l'outil draft_action avec TOUS les champs qu'il donne.
- N'invente JAMAIS une valeur manquante.
- Si l'utilisateur pose une question sur le brouillon → réponds en texte, sans outil.
- La confirmation ("oui") et l'annulation sont gérées automatiquement par le système.
- Pose UNE SEULE question à la fois.
- Réponds en ${currentLang === 'ar' ? 'ARABE' : currentLang === 'en' ? 'ANGLAIS' : 'FRANÇAIS'} par défaut, ou dans la langue explicitement demandée par l'utilisateur.
- Ne répète jamais les mots-clés Memo/Val.` : null;

        const tools = [
            { type: "function", function: { name: "get_weather", description: "OBLIGATOIRE pour toute question météo (temps, température, pluie, vent, UV), qualité de l'air (courir, sport, camping) ou mer/vagues. Lieu : mets le nom de ville si l'utilisateur le précise ; s'il dit 'ici'/'ma position' ou ne précise pas, laisse place vide. want_air=true si sport/air/santé ; want_marine=true si mer/vagues/plage/pêche.", parameters: { type: "object", properties: { place: { type: "string", description: "Nom de la ville OU vide pour la position actuelle" }, lat: { type: "string" }, lon: { type: "string" }, want_air: { type: "boolean" }, want_marine: { type: "boolean" } }, required: [] } } },
            { type: "function", function: { name: "send_email", description: "Crée un BROUILLON d'email (ne s'exécute pas directement, confirmation requise).", parameters: { type: "object", properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } }, required: [] } } },
            { type: "function", function: { name: "create_event", description: "Crée un BROUILLON d'événement (ne s'exécute pas directement, confirmation requise). Date au format JJ-MM-AA.", parameters: { type: "object", properties: { title: { type: "string" }, date: { type: "string" }, time: { type: "string" } }, required: [] } } },
            { type: "function", function: { name: "search_web", description: "Cherche sur Internet UNIQUEMENT si l'utilisateur donne un ordre explicite.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
            { type: "function", function: { name: "shorten_url", description: "Raccourcit une URL longue.", parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } } },
            { type: "function", function: { name: "share_data", description: "Crée un BROUILLON de partage (ne s'exécute pas directement, confirmation requise).", parameters: { type: "object", properties: { type: { type: "string", description: "Type : 'chart', 'json', ou 'text'" }, title: { type: "string" }, data_json: { type: "string" } }, required: [] } } }
        ];

        const draftTools = [
            { type: "function", function: { name: "draft_action", description: "Met à jour le brouillon en cours avec les informations fournies par l'utilisateur.", parameters: { type: "object", properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" }, title: { type: "string" }, date: { type: "string" }, time: { type: "string" }, share_type: { type: "string" }, content: { type: "string" } }, required: [] } } },
            { type: "function", function: { name: "cancel_action", description: "Annule le brouillon en cours.", parameters: { type: "object", properties: {}, required: [] } } }
        ];

        const activePrompt = pending ? draftPrompt : systemPrompt;
        const activeTools = pending ? draftTools : tools;

        let response = null;
        let provider = null;

        // TENTATIVE 1 : GEMINI (seulement hors brouillon — pas de tools)
        if (!pending) {
            const geminiKey = process.env.GOOGLE_AI_KEY;
            if (geminiKey) {
                try {
                    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${geminiKey}`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            contents: [{ role: "user", parts: [{ text: userMessage }] }],
                            systemInstruction: { parts: [{ text: activePrompt }] }
                        })
                    });
                    if (response.ok) provider = "Gemini";
                    else { console.error(`Gemini a échoué (${response.status})`); response = null; }
                } catch (e) { console.error("Erreur Gemini:", e.message); response = null; }
            }
        }

        // TENTATIVE 2 : GROQ
        if (!provider) {
            const groqKey = process.env.GROQ_API_KEY;
            if (groqKey) {
                try {
                    response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                        method: "POST",
                        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${groqKey}` },
                        body: JSON.stringify({
                            model: "openai/gpt-oss-20b",
                            messages: [{ role: "system", content: activePrompt }, ...fullHistory, { role: "user", content: userMessage }],
                            tools: activeTools,
                            tool_choice: "auto"
                        })
                    });
                    if (response.ok) provider = "Groq";
                    else { console.error(`Groq a échoué (${response.status})`); response = null; }
                } catch (e) { console.error("Erreur Groq:", e.message); response = null; }
            }
        }

        // TENTATIVE 3 : OPENROUTER
        if (!provider) {
            const openrouterKey = process.env.OPENROUTER_API_KEY;
            if (openrouterKey) {
                try {
                    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                        method: "POST",
                        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${openrouterKey}` },
                        body: JSON.stringify({
                            model: process.env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free",
                            messages: [{ role: "system", content: activePrompt }, ...fullHistory, { role: "user", content: userMessage }],
                            tools: activeTools,
                            tool_choice: "auto"
                        })
                    });
                    if (response.ok) provider = "OpenRouter";
                    else { console.error(`OpenRouter a échoué (${response.status})`); response = null; }
                } catch (e) { console.error("Erreur OpenRouter:", e.message); response = null; }
            }
        }

        if (!provider) throw new Error("Aucun fournisseur LLM n'a répondu");
        console.log(`Réponse obtenue via ${provider}`);

        const data = await response.json();
        let botText = "";

        if (provider === "Gemini") {
            botText = data.candidates[0].content.parts[0].text.trim();
        } else {
            const responseMessage = data.choices[0].message;

            if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
                const toolCall = responseMessage.tool_calls[0];
                const functionName = toolCall.function.name;
                let functionArgs = {};
                try { functionArgs = JSON.parse(toolCall.function.arguments || "{}"); } catch (e) {}

                // ===== MODE BROUILLON : draft_action / cancel_action =====
                if (pending) {
                    if (functionName === "cancel_action") {
                        await deletePendingAction(supabaseKey, pending.id);
                        return respond(res, supabaseKey, userMessage, t.cancelled, currentLang);
                    }
                    if (functionName === "draft_action") {
                        const newPayload = { ...(pending.payload || {}) };
                        for (const [k, v] of Object.entries(functionArgs)) {
                            if (v && String(v).trim()) newPayload[k] = String(v).trim();
                        }
                        await updatePendingAction(supabaseKey, pending.id, newPayload);
                        return respond(res, supabaseKey, userMessage, askMissing(pending.action_type, newPayload, currentLang), currentLang);
                    }
                    botText = String(responseMessage.content || "").trim();
                } else {
                    // ===== MODE NORMAL =====
                    if (functionName === "shorten_url") {
                        const shortenRes = await fetch(`${siteUrl}/api/shorten`, {
                            method: "POST", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ url: functionArgs.url })
                        });
                        const shortenData = await shortenRes.json();
                        return respond(res, supabaseKey, userMessage, `🔗 Lien court : ${shortenData.short_url}`, currentLang);
                    }

                    // RECHERCHE : Tavily direct (lecture seule, exécution immédiate)
                    if (functionName === "search_web" && process.env.TAVILY_API_KEY) {
                        try {
                            const tavilyRes = await fetch("https://api.tavily.com/search", {
                                method: "POST",
                                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.TAVILY_API_KEY}` },
                                body: JSON.stringify({ query: functionArgs.query || userMessage, max_results: 4, search_depth: "basic" })
                            });
                            if (tavilyRes.ok) {
                                const tavilyData = await tavilyRes.json();
                                const results = tavilyData.results || [];
                                let replyText;
                                if (results.length > 0) {
                                    const labels = { fr: "🔎 Résultats pour", en: "🔎 Results for", ar: "🔎 نتائج البحث عن" };
                                    const label = labels[currentLang] || labels.fr;
                                    const top = results.map((r, i) => {
                                        const snippet = String(r.content || "").replace(/\s+/g, " ").substring(0, 180).trim();
                                        return `${i + 1}. ${r.title || "Lien"}\n${snippet}\n${r.url}`;
                                    }).join("\n\n");
                                    replyText = `${label} « ${functionArgs.query || userMessage} » :\n\n${top}`;
                                } else {
                                    replyText = currentLang === "en" ? "🔎 No results found." : currentLang === "ar" ? "🔎 لا توجد نتائج." : "🔎 Aucun résultat trouvé.";
                                }
                                return respond(res, supabaseKey, userMessage, replyText, currentLang);
                            }
                        } catch (e) { console.error("Erreur Tavily:", e.message); }
                    }

                    // MÉTÉO : exécution directe (lecture seule) + réponse naturelle
                    if (functionName === "get_weather") {
                        try {
                            // Position partagée sur Telegram (clé position_actuelle)
                            const posSecret = Array.isArray(secrets) ? secrets.find(s => s.key === "position_actuelle") : null;
                            let savedPos = null;
                            if (posSecret && String(posSecret.value).includes(",")) {
                                const parts = String(posSecret.value).split(",");
                                const la = parseFloat(parts[0]);
                                const lo = parseFloat(parts[1]);
                                if (!isNaN(la) && !isNaN(lo)) savedPos = { lat: la, lon: lo };
                            }
                            // Ville principale enregistrée (remplace la constante)
                            const homeSecret = Array.isArray(secrets) ? secrets.find(s => s.key === "ville_principale") : null;
                            const homeCity = homeSecret ? String(homeSecret.value) : VILLE_PRINCIPALE;
                            const wd = await fetchWeatherData(req, functionArgs, currentChannel, savedPos, homeCity);
                            const narr = await narrateWeather(wd, userMessage, currentLang);
                            const reply = narr || formatWeatherFallback(wd);
                            return respond(res, supabaseKey, userMessage, reply, currentLang);
                        } catch (e) {
                            return respond(res, supabaseKey, userMessage, `❌ Météo indisponible : ${e.message}`, currentLang);
                        }
                    }

                    // ===== ACTIONS : CRÉATION DE BROUILLON (jamais d'exécution directe) =====
                    let draftType = null;
                    let draftPayload = {};
                    if (functionName === "send_email") {
                        draftType = "email";
                        draftPayload = { to: functionArgs.to || "", subject: functionArgs.subject || "", body: functionArgs.body || "" };
                    } else if (functionName === "create_event") {
                        draftType = "calendar";
                        draftPayload = { title: functionArgs.title || "", date: functionArgs.date || "", time: functionArgs.time || "" };
                    } else if (functionName === "share_data") {
                        draftType = "share";
                        draftPayload = { share_type: functionArgs.type || "", content: functionArgs.data_json || "", title: functionArgs.title || "" };
                    }
                    if (draftType) {
                        for (const k of Object.keys(draftPayload)) {
                            if (!draftPayload[k]) delete draftPayload[k];
                        }
                        await savePendingAction(supabaseKey, draftType, draftPayload);
                        return respond(res, supabaseKey, userMessage, askMissing(draftType, draftPayload, currentLang), currentLang);
                    }
                }
            }
            botText = String(responseMessage.content || "").trim();
        }

        // Nettoyage qui PRÉSERVE les sauts de ligne
        botText = botText.replace(/\[\[LANG:(fr|en|ar)\]\]/g, "").trim();
        botText = botText.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
        botText = botText.replace(/(?<![\p{L}\p{N}_])(memo|val)(?![\p{L}\p{N}_])/giu, "").trim();
        botText = botText.replace(/[ \t]+/g, " ");
        botText = botText.replace(/\n{3,}/g, "\n\n");
        botText = botText.trim();

        return respond(res, supabaseKey, userMessage, botText, currentLang);

    } catch (error) {
        console.error("Erreur serveur:", error);
        return res.status(500).json({ error: "Erreur interne du serveur." });
    }
}

// Sauvegarde unique (user + assistant) puis réponse — avec canal
async function respond(res, supabaseKey, userText, botReply, lang) {
    try {
        await fetch(`${supabaseUrl}/rest/v1/messages`, {
            method: "POST",
            headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json", "Prefer": "return=minimal" },
            body: JSON.stringify([
                { role: "user", content: userText, channel: res.scoopChannel || "web" },
                { role: "assistant", content: botReply, channel: res.scoopChannel || "web" }
            ])
        });
    } catch (e) { console.error("Erreur sauvegarde:", e.message); }
    return res.status(200).json({ reply: botReply, lang });
}

function estimateTokens(text) { return Math.ceil(String(text || "").length / 4); }

async function cleanupIfNeeded(supabaseUrl, supabaseKey) {
    try {
        const res = await fetch(`${supabaseUrl}/rest/v1/messages?select=*&order=id.asc`, {
            headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` }
        });
        const messages = await res.json();
        if (!Array.isArray(messages)) return;
        const totalTokens = messages.reduce((sum, msg) => sum + estimateTokens(msg.content), 0);
        if (totalTokens > 12000 * 0.85) {
            const messagesToDelete = Math.floor(messages.length * 0.3);
            const idsToDelete = messages.slice(0, messagesToDelete).map(m => m.id);
            await fetch(`${supabaseUrl}/rest/v1/messages?id=in.(${idsToDelete.join(',')})`, {
                method: "DELETE",
                headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` }
            });
        }
    } catch (error) { console.error("Erreur nettoyage:", error); }
}

async function getSecrets(supabaseKey) {
    try {
        const res = await fetch(`${supabaseUrl}/rest/v1/secrets?select=*`, {
            headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` }
        });
        const data = await res.json();
        return Array.isArray(data) ? data : [];
    } catch (error) { return []; }
}

function isArabicScript(text) { return /[\u0600-\u06FF]/.test(text); }

async function upsertSecret(supabaseKey, userId, key, value, isSecret) {
    const scriptOfNew = isArabicScript(value) ? 'ar' : 'latin';
    const existingRes = await fetch(
        `${supabaseUrl}/rest/v1/secrets?user_id=eq.${userId}&key=eq.${encodeURIComponent(key)}`,
        { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
    );
    const existing = await existingRes.json();
    const match = Array.isArray(existing)
        ? existing.find(row => (isArabicScript(row.value) ? 'ar' : 'latin') === scriptOfNew)
        : null;
    if (match) {
        await fetch(`${supabaseUrl}/rest/v1/secrets?id=eq.${match.id}`, {
            method: "PATCH",
            headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ value: value, is_secret: isSecret })
        });
    } else {
        await fetch(`${supabaseUrl}/rest/v1/secrets`, {
            method: "POST",
            headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: userId, key: key, value: value, is_secret: isSecret })
        });
    }
}

async function extractSecrets(message, botReply, supabaseKey, forceSecret = false) {
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) return;
    try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${groqKey}` },
            body: JSON.stringify({
                model: "openai/gpt-oss-20b",
                reasoning_effort: "low",
                response_format: { type: "json_object" },
                messages: [
                    { role: "system", content: `Tu es un extracteur d'informations.
RÈGLE N°1 : Si le message contient "Memo" → extrais les infos en SECRÈTES (is_secret=true). Si "Val" → PUBLIQUES (is_secret=false). Sinon → {"secrets": []}.
RÈGLE N°2 : Clés uniques et descriptives (prenom_perso, email_femme, tel_mobile_perso_2...). Ne JAMAIS écraser une valeur existante avec une clé générique.
RÈGLE N°3 : Mobile par défaut → tel_mobile_XXX ; "fixe" explicite → tel_fixe_XXX ; "2ème numéro" → nouvelle clé _2.
Réponds en JSON : {"secrets": [{"key": "...", "value": "...", "is_secret": true}]}. Si rien : {"secrets": []}.` },
                    { role: "user", content: `Utilisateur: ${message}\nScoop: ${botReply}` }
                ]
            })
        });
        const data = await response.json();
        let content = String(data.choices[0].message.content || "").trim();
        content = content.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) content = jsonMatch[0];
        const parsed = JSON.parse(content);
        const secrets = parsed.secrets || [];
        for (const secret of secrets) {
            const finalIsSecret = forceSecret ? true : (secret.is_secret || false);
            await upsertSecret(supabaseKey, "fatah", secret.key, secret.value, finalIsSecret);
        }
    } catch (error) {
        console.error("Erreur extraction secrets:", error.message);
    }
}
