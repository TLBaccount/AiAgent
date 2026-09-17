import { francAll } from 'franc';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

    // ... (Détection de la langue et des mots-clés identiques)
    let currentLang = forcedLang;
    const prefixMatch = message.match(/^\[(fr|en|ar)\]\s*/i);
    if (prefixMatch) { currentLang = prefixMatch[1].toLowerCase(); message = message.replace(/^\[(fr|en|ar)\]\s*/i, '').trim(); }
    if (!currentLang) {
        if (/[\u0600-\u06FF]/.test(message)) { currentLang = 'ar'; } 
        else { const guesses = francAll(message, { minLength: 1 }); const top = guesses.find(([code]) => code === 'fra' || code === 'eng'); currentLang = top && top[0] === 'eng' ? 'en' : 'fr'; }
    }

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

        // ... (formatRules et dataShareRules identiques)
        const formatRules = currentChannel === "telegram" ? `...` : `...`;
        const dataShareRules = `...`;

        const systemPrompt = `...`; // Le prompt système reste le même

        // OUTIL SIMPLIFIÉ : data_json est une chaîne
        const tools = [
            { type: "function", function: { name: "send_email", description: "Envoie un email UNIQUEMENT si l'utilisateur donne un ordre explicite.", parameters: { type: "object", properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } }, required: ["to", "subject", "body"] } } },
            { type: "function", function: { name: "create_event", description: "Crée un événement UNIQUEMENT si l'utilisateur donne un ordre explicite.", parameters: { type: "object", properties: { title: { type: "string" }, date: { type: "string" }, time: { type: "string" } }, required: ["title", "date", "time"] } } },
            { type: "function", function: { name: "search_web", description: "Cherche sur Internet UNIQUEMENT si l'utilisateur donne un ordre explicite.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
            { type: "function", function: { name: "shorten_url", description: "Raccourcit une URL longue.", parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } } },
            { type: "function", function: { name: "share_data", description: "Partage des données. Le paramètre data_json doit être une CHAÎNE JSON.", parameters: { type: "object", properties: { type: { type: "string" }, title: { type: "string" }, data_json: { type: "string" } }, required: ["type", "data_json"] } } }
        ];

        // ... (Cascade Gemini → Groq → OpenRouter)
        let response = null;
        let provider = null;

        // TENTATIVE 1 : GEMINI
        const geminiKey = process.env.GOOGLE_AI_KEY;
        if (geminiKey) {
            try {
                response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${geminiKey}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: message }] }], systemInstruction: { parts: [{ text: systemPrompt }] } })
                });
                if (response.ok) provider = "Gemini"; else { console.error(`Gemini a échoué (${response.status})`); response = null; }
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
                        body: JSON.stringify({ model: "openai/gpt-oss-20b", messages: [{ role: "system", content: systemPrompt }, ...fullHistory, { role: "user", content: message }], tools: tools, tool_choice: "auto" })
                    });
                    if (response.ok) provider = "Groq"; else { const errText = await response.text(); console.error(`Groq a échoué (${response.status}) : ${errText.substring(0, 200)}`); response = null; }
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
                        body: JSON.stringify({ model: "z-ai/glm-5.2:free", messages: [{ role: "system", content: systemPrompt }, ...fullHistory, { role: "user", content: message }], tools: tools, tool_choice: "auto" })
                    });
                    if (response.ok) provider = "OpenRouter"; else { const errText = await response.text(); console.error(`OpenRouter a échoué (${response.status}) : ${errText.substring(0, 200)}`); response = null; }
                } catch (e) { console.error("Erreur OpenRouter:", e.message); response = null; }
            }
        }

        if (!provider) throw new Error("Aucun fournisseur LLM n'a répondu");
        console.log(`Réponse obtenue via ${provider}`);

        const data = await response.json();
        let botText = "";
        if (provider === "Gemini") { botText = data.candidates[0].content.parts[0].text.trim(); }
        else {
            const responseMessage = data.choices[0].message;
            if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
                const toolCall = responseMessage.tool_calls[0];
                const functionName = toolCall.function.name;
                const functionArgs = JSON.parse(toolCall.function.arguments);

                if (functionName === "shorten_url") { /* ... */ }
                if (functionName === "share_data") {
                    let parsedData;
                    try { parsedData = JSON.parse(functionArgs.data_json); } 
                    catch (e) { return res.status(200).json({ reply: `❌ Erreur de format des données : ${e.message}`, lang: currentLang }); }

                    const shareRes = await fetch(`${siteUrl}/api/share`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: functionArgs.type, data: parsedData, title: functionArgs.title || "" }) });
                    const shareData = await shareRes.json();
                    if (shareData.share_url) {
                        const shortenRes = await fetch(`${siteUrl}/api/shorten`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: shareData.share_url }) });
                        const shortenData = await shortenRes.json();
                        const finalUrl = shortenData.short_url || shareData.share_url;
                        return res.status(200).json({ reply: `🔗 Lien ${shareData.tool} : ${finalUrl}`, lang: currentLang });
                    }
                    return res.status(200).json({ reply: `❌ Impossible de partager : ${shareData.error}`, lang: currentLang });
                }
                // ... (send_email, create_event, search_web)
            }
            botText = responseMessage.content.trim();
        }

        // Nettoyage final
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

// ... (Fonctions estimateTokens, cleanupIfNeeded, getSecrets, upsertSecret, extractSecrets identiques)
