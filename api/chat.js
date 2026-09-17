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

    // DÉTECTION DES MOTS-CLÉS
    const hasMemoKeyword = /\bmemo\b/i.test(message);
    const hasValKeyword = /\bval\b/i.test(message);
    const shouldExtractSecrets = hasMemoKeyword || hasValKeyword;

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
        if (shouldExtractSecrets) {
            const forceSecret = hasMemoKeyword ? true : false;
            await extractSecrets(message, "", supabaseUrl, supabaseKey, forceSecret);
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
RÈGLE DE PARTAGE DE DONNÉES (ABSOLUE) :
- Si l'utilisateur demande un TABLEAU, GRAPHIQUE, ou DONNÉES :
→ Utilise l'outil "share_data".
- Types AUTORISÉS (uniquement ces 3) :
  1. "chart" → pour les graphiques (bar, pie, line).
  2. "json" → pour les TABLEAUX (ingrédients, listes, contacts).
  3. "text" → pour le texte brut (notes).
- Pour un TABLEAU, utilise TOUJOURS type="json".
- N'invente JAMAIS un type.

⚠️ IMPORTANT : Quand tu appelles "share_data", le système te renverra un lien.
Tu DOIS utiliser ce lien tel quel. NE JAMAIS inventer de lien.`;

        const systemPrompt = `Tu es Scoop, un assistant personnel multilingue.

RÈGLE ABSOLUE DE LANGUE : Réponds EXCLUSIVEMENT en ${currentLang === 'ar' ? 'ARABE' : currentLang === 'en' ? 'ANGLAIS' : 'FRANÇAIS'}.

⚠️ RÈGLE ANTI-RÉPÉTITION :
- Tu ne dois JAMAIS répéter une réponse précédente.
- Réponds UNIQUEMENT à la demande ACTUELLE.

RÈGLE DES MOTS-CLÉS "MEMO" ET "VAL" :
- "Memo" = ENREGISTRER une information SECRÈTE (is_secret = true).
- "Val" = ENREGISTRER une information PUBLIQUE (is_secret = false).
- Si le message contient "Memo" → CONFIRME l'enregistrement ("✅ C'est noté, j'ai enregistré ce secret.").
- Si le message contient "Val" → CONFIRME l'enregistrement ("✅ C'est noté, j'ai enregistré cette information.").
- Ne répète JAMAIS "Memo" ni "Val" dans ta réponse.

RÈGLE DES OUTILS :
- send_email : UNIQUEMENT si "envoie un email à X".
- create_event : UNIQUEMENT si "ajoute un événement".
- search_web : UNIQUEMENT si "cherche", "recherche".
- share_data : OBLIGATOIRE pour tableau/graphique.

INTERDICTIONS :
- "mon adresse mail est X" → NE PAS appeler send_email.
- Ne mélange JAMAIS les langues.
- N'invente JAMAIS de lien.

RÈGLE DES SECRETS (CORRIGÉE) :
- Les informations NON-SECRÈTES (is_secret = false) sont PUBLIQUES. Tu DOIS les donner sans condition.
- Les SECRETS (is_secret = true) sont protégés. Tu ne les donnes QUE si l'utilisateur dit "Scoop".

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

        let response = null;
        let provider = null;

        // TENTATIVE 1 : GEMINI
        const geminiKey = process.env.GOOGLE_AI_KEY;
        if (geminiKey) {
            try {
                response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
                    body: JSON.stringify({
                        model: "gemini-3.8-flash",
                        contents: [{ role: "user", parts: [{ text: message }] }],
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
                            model: "meta-llama/llama-3.3-70b-instruct:free",
                            messages: [
                                { role: "system", content: systemPrompt },
                                ...fullHistory,
                                { role: "user", content: message }
                            ],
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
                // ... (gestion des outils identique à avant)
            }
            botText = responseMessage.content.trim();
        }

        botText = botText.replace(/\[\[LANG:(fr|en|ar)\]\]/g, "").trim();
        botText = botText.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
        botText = botText.replace(/\bmemo\b/gi, "").trim();
        botText = botText.replace(/\bval\b/gi, "").trim();
        botText = botText.replace(/\s+/g, " ").trim();

        return res.status(200).json({ reply: botText, lang: currentLang });

    } catch (error) {
        console.error("Erreur serveur:", error);
        return res.status(500).json({ error: "Erreur interne du serveur." });
    }
}

// ... (fonctions estimateTokens, cleanupIfNeeded, getSecrets, upsertSecret, extractSecrets identiques)
