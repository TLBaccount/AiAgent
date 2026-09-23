import { francAll } from 'franc';

const supabaseUrl = "https://pfmgkdpvqqvlznogfuzi.supabase.co";

// Clés internes : jamais montrées au LLM comme "informations"
const INTERNAL_KEYS = ["pause_messages", "ville_principale"];

// Cascade VISION : 3 fournisseurs (clés déjà dans Vercel, aucune inscription nouvelle)
const GEMINI_MODEL = "gemini-3.8-flash";
const GROQ_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
const OPENROUTER_MODEL = "qwen/qwen2.5-vl-72b-instruct:free";

// Sécurité anti-timeout Vercel : au max 3 informations enregistrées par photo
const MAX_SECRETS_SAVED = 3;

const MEMO_OK = {
    fr: "\n\n✅ J'ai bien enregistré ces informations en mémoire.",
    en: "\n\n✅ I've saved this information to memory.",
    ar: "\n\n✅ لقد حفظت هذه المعلومات في الذاكرة."
};
const MEMO_KO = {
    fr: "\n\n⚠️ Je n'ai rien pu enregistrer à partir de cette photo.",
    en: "\n\n⚠️ I couldn't save anything from this photo.",
    ar: "\n\n⚠️ لم أتمكن من حفظ أي شيء من هذه الصورة."
};

function checkAuth(req) {
    const code = process.env.SCOOP_WEB_CODE;
    if (!code) return true;
    return req.headers['x-scoop-code'] === code;
}

function isArabicScript(text) { return /[\u0600-\u06FF]/.test(text); }

// fetch avec garde-fou de temps (anti-blocage)
async function fetchT(url, options, ms) {
    const opts = Object.assign({}, options || {}, { signal: AbortSignal.timeout(ms) });
    return fetch(url, opts);
}

function extractReplyGemini(apiData) {
    let out = "";
    const cand = (apiData && apiData.candidates) || [];
    if (cand.length > 0 && cand[0].content && cand[0].content.parts) {
        for (const p of cand[0].content.parts) {
            if (p.text) out = out + p.text;
        }
    }
    return out.trim();
}

function extractReplyOpenAI(apiData) {
    const choices = (apiData && apiData.choices) || [];
    if (choices.length === 0) return "";
    const msg = choices[0].message || {};
    if (typeof msg.content === "string") return msg.content.trim();
    if (Array.isArray(msg.content)) {
        let out = "";
        for (const p of msg.content) { if (p.text) out = out + p.text; }
        return out.trim();
    }
    return "";
}

