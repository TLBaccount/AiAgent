import { francAll } from 'franc';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { message, history, forcedLang, channel } = req.body;
    const agentName = "Scoop";
    const supabaseUrl = "https://pfmgkdpvqqvlznogfuzi.supabase.co";
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    const siteUrl = "https://ai-agent-tlb-agent.vercel.app";

    const currentChannel = channel === "telegram" ? "telegram" : "web";

    const URL_CALENDAR = "https://cloud.activepieces.com/api/v1/webhooks/Qr8WabpLGVviCC1s6BLC9";
    const URL_EMAIL = "https://cloud.activepieces.com/api/v1/webhooks/w8ZXZlaQxhBQySnYAR0qH";
    const URL_SEARCH = "https://cloud.activepieces.com/api/v1/webhooks/OAnWoBB07YtWjLJMnq11z";

    await cleanupIfNeeded(supabaseUrl, supabaseKey);

    // DÉTECTION DE LA LANGUE
    let currentLang = forcedLang;
    const prefixMatch = message.match(/^\[(fr|en|ar)\]\s*/i);
    if (prefixMatch) {
        currentLang = prefixMatch[1].toLowerCase();
        message = message.replace(/^\[(fr|en|ar)\]\s*/i, '').trim();
    }
    if (!currentLang) {
        if (/[\u0600-\u06FF]/.test(message)) {
            currentLang = 'ar';
        } else {
            const guesses = francAll(message, { minLength: 1 });
            const top = guesses.find(([code]) => code === 'fra' || code === 'eng');
            currentLang = top && top[0] === 'eng' ? 'en' : 'fr';
        }
    }

    // DÉTECTION DU MOT-CLÉ "MEMO"
    const hasMemoKeyword = /\bmemo\b/i.test(message);

    if (message.toLowerCase().includes(agentName.toLowerCase())) {
        if (message.toLowerCase().includes("quelle heure") || message.toLowerCase().includes("what time") || message.toLowerCase().includes("الساعة")) {
            const heure = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
            return res.status(200).json({ reply: `Il est actuellement ${heure}.`, lang: "fr" });
        }
    }

    const secrets = await getSecrets(supabaseUrl, supabaseKey);
    const publicInfo = Array.isArray(secrets) ? secrets.filter(s => !s.is_secret) : [];
    const privateSecrets = Array.isArray(secrets) ? secrets.filter(s => s.is_secret) : [];
    const publicText = publicInfo.length > 0 ? publicInfo.map(s => `${s.key}: ${s.value}`).join('\n') : "Aucune information connue.";
    const privateText = privateSecrets.length > 0 ? privateSecrets.map(s => `${s.key}: ${s.value}`).join('\n') : "Aucun secret enregistré.";

    const fullHistory = (history || []).slice(-20);

    try {
        // ============================================
        // OPTIMISATION A : extractSecrets UNIQUEMENT si "Memo"
        // ============================================
        if (hasMemoKeyword) {
            await extractSecrets(message, "", supabaseUrl, supabaseKey, true);
        }

        // PROMPT SYSTÈME
        const formatRules = currentChannel === "telegram" 
            ? `
RÈGLE DE FORMATAGE POUR TELEGRAM (STRICTE) :
- N'utilise JAMAIS de titres (###), de tableaux (| |), ni de HTML.
- Utilise *gras*, _italique_, \`code\`.
- Utilise des listes à puces avec "• ".
- Utilise des emojis pour structurer : 📌, ✅, ❌, 📊, 🔗, 🎯.
- Fais des sauts de ligne.
- Reste concis et aéré.`
            : `
RÈGLE DE FORMATAGE POUR LE WEB :
- Tu peux utiliser des tableaux Markdown (| |), des titres (###), du gras (**), de l'italique (*).
- Utilise des listes à puces et des sauts de ligne.`;

        const dataShareRules = `
RÈGLE DE PARTAGE DE DONNÉES (ABSOLUE) :
- Si l'utilisateur demande un TABLEAU, un GRAPHIQUE, ou des DONNÉES :
→ Utilise OBLIGATOIREMENT l'outil "share_data".
- CHOISIS le format :
  1. GRAPHIQUE (bar/pie/line) : pour comparer, proportions, évolutions.
  2. JSON : pour les tableaux structurés.
  3. TEXTE : pour les notes.

FORMAT "chart" :
{"chartType": "bar", "labels": ["Jan"], "datasets": [{"label": "Ventes", "data": [10]}]}

FORMAT "json" :
{"headers": ["Col1", "Col2"], "rows": [["a", "b"]]}`;

        const systemPrompt = `Tu es Scoop, un assistant personnel multilingue.

RÈGLE ABSOLUE DE LANGUE : Réponds EXCLUSIVEMENT en ${currentLang === 'ar' ? 'ARABE' : currentLang === 'en' ? 'ANGLAIS' : 'FRANÇAIS'}.

RÈGLE DU MOT-CLÉ "MEMO" :
- "Memo" = ENREGISTRER une information.
- Ne répète JAMAIS "Memo".
- Si "Memo" → CONFIRME l'enregistrement ("✅ C'est noté...").

RÈGLE DES OUTILS :
- send_email : UNIQUEMENT si "envoie un email à X".
- create_event : UNIQUEMENT si "ajoute un événement".
- search_web : UNIQUEMENT si "cherche", "recherche".
- share_data : OBLIGATOIRE pour tableau/graphique.

INTERDICTIONS :
- "mon adresse mail est X" → NE PAS appeler send_email.
- Ne mélange JAMAIS les langues.

RÈGLE DES SECRETS :
- DONNE (avec "Memo") → ENREGISTRE.
- DEMANDE (sans "Scoop") → REFUSE.
- DEMANDE (avec "Scoop") → DONNE.

SUIVI DU FIL :
- Tiens compte de TOUT l'historique.

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
            { type: "function", function: { name: "share_data", description: "Partage des données (tableau, graphique, texte). CHOISIS le meilleur format.", parameters: { type: "object", properties: { type: { type: "string" }, title: { type: "string" }, data: { type: "object" } }, required: ["type", "data"] } } }
        ];

        // ============================================
        // CASCADE : CEREBRAS → GROQ
        // ============================================
        let response = null;
        let provider = null;

        // --- TENTATIVE 1 : CEREBRAS ---
        const cerebrasKey = process.env.CEREBRAS_API_KEY;
        if (cerebrasKey) {
            try {
                response = await fetch("https://api.cerebras.ai/v1/chat/completions", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${cerebrasKey}` },
                    body: JSON.stringify({
                        model: "llama-3.3-70b",
                        messages: [
                            { role: "system", content: systemPrompt },
                            ...fullHistory,
                            { role: "user", content: message }
                        ],
                        tools: tools,
                        tool_choice: "auto"
                    })
                });
                if (response.ok) provider = "Cerebras";
                else console.error("Cerebras a échoué:", response.status);
            } catch (e) { console.error("Erreur Cerebras:", e.message); }
        }

        // --- TENTATIVE 2 : GROQ (fallback) ---
        if (!provider) {
            const groqKey = process.env.GROQ_API_KEY;
            if (groqKey) {
                try {
                    response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                        method: "POST",
                        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${groqKey}` },
                        body: JSON.stringify({
                            model: "openai/gpt-oss-20b",
                            messages: [
                                { role: "system", content: systemPrompt },
                                ...fullHistory,
                                { role: "user", content: message }
                            ],
                            tools: tools,
                            tool_choice: "auto"
                        })
                    });
                    if (response.ok) provider = "Groq";
                    else console.error("Groq a échoué:", response.status);
                } catch (e) { console.error("Erreur Groq:", e.message); }
            }
        }

        if (!provider) {
            throw new Error("Aucun fournisseur LLM n'a répondu");
        }

        const data = await response.json();
        const responseMessage = data.choices[0].message;

        // ============================================
        // GESTION DES OUTILS
        // ============================================
        if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
            const toolCall = responseMessage.tool_calls[0];
            const functionName = toolCall.function.name;
            const functionArgs = JSON.parse(toolCall.function.arguments);

            if (functionName === "shorten_url") {
                const shortenRes = await fetch(`${siteUrl}/api/shorten`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ url: functionArgs.url })
                });
                const shortenData = await shortenRes.json();
                return res.status(200).json({ reply: `🔗 Lien court : ${shortenData.short_url}`, lang: currentLang });
            }

            if (functionName === "share_data") {
                const shareRes = await fetch(`${siteUrl}/api/share`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ type: functionArgs.type, data: functionArgs.data, title: functionArgs.title || "" })
                });
                const shareData = await shareRes.json();

                if (shareData.share_url) {
                    const shortenRes = await fetch(`${siteUrl}/api/shorten`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ url: shareData.share_url })
                    });
                    const shortenData = await shortenRes.json();
                    const finalUrl = shortenData.short_url || shareData.share_url;
                    return res.status(200).json({ reply: `🔗 Lien ${shareData.tool} : ${finalUrl}`, lang: currentLang });
                }
                return res.status(200).json({ reply: `❌ Impossible de partager : ${shareData.error}`, lang: currentLang });
            }

            let activepiecesUrl = null;
            let actionType = null;

            if (functionName === "send_email") { activepiecesUrl = URL_EMAIL; actionType = "email"; }
            else if (functionName === "create_event") { activepiecesUrl = URL_CALENDAR; actionType = "calendar"; }
            else if (functionName === "search_web") { activepiecesUrl = URL_SEARCH; actionType = "search"; }

            if (activepiecesUrl) {
                const apResponse = await fetch(activepiecesUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: functionArgs, type: actionType, user: agentName })
                });
                const apData = await apResponse.json();
                return res.status(200).json({ reply: `✅ Action "${actionType}" exécutée ! (Réponse: ${JSON.stringify(apData)})`, lang: currentLang });
            }
        }

        let botText = responseMessage.content.trim();
        botText = botText.replace(/\[\[LANG:(fr|en|ar)\]\]/g, "").trim();
        botText = botText.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
        botText = botText.replace(/\bmemo\b/gi, "").trim();
        botText = botText.replace(/\s+/g, " ").trim();

        return res.status(200).json({ reply: botText, lang: currentLang });

    } catch (error) {
        console.error("Erreur serveur:", error);
        return res.status(500).json({ error: "Erreur interne du serveur." });
    }
}

function estimateTokens(text) { return Math.ceil(text.length / 4); }

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

RÈGLE DE CLASSIFICATION :
- Si "Memo" → SECRET (is_secret = true).
- Sinon → NON-SECRET (is_secret = false), SAUF si intrinsèquement sensible.

RÈGLE DES NUMÉROS :
- Par défaut, MOBILE → "tel_mobile".
- "fixe" explicite → "tel_fixe".
- "2ème numéro" → nouvelle clé (tel_mobile_perso_2).

RÈGLE DES CLÉS DESCRIPTIVES :
- tel_mobile_perso, tel_mobile_perso_2, tel_mobile_femme, etc.
- email_perso, email_pro, email_femme, etc.
- nom_famille, prenom, nom_complet (3 clés DIFFÉRENTES).

Réponds en JSON : {"secrets": [{"key": "nom", "value": "Fateh", "is_secret": false}]}
Si rien : {"secrets": []}` },
                    { role: "user", content: `Utilisateur: ${message}\nScoop: ${botReply}` }
                ]
            })
        });
        
        const data = await response.json();
        let content = data.choices[0].message.content.trim();
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
