import { francAll } from 'franc';

const supabaseUrl = "https://pfmgkdpvqqvlznogfuzi.supabase.co";

// Clés internes : jamais montrées au LLM comme "informations"
const INTERNAL_KEYS = ["pause_messages", "ville_principale"];

// Cascade de modèles Gemini : si l'un est surchargé (503), on essaie le suivant
const GEMINI_MODELS = ["gemini-3.8-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"];

function checkAuth(req) {
    const code = process.env.SCOOP_WEB_CODE;
    if (!code) return true;
    return req.headers['x-scoop-code'] === code;
}

function isArabicScript(text) { return /[\u0600-\u06FF]/.test(text); }

// Appel Gemini avec cascade de modèles
async function callGemini(geminiKey, body) {
    let lastStatus = 0;
    let lastText = "";
    for (const model of GEMINI_MODELS) {
        try {
            const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + geminiKey, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });
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
            console.error("Vision: erreur reseau sur " + model + " -> " + e.message);
        }
    }
    return { ok: false, status: lastStatus, text: lastText };
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
        // 1. Téléchargement de la photo (côté serveur)
        const fRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
        const fData = await fRes.json();
        const filePath = fData.result.file_path;
        const imgRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
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

        // 3. Mémoire (infos publiques + secrets si "Scoop" dans la légende)
        const wantsSecrets = /\bscoop\b/i.test(capText);
        let publicText = "Aucune information connue.";
        let privateText = "";
        try {
            const sRes = await fetch(`${supabaseUrl}/rest/v1/secrets?select=*`, {
                headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` }
            });
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

        // 4. Memo / Val : mots-clés dans la LÉGENDE, valeurs lues dans la PHOTO
        const kwRegex = /(?<![\p{L}\p{N}_])(memo|val)(?![\p{L}\p{N}_])/giu;
        const kwMatches = capText.match(kwRegex) || [];
        const hasMemo = kwMatches.some(w => w.toLowerCase() === 'memo');
        const hasVal = kwMatches.some(w => w.toLowerCase() === 'val');
        let memoStatus = "";
        if (hasMemo || hasVal) {
            const savedCount = await extractFromPhoto(base64Img, mime, capText, supabaseKey, hasMemo, geminiKey);
            if (savedCount > 0) {
                memoStatus = "MEMO_STATUS: des informations ont bien été enregistrées en mémoire. Confirme-le naturellement en une courte phrase.";
            } else {
                memoStatus = "MEMO_STATUS: aucune nouvelle information n'a pu être enregistrée. Ne promets aucun enregistrement.";
            }
        }

        // 5. Réponse principale (Gemini vision, avec cascade)
        const langName = lang === 'ar' ? 'ARABE' : lang === 'en' ? 'ANGLAIS' : 'FRANÇAIS';
        let instruction = "L'utilisateur a envoyé cette photo sans commentaire. Décris-la de façon claire et utile (sujet principal, texte visible important, montants et dates si présents).";
        if (capText) {
            instruction = `L'utilisateur a envoyé cette photo avec cette demande : "${capText}". Suis cette demande.`;
        }

        let systemPrompt = `Tu es Scoop, l'assistant personnel de Fateh. Tu analyses UNE photo qu'il t'envoie.\n\nRÈGLE ABSOLUE : réponds EXCLUSIVEMENT en ${langName}.\n- Chaleureux, précis, concis (max 15 lignes).\n- Si la photo contient du texte (document, facture, panneau...), cite les éléments importants (montants, dates, noms).\n- N'invente JAMAIS ce que tu ne vois pas.\n- INTERDIT : parler d'envoi d'email, d'agenda ou d'exécution d'action à cause de la photo.\n\nINFORMATIONS (non-secrètes) :\n${publicText}\n`;
        if (privateText) {
            systemPrompt = systemPrompt + `\nSECRETS (protégés) :\n${privateText}\n`;
        }
        if (memoStatus) {
            systemPrompt = systemPrompt + `\n${memoStatus}\n`;
        }

        const geminiBody = {
            contents: [{
                role: "user",
                parts: [
                    { inline_data: { mime_type: mime, data: base64Img } },
                    { text: instruction }
                ]
            }],
            systemInstruction: { parts: [{ text: systemPrompt }] }
        };

        const gRes = await callGemini(geminiKey, geminiBody);

        if (!gRes.ok) {
            console.error("Vision Gemini error final:", gRes.status, String(gRes.text).substring(0, 500));
            return res.status(200).json({ reply: "❌ Le service d'analyse d'images est surchargé pour l'instant. Renvoie la photo dans quelques minutes.", lang: lang });
        }

        const apiData = gRes.data;
        let botText = "";
        const cand = apiData.candidates || [];
        if (cand.length > 0 && cand[0].content && cand[0].content.parts) {
            for (const p of cand[0].content.parts) {
                if (p.text) botText = botText + p.text;
            }
        }
        botText = botText.trim();
        if (!botText) botText = "Je n'ai rien pu lire sur cette photo.";

        // 6. Nettoyage (même style que chat.js)
        botText = botText.replace(/\[\[LANG:(fr|en|ar)\]\]/g, "").trim();
        botText = botText.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
        botText = botText.replace(/\bmemo\b/gi, "").trim();
        botText = botText.replace(/\bval\b/gi, "").trim();
        botText = botText.replace(/MEMO_STATUS[^\n]*/gi, "").trim();
        botText = botText.replace(/[ \t]+/g, " ");
        botText = botText.replace(/\n{3,}/g, "\n\n");
        botText = botText.trim();

        // 7. Sauvegarde de la conversation
        const userMsg = capText ? `📷 Photo + « ${capText} »` : "📷 Photo";
        try {
            await fetch(`${supabaseUrl}/rest/v1/messages`, {
                method: "POST",
                headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json", "Prefer": "return=minimal" },
                body: JSON.stringify([
                    { role: "user", content: userMsg, channel: currentChannel },
                    { role: "assistant", content: botText, channel: currentChannel }
                ])
            });
        } catch (e) {}

        return res.status(200).json({ reply: botText, lang: lang });

    } catch (error) {
        console.error("Erreur vision:", error.message);
        return res.status(200).json({ reply: "❌ Erreur pendant l'analyse de la photo.", lang: "fr" });
    }
}