// ----- Fournisseur 1 : GEMINI (inline_data) -----
async function tryGemini(geminiKey, systemPrompt, instruction, mime, base64Img, ms, maxTokens) {
    try {
        const body = {
            contents: [{
                role: "user",
                parts: [
                    { inline_data: { mime_type: mime, data: base64Img } },
                    { text: instruction }
                ]
            }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
            generationConfig: { maxOutputTokens: maxTokens }
        };
        const r = await fetchT("https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODEL + ":generateContent?key=" + geminiKey, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        }, ms);
        if (!r.ok) {
            console.error("Vision Gemini -> " + r.status);
            return null;
        }
        const d = await r.json();
        const text = extractReplyGemini(d);
        return text ? text : null;
    } catch (e) {
        // Lent, bloqué ou coupé -> on laisse la cascade essayer le suivant
        console.error("Vision Gemini -> " + e.message);
        return null;
    }
}

// ----- Fournisseurs 2 et 3 : GROQ et OPENROUTER (format OpenAI, image en data-URI) -----
async function tryOpenAICompat(name, url, key, model, systemPrompt, instruction, mime, base64Img, ms, maxTokens) {
    try {
        const dataUri = "data:" + mime + ";base64," + base64Img;
        const body = {
            model: model,
            max_tokens: maxTokens,
            messages: [
                { role: "system", content: systemPrompt },
                {
                    role: "user",
                    content: [
                        { type: "text", text: instruction },
                        { type: "image_url", image_url: { url: dataUri } }
                    ]
                }
            ]
        };
        const headers = {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + key
        };
        if (name === "OpenRouter") {
            headers["HTTP-Referer"] = "https://ai-agent-tlb-agent.vercel.app";
            headers["X-Title"] = "Scoop";
        }
        const r = await fetchT(url, {
            method: "POST",
            headers: headers,
            body: JSON.stringify(body)
        }, ms);
        if (!r.ok) {
            const t = await r.text();
            console.error("Vision " + name + " (" + model + ") -> " + r.status + " " + t.substring(0, 150));
            return null;
        }
        const d = await r.json();
        const text = extractReplyOpenAI(d);
        return text ? text : null;
    } catch (e) {
        console.error("Vision " + name + " -> " + e.message);
        return null;
    }
}

// Cascade complète : renvoie { ok, text, provider }
async function callVisionCascade(geminiKey, groqKey, orKey, systemPrompt, instruction, mime, base64Img, maxTokens) {
    // 1) Gemini (meilleur OCR arabe/français) — 6s
    if (geminiKey) {
        const t = await tryGemini(geminiKey, systemPrompt, instruction, mime, base64Img, 6000, maxTokens);
        if (t) return { ok: true, text: t, provider: "Gemini" };
    }
    // 2) Groq (vision llama-4-scout) — 6s
    if (groqKey) {
        const t = await tryOpenAICompat("Groq", "https://api.groq.com/openai/v1/chat/completions", groqKey, GROQ_MODEL, systemPrompt, instruction, mime, base64Img, 6000, maxTokens);
        if (t) return { ok: true, text: t, provider: "Groq" };
    }
    // 3) OpenRouter (modèle gratuit) — 5s
    if (orKey) {
        const t = await tryOpenAICompat("OpenRouter", "https://openrouter.ai/api/v1/chat/completions", orKey, OPENROUTER_MODEL, systemPrompt, instruction, mime, base64Img, 5000, maxTokens);
        if (t) return { ok: true, text: t, provider: "OpenRouter" };
    }
    return { ok: false, text: "", provider: null };
}

// Extraction défensive du JSON (fonctionne même si le modèle met du texte autour)
function extractJson(text) {
    let c = String(text || "").replace(/```json/g, '').replace(/```/g, '').trim();
    const start = c.indexOf('{');
    const end = c.lastIndexOf('}');
    if (start !== -1 && end > start) c = c.substring(start, end + 1);
    try { return JSON.parse(c); } catch (e) { return null; }
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!checkAuth(req)) return res.status(401).json({ error: 'Accès refusé' });

    const { fileId, caption, channel } = req.body;
    const currentChannel = channel === "telegram" ? "telegram" : "web";
    const geminiKey = process.env.GOOGLE_AI_KEY;
    const groqKey = process.env.GROQ_API_KEY;
    const orKey = process.env.OPENROUTER_API_KEY;
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!fileId) return res.status(400).json({ error: 'Photo manquante' });
    if (!geminiKey && !groqKey && !orKey) {
        return res.status(200).json({ reply: "⚠️ Analyse de photos non configurée (aucune clé IA).", lang: "fr" });
    }

    try {
        // 1. Téléchargement de la photo (côté serveur, avec limites de temps)
        const fRes = await fetchT(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`, {}, 3000);
        const fData = await fRes.json();
        const filePath = fData.result.file_path;
        const imgRes = await fetchT(`https://api.telegram.org/file/bot${token}/${filePath}`, {}, 3000);
        const base64Img = Buffer.from(await imgRes.arrayBuffer()).toString('base64');

        const lower = String(filePath).toLowerCase();
        const mime = lower.endsWith('.png') ? 'image/png' : lower.endsWith('.webp') ? 'image/webp' : 'image/jpeg';

        // 2. Détection de la langue (légende)
        let lang = "fr";
        const capText = String(caption || "").trim();
        if (capText) {
            if (/[\u0600-\u06FF]/.test(capText)) {
                lang = "ar";
            } else {
                const guesses = francAll(capText, { minLength: 1 });
                const top = guesses.find(([code]) => code === 'fra' || code === 'eng');
                if (top && top[0] === 'eng') lang = 'en';
            }
        }

        // 3. MODES : fiche produit ? Memo/Val ?
        const isFicheMode = /\bfiche\b/i.test(capText);
        let ficheLang = null; // null = trilingue
        const ficheLangMatch = capText.match(/(?:^|\s)fiche\s+(ar|arabe|العربية|en|english|anglais|fr|français|francais)(?=\s|$)/iu);
        if (ficheLangMatch) {
            const w = ficheLangMatch[1].toLowerCase();
            if (w === 'ar' || w === 'arabe' || w === 'العربية') ficheLang = 'ar';
            else if (w === 'en' || w === 'english' || w === 'anglais') ficheLang = 'en';
            else ficheLang = 'fr';
        }

        const kwRegex = /(?<![\p{L}\p{N}_])(memo|val)(?![\p{L}\p{N}_])/giu;
        const kwMatches = capText.match(kwRegex) || [];
        const hasMemo = kwMatches.some(w => w.toLowerCase() === 'memo');
        const hasVal = kwMatches.some(w => w.toLowerCase() === 'val');
        const isMemoMode = hasMemo || hasVal;

        // 4. Mémoire (uniquement en mode normal)
        let publicText = "Aucune information connue.";
        let privateText = "";
        if (!isMemoMode && !isFicheMode) {
            const wantsSecrets = /\bscoop\b/i.test(capText);
            try {
                const sRes = await fetchT(`${supabaseUrl}/rest/v1/secrets?select=*`, {
                    headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` }
                }, 3000);
                const all = await sRes.json();
                if (Array.isArray(all)) {
                    const pub = all.filter(s => !s.is_secret && !INTERNAL_KEYS.includes(s.key));
                    if (pub.length > 0) publicText = pub.map(s => `${s.key}: ${s.value}`).join('\n');
                    if (wantsSecrets) {
                        const priv = all.filter(s => s.is_secret && !INTERNAL_KEYS.includes(s.key));
                        if (priv.length > 0) privateText = priv.map(s => `${s.key}: ${s.value}`).join('\n');
                    }
                }
            } catch (e) {}
        }

        // 5. Prompts (concaténation simple)
        const langName = lang === 'ar' ? 'ARABE' : lang === 'en' ? 'ANGLAIS' : 'FRANÇAIS';
        let instruction = "L'utilisateur a envoyé cette photo sans commentaire. Décris-la de façon claire et utile (sujet principal, texte visible important, montants et dates si présents).";
        if (capText) {
            instruction = "L'utilisateur a envoyé cette photo avec cette demande : \"" + capText + "\". Suis cette demande.";
        }

        let systemPrompt = "";
        let maxTokens = 700;

        if (isFicheMode) {
            // ===== MODE FICHE PRODUIT =====
            maxTokens = 1800;
            const ficheLangName = ficheLang === 'ar' ? 'ARABE' : ficheLang === 'en' ? 'ANGLAIS' : 'FRANÇAIS';
            systemPrompt = "Tu es Scoop, l'assistant personnel de Fateh, expert en vente e-commerce. Tu crées une FICHE PRODUIT à partir de la photo.\n\n";
            if (ficheLang) {
                systemPrompt += "LANGUE OBLIGATOIRE : écris TOUTE la fiche en " + ficheLangName + " uniquement.\n\n";
            } else {
                systemPrompt += "LANGUES OBLIGATOIRES : la fiche doit contenir TROIS versions complètes et séparées, dans cet ordre :\n";
                systemPrompt += "🇫🇷 FRANÇAIS — puis 🇩🇿 ARABE — puis 🇬🇧 ENGLISH.\n";
                systemPrompt += "Chaque version commence par son drapeau. Aucune langue mélangée dans une version.\n\n";
            }
            systemPrompt += "STRUCTURE DE CHAQUE VERSION :\n";
            systemPrompt += "- Titre accrocheur (max 80 caractères)\n";
            systemPrompt += "- Description : 3 phrases maximum\n";
            systemPrompt += "- 3 points forts avec des puces (• )\n";
            systemPrompt += "- Prix suggéré : une fourchette en DZD présentée comme ESTIMATION (ex: environ 2500–3500 DZD, à confirmer selon l'état et le marché)\n";
            systemPrompt += "- 5 hashtags pertinents\n\n";
            systemPrompt += "RÈGLES STRICTES :\n";
            systemPrompt += "- N'invente JAMAIS : marque, matière, dimensions, origine ou caractéristiques invisibles sur la photo.\n";
            systemPrompt += "- Mentionne clairement les défauts visibles (rayures, usure, taches...).\n";
            systemPrompt += "- Sois compact : TOUTE la fiche doit tenir en 3400 caractères maximum.\n";
            systemPrompt += "- Utilise les sauts de ligne pour aérer. Pas de tableau Markdown.";
        } else if (isMemoMode) {
            // ===== MODE MEMO/VAL : UN SEUL appel renvoie la réponse ET les informations =====
            maxTokens = 800;
            systemPrompt = "Tu es Scoop, l'assistant personnel de Fateh. Tu analyses UNE photo.\n\n";
            systemPrompt += "Tu réponds en JSON STRICT, rien d'autre que ce JSON :\n";
            systemPrompt += '{"reply": "...", "secrets": [{"key": "...", "value": "...", "is_secret": true}]}\n\n';
            systemPrompt += 'CONTENU DE "reply" :\n';
            systemPrompt += "- Ta réponse à la demande de la légende, en " + langName + " par défaut, ou dans la langue explicitement demandée par l'utilisateur.\n";
            systemPrompt += "- Précis, concis (max 12 lignes). Cite les éléments importants (montants, dates, noms) si la photo en contient.\n";
            systemPrompt += "- N'invente JAMAIS. Pas de confirmation d'enregistrement (elle est ajoutée automatiquement après).\n\n";
            systemPrompt += 'CONTENU DE "secrets" :\n';
            systemPrompt += '- Si la légende contient "Memo" : extrais les informations à enregistrer, is_secret = true.\n';
            systemPrompt += '- Si la légende contient "Val" : extrais, is_secret = false.\n';
            systemPrompt += "- Clés UNIQUES et descriptives (ex: facture_montant_eau, contact_nom).\n";
            systemPrompt += '- Uniquement ce qui est VISIBLE sur la photo. Si rien à enregistrer : "secrets": [].';
        } else {
            // ===== MODE NORMAL =====
            systemPrompt = "Tu es Scoop, l'assistant personnel de Fateh. Tu analyses UNE photo qu'il t'envoie.\n\n";
            systemPrompt += "RÈGLE DE LANGUE : par défaut, réponds entièrement en " + langName + ".\n";
            systemPrompt += 'EXCEPTION PRIORITAIRE : si la demande exige explicitement une autre langue (ex: "en AR", "in English", "réponds en espagnol"), obéis : réponds dans la langue demandée. Ne dis JAMAIS que tu ne peux pas.\n';
            systemPrompt += "- Chaleureux, précis, concis (max 15 lignes).\n";
            systemPrompt += "- Si la photo contient du texte (document, facture, panneau...), cite les
