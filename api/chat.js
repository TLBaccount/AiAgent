import { francAll } from 'franc';

const agentName = "Scoop";
const supabaseUrl = "https://pfmgkdpvqqvlznogfuzi.supabase.co";
const siteUrl = "https://ai-agent-tlb-agent.vercel.app";

function checkAuth(req) {
    const code = process.env.SCOOP_WEB_CODE;
    if (!code) return true;
    return req.headers['x-scoop-code'] === code;
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!checkAuth(req)) return res.status(401).json({ error: 'Accès refusé' });

    const { forcedLang, channel } = req.body;
    let userMessage = String(req.body.message || '').trim();
    if (!userMessage) return res.status(400).json({ error: 'Message manquant' });

    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    const URL_CALENDAR = process.env.ACTIVEPIECES_CALENDAR_URL;
    const URL_EMAIL = process.env.ACTIVEPIECES_EMAIL_URL;
    const URL_SEARCH = process.env.ACTIVEPIECES_SEARCH_URL;

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
        return respond(res, supabaseUrl, supabaseKey, userMessage, `Il est actuellement ${heure}.`, "fr");
    }

    // Mots-clés Memo / Val (regex unicode : n'attrape pas "Valérie" ni "évaluer")
    const kwRegex = /(?<![\p{L}\p{N}_])(memo|val)(?![\p{L}\p{N}_])/giu;
    const kwMatches = userMessage.match(kwRegex) || [];
    const hasMemoKeyword = kwMatches.some(w => w.toLowerCase() === 'memo');
    const hasValKeyword = kwMatches.some(w => w.toLowerCase() === 'val');
    const shouldExtractSecrets = hasMemoKeyword || hasValKeyword;

    // Les secrets ne sortent QUE si l'utilisateur dit "Scoop"
    const wantsSecrets = /\bscoop\b/i.test(userMessage);

    const secrets = await getSecrets(supabaseUrl, supabaseKey);
    const publicInfo = Array.isArray(secrets) ? secrets.filter(s => !s.is_secret) : [];
    const privateSecrets = wantsSecrets && Array.isArray(secrets) ? secrets.filter(s => s.is_secret) : [];
    const publicText = publicInfo.length > 0 ? publicInfo.map(s => `${s.key}: ${s.value}`).join('\n') : "Aucune information connue.";
    const privateText = privateSecrets.length > 0 ? privateSecrets.map(s => `${s.key}: ${s.value}`).join('\n') : "Aucun secret enregistré.";

    // Historique chargée côté serveur (20 derniers messages)
    let fullHistory = [];
    try {
        const hRes = await fetch(`${supabaseUrl}/rest/v1/messages?select=*&order=id.desc&limit=20`, {
            headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` }
        });
        const hData = await hRes.json();
        if (Array.isArray(hData)) fullHistory = hData.reverse().map(m => ({ role: m.role, content: m.content }));
    } catch (e) { console.error("Erreur historique:", e.message); }

    try {
        if (shouldExtractSecrets) {
            const forceSecret = hasMemoKeyword ? true : false;
            await extractSecrets(userMessage, "", supabaseUrl, supabaseKey, forceSecret);
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

        const dataShareRules = `
🎯 RÈGLE ABSOLUE POUR "share_data" :
Tu ne dois utiliser l'outil "share_data" QUE si l'utilisateur demande EXPLICITEMENT un tableau, un graphique ou un partage (mots-clés : "tableau", "csv", "graphique", "camembert", "partage", "lien", "export").
Pour une liste, une recette ou une explication → TEXTE NORMAL.
FORMAT (data_json = chaîne JSON) :
- "chart" : {"chartType": "bar", "labels": ["Jan"], "datasets": [{"label": "Ventes", "data": [10]}]}
- "json" : {"headers": ["Col1"], "rows": [["a"]]}
- "text" : {"content": "Note 1\\nNote 2"}`;

        const systemPrompt = `Tu es Scoop, un assistant personnel multilingue.

RÈGLE ABSOLUE DE LANGUE : Réponds EXCLUSIVEMENT en ${currentLang === 'ar' ? 'ARABE' : currentLang === 'en' ? 'ANGLAIS' : 'FRANÇAIS'}.

RÈGLE ANTI-RÉPÉTITION : Si l'utilisateur redemande la même chose, tu DOIS redonner la MÊME réponse. Ne dis JAMAIS "je ne peux pas répéter".

RÈGLE DES MOTS-CLÉS "MEMO" ET "VAL" :
- "Memo" = ENREGISTRER une information SECRÈTE. "Val" = ENREGISTRER une information PUBLIQUE.
- Si le message en contient un → CONFIRME l'enregistrement SANS répéter le mot-clé.

RÈGLE DES OUTILS :
- send_email : UNIQUEMENT si "envoie un email à X".
- create_event : UNIQUEMENT si "ajoute un événement".
- search_web : UNIQUEMENT si "cherche", "recherche".
- share_data : UNIQUEMENT si demande EXPLICITE de tableau/graphique/partage.
- "mon adresse mail est X" → NE PAS appeler send_email.
- Ne mélange JAMAIS les langues.

RÈGLE DES SECRETS :
- Les informations NON-SECRÈTES ci-dessous sont PUBLIQUES : donne-les sans condition.
- Les SECRETS ne sont révélés QUE si l'utilisateur dit "Scoop".

INFORMATIONS (non-secrètes) :
${publicText}

SECRETS (protégés par "Scoop") :
${privateText}
${dataShareRules}
${formatRules}`;

        const tools = [
            { type: "function", function: { name: "send_email", description: "Envoie un email UNIQUEMENT si l'utilisateur donne un ordre explicite.", parameters: { type: "object", properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } }, required: ["to", "subject", "body"] } } },
            { type: "function", function: { name: "create_event", description: "Crée un événement UNIQUEMENT si l'utilisateur donne un ordre explicite.", parameters: { type: "object", properties: { title: { type: "string" }, date: { type: "string" }, time: { type: "string" } }, required: ["title", "date", "time"] } } },
            { type: "function", function: { name: "search_web", description: "Cherche sur Internet UNIQUEMENT si l'utilisateur donne un ordre explicite.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
            { type: "function", function: { name: "shorten_url", description: "Raccourcit une URL longue.", parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } } },
            { type: "function", function: { name: "share_data", description: "Partage des données UNIQUEMENT si demande explicite de tableau/graphique/partage.", parameters: { type: "object", properties: { type: { type: "string", description: "Type : 'chart', 'json', ou 'text'" }, title: { type: "string" }, data_json: { type: "string" } }, required: ["type", "data_json"] } } }
        ];

        let response = null;
        let provider = null;

        // TENTATIVE 1 : GEMINI
        const geminiKey = process.env.GOOGLE_AI_KEY;
        if (geminiKey) {
            try {
                response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${geminiKey}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents: [{ role: "user", parts: [{ text: userMessage }] }],
                        systemInstruction: { parts: [{ text: systemPrompt }] }
                    })
                });
                if (response.ok) provider = "Gemini";
                else { console.error(`Gemini a échoué (${response.status})`); response = null; }
            } catch (e) { console.error("Erreur Gemini:", e.message); response = null; }
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
                            messages: [{ role: "system", content: systemPrompt }, ...fullHistory, { role: "user", content: userMessage }],
                            tools: tools,
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
                            messages: [{ role: "system", content: systemPrompt }, ...fullHistory, { role: "user", content: userMessage }],
                            tools: tools,
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

                if (functionName === "shorten_url") {
                    const shortenRes = await fetch(`${siteUrl}/api/shorten`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ url: functionArgs.url })
                    });
                    const shortenData = await shortenRes.json();
                    return respond(res, supabaseUrl, supabaseKey, userMessage, `🔗 Lien court : ${shortenData.short_url}`, currentLang);
                }

                if (functionName === "share_data") {
                    let parsedData;
                    try {
                        let jsonText = String(functionArgs.data_json || "").trim();
                        const start = jsonText.indexOf('{');
                        const end = jsonText.lastIndexOf('}');
                        if (start !== -1 && end !== -1 && end > start) jsonText = jsonText.substring(start, end + 1);
                        parsedData = JSON.parse(jsonText);
                    } catch (e) {
                        return respond(res, supabaseUrl, supabaseKey, userMessage, `❌ Erreur de format des données : ${e.message}`, currentLang);
                    }
                    const shareRes = await fetch(`${siteUrl}/api/share`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ type: functionArgs.type, data: parsedData, title: functionArgs.title || "" })
                    });
                    const shareData = await shareRes.json();
                    if (shareData.share_url) {
                        const shortenRes = await fetch(`${siteUrl}/api/shorten`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ url: shareData.share_url })
                        });
                        const shortenData = await shortenRes.json();
                        return respond(res, supabaseUrl, supabaseKey, userMessage, `🔗 Lien ${shareData.tool} : ${shortenData.short_url || shareData.share_url}`, currentLang);
                    }
                    return respond(res, supabaseUrl, supabaseKey, userMessage, `❌ Impossible de partager : ${shareData.error}`, currentLang);
                }

                let activepiecesUrl = null;
                let actionType = null;
                if (functionName === "send_email") { activepiecesUrl = URL_EMAIL; actionType = "email"; }
                else if (functionName === "create_event") { activepiecesUrl = URL_CALENDAR; actionType = "calendar"; }
                else if (functionName === "search_web") { activepiecesUrl = URL_SEARCH; actionType = "search"; }

                // RECHERCHE : Tavily en direct (résultats réels), fallback Activepieces
                if (actionType === "search" && process.env.TAVILY_API_KEY) {
                    try {
                        const tavilyRes = await fetch("https://api.tavily.com/search", {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                "Authorization": `Bearer ${process.env.TAVILY_API_KEY}`
                            },
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
                            return respond(res, supabaseUrl, supabaseKey, userMessage, replyText, currentLang);
                        }
                    } catch (e) { console.error("Erreur Tavily:", e.message); }
                }

                if (activepiecesUrl) {
                    try {
                        const apResponse = await fetch(activepiecesUrl, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ action: functionArgs, type: actionType, user: agentName })
                        });
                        let apData = null;
                        try { apData = await apResponse.json(); } catch (e) {}

                        if (actionType === "search" && Array.isArray(apData && apData.results) && apData.results.length > 0) {
                            const top = apData.results.map((r, i) => `${i + 1}. ${r.title || "Lien"}\n${r.url}`).join("\n\n");
                            return respond(res, supabaseUrl, supabaseKey, userMessage, `🔎 Résultats :\n\n${top}`, currentLang);
                        }
                        if (apData && apData.result) {
                            return respond(res, supabaseUrl, supabaseKey, userMessage, `✅ ${apData.result}`, currentLang);
                        }
                        return respond(res, supabaseUrl, supabaseKey, userMessage, `✅ Action "${actionType}" exécutée !`, currentLang);
                    } catch (e) {
                        return respond(res, supabaseUrl, supabaseKey, userMessage, `❌ L'action "${actionType}" a échoué.`, currentLang);
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

        return respond(res, supabaseUrl, supabaseKey, userMessage, botText, currentLang);

    } catch (error) {
        console.error("Erreur serveur:", error);
        return res.status(500).json({ error: "Erreur interne du serveur." });
    }
}

// Sauvegarde unique (user + assistant) puis réponse
async function respond(res, supabaseUrl, supabaseKey, userText, botReply, lang) {
    try {
        await fetch(`${supabaseUrl}/rest/v1/messages`, {
            method: "POST",
            headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json", "Prefer": "return=minimal" },
            body: JSON.stringify([{ role: "user", content: userText }, { role: "assistant", content: botReply }])
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

async function getSecrets(supabaseUrl, supabaseKey) {
    try {
        const res = await fetch(`${supabaseUrl}/rest/v1/secrets?select=*`, {
            headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` }
        });
        const data = await res.json();
        return Array.isArray(data) ? data : [];
    } catch (error) { return []; }
}

function isArabicScript(text) { return /[\u0600-\u06FF]/.test(text); }

async function upsertSecret(supabaseUrl, supabaseKey, userId, key, value, isSecret) {
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

async function extractSecrets(message, botReply, supabaseUrl, supabaseKey, forceSecret = false) {
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
            await upsertSecret(supabaseUrl, supabaseKey, "fatah", secret.key, secret.value, finalIsSecret);
        }
    } catch (error) {
        console.error("Erreur extraction secrets:", error.message);
    }
}