// Extraction Memo/Val depuis la photo (Gemini, réponse JSON, avec cascade)
async function extractFromPhoto(base64Img, mime, caption, supabaseKey, forceSecret, geminiKey) {
    try {
        const sysText = `Tu es un extracteur d'informations depuis une PHOTO.\n\nRÈGLE 1 : si la légende contient "Memo" → is_secret = true. Si "Val" → is_secret = false. Sinon → {"secrets": []}.\nRÈGLE 2 : clés UNIQUES et descriptives (ex: facture_montant_eau, contact_nom, numero_contrat).\nRÈGLE 3 : n'invente rien : uniquement ce qui est visible sur la photo.\n\nRéponds en JSON strict :\n{"secrets": [{"key": "...", "value": "...", "is_secret": true}]}\nou {"secrets": []} si rien.`;

        const userText = `Légende de l'utilisateur : "${caption}"\n\nExtrais de la photo les informations à enregistrer selon la demande de la légende (montants, dates, noms, numéros...).`;

        const geminiBody = {
            contents: [{
                role: "user",
                parts: [
                    { inline_data: { mime_type: mime, data: base64Img } },
                    { text: userText }
                ]
            }],
            generationConfig: { temperature: 0, responseMimeType: "application/json" },
            systemInstruction: { parts: [{ text: sysText }] }
        };

        const gRes = await callGemini(geminiKey, geminiBody);
        if (!gRes.ok) return 0;

        const d = gRes.data;
        let content = "";
        const cand = d.candidates || [];
        if (cand.length > 0 && cand[0].content && cand[0].content.parts) {
            for (const p of cand[0].content.parts) {
                if (p.text) content = content + p.text;
            }
        }
        content = content.replace(/```json/g, '').replace(/```/g, '').trim();
        const m = content.match(/\{[\s\S]*\}/);
        if (m) content = m[0];
        const parsed = JSON.parse(content);
        const secrets = Array.isArray(parsed.secrets) ? parsed.secrets : [];
        let saved = 0;
        for (const s of secrets) {
            if (!s.key || s.value === undefined || s.value === null) continue;
            const isSecretFinal = forceSecret ? true : !!s.is_secret;
            const ok = await upsertSecret(supabaseKey, "fatah", String(s.key), String(s.value), isSecretFinal);
            if (ok) saved++;
        }
        return saved;
    } catch (e) {
        console.error("Erreur extraction photo:", e.message);
        return 0;
    }
}

// Anti-écrasement multi-valeurs (même logique que chat.js)
async function upsertSecret(supabaseKey, userId, key, value, isSecret) {
    try {
        const scriptOfNew = isArabicScript(value) ? 'ar' : 'latin';
        const existingRes = await fetch(`${supabaseUrl}/rest/v1/secrets?user_id=eq.${userId}&key=eq.${encodeURIComponent(key)}`, {
            headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` }
        });
        const existing = await existingRes.json();
        const match = Array.isArray(existing) ? existing.find(row => (isArabicScript(row.value) ? 'ar' : 'latin') === scriptOfNew) : null;
        if (match) {
            await fetch(`${supabaseUrl}/rest/v1/secrets?id=eq.${match.id}`, {
                method: "PATCH",
                headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({ value: value, is_secret: isSecret })
            });
        } else {
            await fetch(`${supabaseUrl}/rest/v1/secrets`, {
                method: "POST",
                headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json", "Prefer": "return=minimal" },
                body: JSON.stringify({ user_id: userId, key: key, value: value, is_secret: isSecret })
            });
        }
        return true;
    } catch (e) {
        return false;
    }
}
