import { francAll } from 'franc';

const supabaseUrl = "https://pfmgkdpvqqvlznogfuzi.supabase.co";

// Clés internes : jamais montrées au LLM comme "informations"
const INTERNAL_KEYS = ["pause_messages", "ville_principale"];

// Cascade : 2 modèles max (si l'un est surchargé/503, on essaie le suivant)
const GEMINI_MODELS = ["gemini-3.8-flash", "gemini-3.5-flash-lite"];

// Confirmations Memo (ajoutées seulement si la sauvegarde a RÉUSSI)
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

// fetch avec garde-fou de temps (anti-blocage → plus jamais le timeout 30s)
async function fetchT(url, options, ms) {
    const opts = Object.assign({}, options || {}, { signal: AbortSignal.timeout(ms) });
    return fetch(url, opts);
}

// Appel Gemini : cascade de modèles + timeout par tentative
async function callGemini(geminiKey, body) {
    let lastStatus = 0;
    let lastText = "";
    for (const model of GEMINI_MODELS) {
        const url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + geminiKey;
        try {
            const r = await fetchT(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            }, 7000);
            if (r.ok) {
                const d = await r.json();
                return { ok: true, data: d };
            }
            lastStatus = r.status;
            lastText = await r.text();
            console.error("Vision: modele " + model + " -> " + r.status);
        } catch (e) {
            lastStatus = 0;
            lastText = String(e.message);
            console.error("Vision: modele " + model + " -> " + e.message);
        }
    }
    return { ok: false, status: lastStatus, text: lastText };
}

function extractReplyText(apiData) {
    let out = "";
    const cand = (apiData && apiData.candidates) || [];
    if (cand.length > 0 && cand[0].content && cand[0].content.parts) {
        for (const p of cand[0].content.parts) {
            if (p.text) out = out + p.text;
        }
    }
    return out.trim();
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!checkAuth(req)) return res.status(401).json({ error: 'Accès refusé' });

    const { fileId, caption, channel } = req.body;
    const currentChannel = channel === "telegram" ? "telegram" : "web";
    const geminiKey = process.env.GOOGLE_AI_KEY;
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!fileId) return res.status(400).json({ error: 'Photo manquante' });
    if (!geminiKey) return res.status(200).json({ reply: "⚠️ Analyse de photos non configurée (clé Google absente).", lang: "fr" });

    try {
        // 1. Téléchargement de la photo (côté serveur, avec limites de temps)
        const fRes = await fetchT(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`, {}, 4000);
        const fData = await fRes.json();
        const filePath = fData.result.file_path;
        const imgRes = await fetchT(`https://api.telegram.org/file/bot${token}/${filePath}`, {}, 6000);
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

        // 3. Memo / Val (mots-clés dans la LÉGENDE, valeurs lues dans la PHOTO)
        const kwRegex = /(?<![\p{L}\p{N}_])(memo|val)(?![\p{L}\p{N}_])/giu;
        const kwMatches = capText.match(kwRegex) || [];
        const hasMemo = kwMatches.some(w => w.toLowerCase() === 'memo');
        const hasVal = kwMatches.some(w => w.toLowerCase() === 'val');
        const isMemoMode = hasMemo || hasVal;

        // 4. Mémoire (uniquement en mode normal ; en mode Memo on économise le temps)
        let publicText = "Aucune information connue.";
        let privateText = "";
        if (!isMemoMode) {
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

        // 5. Prompt + corps de la requête
        const langName = lang === 'ar' ? 'ARABE' : lang === 'en' ? 'ANGLAIS' : 'FRANÇAIS';
        let instruction = "L'utilisateur a envoyé cette photo sans commentaire. Décris-la de façon claire et utile (sujet principal, texte visible important, montants et dates si présents).";
        if (capText) {
            instruction = `L'utilisateur a envoyé cette photo avec cette demande : "${capText}". Suis cette demande.`;
        }

        let systemPrompt;
        const geminiBody = {
            contents: [{
                role: "user",
                parts: [
                    { inline_data: { mime_type: mime, data: base64Img } },
                    { text: instruction }
                ]
            }]
        };

        if (isMemoMode) {
            // MODE MEMO/VAL : UN SEUL appel renvoie la réponse ET les informations à enregistrer
            systemPrompt = `Tu es Scoop, l'assistant personnel de Fateh. Tu analyses UNE photo qu'il t'envoie.\n\n`;
            systemPrompt += `Tu réponds en JSON STRICT, rien d'autre que ce JSON :\n`;
            systemPrompt += `{"reply": "...", "secrets": [{"key": "...", "value": "...", "is_secret": true}]}\n\n`;
            systemPrompt += `CONTENU DE "reply" :\n`;
            systemPrompt += `- Ta réponse à la demande de la légende, EXCLUSIVEMENT en ${langName}.\n`;
            systemPrompt += `- Chaleureux, précis, concis (max 12 lignes).\n`;
            systemPrompt += `- Si la photo contient du texte (document, facture, panneau...), cite les éléments importants (montants, dates, noms).\n`;
            systemPrompt += `- N'invente JAMAIS ce que tu ne vois pas. Pas de confirmation d'enregistrement (elle est ajoutée automatiquement après).\n\n`;
            systemPrompt += `CONTENU DE "secrets" :\n`;
            systemPrompt += `- Si la légende contient "Memo" : extrais les informations à enregistrer, is_secret = true.\n`;
            systemPrompt += `- Si la légende contient "Val" : extrais, is_secret = false.\n`;
            systemPrompt += `- Clés UNIQUES et descriptives (ex: facture_montant_eau, contact_nom).\n`;
            systemPrompt += `- Uniquement ce qui est VISIBLE sur la photo. Si rien à enregistrer : "secrets": [].`;
            geminiBody.generationConfig = { temperature: 0.3, responseMimeType: "application/json" };
        } else {
            // MODE NORMAL : réponse conversationnelle
            systemPrompt = `Tu es Scoop, l'assistant personnel de Fateh. Tu analyses UNE photo qu'il t'envoie.\n\n`;
            systemPrompt += `RÈGLE ABSOLUE : réponds EXCLUSIVEMENT en ${langName}.\n`;
            systemPrompt += `- Chaleureux, précis, concis (max 15 lignes).\n`;
            systemPrompt += `- Si la photo contient du texte (document, facture, panneau...), cite les éléments importants (montants, dates, noms).\n`;
            systemPrompt += `- N'invente JAMAIS ce que tu ne vois pas.\n`;
            systemPrompt += `- INTERDIT : parler d'envoi d'email, d'agenda ou d'exécution d'action à cause de la photo.\n\n`;
            systemPrompt += `INFORMATIONS (non-secrètes) :\n${publicText}\n`;
            if (privateText) {
                systemPrompt += `\nSECRETS (protégés) :\n${privateText}\n`;
            }
        }
        geminiBody.systemInstruction = { parts: [{ text: systemPrompt }] };

        // 6. Appel Gemini (cascade)
        const gRes = await callGemini(geminiKey, geminiBody);
        if (!gRes.ok) {
            console.error("Vision final:", gRes.status, String(gRes.text).substring(0, 300));
            return res.status(200).json({ reply: "❌ Le service d'analyse d'images est surchargé pour l'instant. Renvoie la photo dans quelques minutes.", lang: lang });
        }

        // 7. Lecture de la réponse
        const rawText = extractReplyText(gRes.data);
        let botText = "";
        let savedCount = 0;

        if (isMemoMode) {
            try {
                let c = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
                const m = c.match(/\{[\s\S]*\}/);
                if (m) c = m[0];
                const parsed = JSON.parse(c);
                botText = String(parsed.reply || "").trim();
                const secrets = Array.isArray(parsed.secrets) ? parsed.secrets : [];
                for (const s of secrets) {
                    if (!s.key || s.value === undefined || s.value === null) continue;
                    const isSecretFinal = hasMemo ? true : !!s.is_secret;
                    const ok = await upsertSecret(supabaseKey, "fatah", String(s.key), String(s.value), isSecretFinal);
                    if (ok) savedCount++;
                }
            } catch (e) {
                botText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
            }
            if (savedCount > 0) {
                botText += MEMO_OK[lang] || MEMO_OK.fr;
            } else {
                botText += MEMO_KO[lang] || MEMO_KO.fr;
            }
        } else {
            botText = rawText;
        }

        if (!botText) botText = "Je n'ai rien pu lire sur cette photo.";

        // 8. Nettoyage (même style que chat.js)
        botText = botText.replace(/\[\[LANG:(fr|en|ar)\]\]/g, "").trim();
        botText = botText.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
        botText = botText.replace(/\bmemo\b/gi, "").trim();
        botText = botText.replace(/\bval\b/gi, "").trim();
        botText = botText.replace(/[ \t]+/g, " ");
        botText = botText.replace(/\n{3,}/g, "\n\n");
        botText = botText.trim();

        // 9. Sauvegarde de la conversation
        const userMsg = capText ? `📷 Photo + « ${capText} »` : "📷 Photo";
        try {
            await fetchT(`${supabaseUrl}/rest/v1/messages`, {
                method: "POST",
                headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json", "Prefer": "return=minimal" },
                body: JSON.stringify([
                    { role: "user", content: userMsg, channel: currentChannel },
                    { role: "assistant", content: botText, channel: currentChannel }
                ])
            }, 3000);
        } catch (e) {}

        return res.status(200).json({ reply: botText, lang: lang });

    } catch (error) {
        console.error("Erreur vision:", error.message);
        return res.status(200).json({ reply: "❌ Erreur pendant l'analyse de la photo.", lang: "fr" });
    }
}

// Anti-écrasement multi-valeurs (même logique que chat.js)
async function upsertSecret(supabaseKey, userId, key, value, isSecret) {
    try {
        const scriptOfNew = isArabicScript(value) ? 'ar' : 'latin';
        const existingRes = await fetchT(`${supabaseUrl}/rest/v1/secrets?user_id=eq.${userId}&key=eq.${encodeURIComponent(key)}`, {
            headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` }
        }, 3000);
        const existing = await existingRes.json();
        const match = Array.isArray(existing) ? existing.find(row => (isArabicScript(row.value) ? 'ar' : 'latin') === scriptOfNew) : null;
        if (match) {
            await fetchT(`${supabaseUrl}/rest/v1/secrets?id=eq.${match.id}`, {
                method: "PATCH",
                headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({ value: value, is_secret: isSecret })
            }, 3000);
        } else {
            await fetchT(`${supabaseUrl}/rest/v1/secrets`, {
                method: "POST",
                headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json", "Prefer": "return=minimal" },
                body: JSON.stringify({ user_id: userId, key: key, value: value, is_secret: isSecret })
            }, 3000);
        }
        return true;
    } catch (e) {
        return false;
    }
}
