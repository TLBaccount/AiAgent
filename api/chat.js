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
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) return res.status(500).json({ error: "Clé API Groq manquante" });

        // EXTRACTION DES SECRETS (AVANT LE TOOL CALLING)
        await extractSecrets(message, "", supabaseUrl, supabaseKey, hasMemoKeyword);

        // PROMPT SYSTÈME
        const formatRules = currentChannel === "telegram" 
            ? `
RÈGLE DE FORMATAGE POUR TELEGRAM (STRICTE) :
- N'utilise JAMAIS de titres (###), de tableaux (| |), ni de HTML.
- N'essaie JAMAIS de formater un tableau en texte : Telegram ne supporte PAS les tableaux.
- Utilise *gras* pour les mots importants.
- Utilise _italique_ pour les nuances.
- Utilise \`code\` pour les données techniques (emails, URLs).
- Utilise des listes à puces avec "• ".
- Utilise des séparateurs "━━━━━━━━━━" entre les sections.
- Utilise des emojis pour structurer : 📌 (titre), ✅ (succès), ❌ (erreur), 📊 (données), 🔗 (lien), 🎯 (objectif).
- Fais des sauts de ligne entre les paragraphes.
- Reste concis et aéré.`
            : `
RÈGLE DE FORMATAGE POUR LE WEB :
- Tu peux utiliser des tableaux Markdown (| |), des titres (###), du gras (**), de l'italique (*).
- Utilise des listes à puces et des sauts de ligne.
- Reste clair et structuré.`;

        const dataShareRules = `
RÈGLE DE PARTAGE DE DONNÉES (ABSOLUE) :

⚠️ Si l'utilisateur demande un TABLEAU, un GRAPHIQUE, une LISTE STRUCTURÉE, ou des DONNÉES :
→ Tu DOIS OBLIGATOIREMENT utiliser l'outil "share_data".
→ Tu ne dois JAMAIS essayer de formater un tableau en texte.

🎯 RÈGLE DE DÉCISION (COMMENT CHOISIR LE FORMAT) :

Tu dois CHOISIR TOI-MÊME le meilleur format selon la nature des données :

1. 📊 GRAPHIQUE EN BARRES (type="chart", chartType="bar") :
   → Pour COMPARER des valeurs entre catégories.

2. 🥧 CAMEMBERT (type="chart", chartType="pie" ou "doughnut") :
   → Pour montrer des PROPORTIONS ou des POURCENTAGES.

3. 📈 COURBE (type="chart", chartType="line") :
   → Pour montrer une ÉVOLUTION dans le temps.

4. 📋 TABLEAU JSON (type="json") :
   → Pour des données STRUCTURÉES avec plusieurs colonnes.

5. 📝 TEXTE BRUT (type="text") :
   → Pour des NOTES, des listes simples.

FORMAT DES DONNÉES POUR "chart" :
{
  "chartType": "bar" | "pie" | "line" | "doughnut",
  "labels": ["Janvier", "Février", "Mars"],
  "datasets": [{"label": "Ventes", "data": [10, 20, 30]}]
}

FORMAT DES DONNÉES POUR "json" :
{
  "headers": ["Ingrédient", "Quantité"],
  "rows": [["Poulet", "500 g"], ["Crème fraîche", "200 ml"]]
}

FORMAT DES DONNÉES POUR "text" :
{
  "content": "Note 1\nNote 2"
}`;

        const systemPrompt = `Tu es Scoop, un assistant personnel multilingue.

RÈGLE ABSOLUE DE LANGUE : Tu dois répondre EXCLUSIVEMENT en ${currentLang === 'ar' ? 'ARABE' : currentLang === 'en' ? 'ANGLAIS' : 'FRANÇAIS'}.

RÈGLE DU MOT-CLÉ "MEMO" :
- Le mot "Memo" est un mot-clé technique utilisé par l'utilisateur pour ENREGISTRER une information.
- Tu ne dois JAMAIS répéter le mot "Memo" dans ta réponse.
- Si le message contient "Memo", cela signifie que l'utilisateur te DONNE une information à enregistrer.
- Tu dois alors CONFIRMER l'enregistrement (par exemple : "✅ C'est noté, j'ai enregistré...").
- Tu ne dois JAMAIS refuser d'enregistrer une information donnée avec "Memo".

RÈGLE DES OUTILS (CRITIQUE) :
- Tu as accès à 5 outils : send_email, create_event, search_web, shorten_url, share_data.
- Tu ne dois appeler un outil QUE si l'utilisateur donne un ORDRE EXPLICITE d'action.

RÈGLES STRICTES POUR LES OUTILS :
- send_email : UNIQUEMENT si l'utilisateur dit "envoie un email à X".
- create_event : UNIQUEMENT si l'utilisateur dit "ajoute un événement".
- search_web : UNIQUEMENT si l'utilisateur dit "cherche", "recherche".
- shorten_url : UNIQUEMENT quand tu génères un lien long.
- share_data : OBLIGATOIRE dès que l'utilisateur demande un tableau, un graphique, ou une liste structurée.

INTERDICTIONS ABSOLUES POUR LES OUTILS :
- Si l'utilisateur dit "mon adresse mail est X" → NE PAS appeler send_email.
- Si l'utilisateur parle de sa famille → NE PAS appeler d'outil.
- Ne mélange JAMAIS les langues.
- N'utilise JAMAIS le darija.

RÈGLE DES SECRETS :
- Tu dois DISTINGUER deux situations :
  1. L'utilisateur DONNE une information (avec "Memo") → Tu l'ENREGISTRES et tu CONFIRMES.
  2. L'utilisateur DEMANDE une information secrète (sans "Scoop") → Tu REFUSES.
- Si le message contient "Memo" → c'est une DONATION → tu confirmes.
- Si le message ne contient PAS "Memo" et demande une info secrète → tu refuses.

SUIVI DU FIL :
- Tiens compte de TOUT l'historique.

INFORMATIONS CONNUES (non-secrètes) :
${publicText}

SECRETS (protégés par ton nom "Scoop") :
${privateText}
${dataShareRules}
${formatRules}`;

        const tools = [
            {
                type: "function",
                function: {
                    name: "send_email",
                    description: "Envoie un email UNIQUEMENT si l'utilisateur donne un ordre explicite d'envoi d'email.",
                    parameters: {
                        type: "object",
                        properties: {
                            to: { type: "string", description: "Destinataire" },
                            subject: { type: "string", description: "Sujet" },
                            body: { type: "string", description: "Corps du message" }
                        },
                        required: ["to", "subject", "body"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "create_event",
                    description: "Crée un événement dans l'agenda UNIQUEMENT si l'utilisateur donne un ordre explicite.",
                    parameters: {
                        type: "object",
                        properties: {
                            title: { type: "string", description: "Titre" },
                            date: { type: "string", description: "Date (YYYY-MM-DD)" },
                            time: { type: "string", description: "Heure (HH:MM)" }
                        },
                        required: ["title", "date", "time"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "search_web",
                    description: "Cherche sur Internet UNIQUEMENT si l'utilisateur donne un ordre explicite de recherche.",
                    parameters: {
                        type: "object",
                        properties: {
                            query: { type: "string", description: "Requête de recherche" }
                        },
                        required: ["query"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "shorten_url",
                    description: "Raccourcit une URL longue.",
                    parameters: {
                        type: "object",
                        properties: {
                            url: { type: "string", description: "URL longue à raccourcir" }
                        },
                        required: ["url"]
                    }
                }
            },
            {
                type: "function",
                function: {
                    name: "share_data",
                    description: "OBLIGATOIRE pour partager des données (tableau, graphique, liste structurée). Tu dois CHOISIR le meilleur format selon la nature des données.",
                    parameters: {
                        type: "object",
                        properties: {
                            type: { type: "string", description: "Type : 'chart' (graphique), 'json' (tableau), ou 'text' (texte brut)" },
                            title: { type: "string", description: "Titre du partage" },
                            data: { type: "object", description: "Données (format dépend du type)" }
                        },
                        required: ["type", "data"]
                    }
                }
            }
        ];

        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
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

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Erreur API Groq: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const responseMessage = data.choices[0].message;

        if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
            const toolCall = responseMessage.tool_calls[0];
            const functionName = toolCall.function.name;
            const functionArgs = JSON.parse(toolCall.function.arguments);

            // Cas spécial : shorten_url
            if (functionName === "shorten_url") {
                const shortenRes = await fetch(`${siteUrl}/api/shorten`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ url: functionArgs.url })
                });
                const shortenData = await shortenRes.json();
                return res.status(200).json({ 
                    reply: `🔗 Lien court : ${shortenData.short_url}`, 
                    lang: currentLang 
                });
            }

            // Cas spécial : share_data
            if (functionName === "share_data") {
                const shareRes = await fetch(`${siteUrl}/api/share`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ 
                        type: functionArgs.type, 
                        data: functionArgs.data,
                        title: functionArgs.title || ""
                    })
                });
                const shareData = await shareRes.json();

                if (shareData.share_url) {
                    // TOUJOURS raccourcir le lien
                    const shortenRes = await fetch(`${siteUrl}/api/shorten`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ url: shareData.share_url })
                    });
                    const shortenData = await shortenRes.json();
                    
                    const finalUrl = shortenData.short_url || shareData.share_url;
                    
                    return res.status(200).json({ 
                        reply: `🔗 Lien ${shareData.tool} : ${finalUrl}`, 
                        lang: currentLang 
                    });
                }
                return res.status(200).json({ 
                    reply: `❌ Impossible de partager les données : ${shareData.error}`, 
                    lang: currentLang 
                });
            }

            let activepiecesUrl = null;
            let actionType = null;

            if (functionName === "send_email") {
                activepiecesUrl = URL_EMAIL;
                actionType = "email";
            } else if (functionName === "create_event") {
                activepiecesUrl = URL_CALENDAR;
                actionType = "calendar";
            } else if (functionName === "search_web") {
                activepiecesUrl = URL_SEARCH;
                actionType = "search";
            }

            if (activepiecesUrl) {
                const apResponse = await fetch(activepiecesUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: functionArgs, type: actionType, user: agentName })
                });
                const apData = await apResponse.json();
                return res.status(200).json({ 
                    reply: `✅ Action "${actionType}" exécutée ! (Réponse: ${JSON.stringify(apData)})`, 
                    lang: currentLang 
                });
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

function isArabicScript(text) {
    return /[\u0600-\u06FF]/.test(text);
}

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
                    { 
                        role: "system", 
                        content: `Tu es un extracteur d'informations. Analyse l'échange et extrais les informations personnelles importantes.

RÈGLE DE CLASSIFICATION (ABSOLUE) :
- Si le message contient le mot-clé "Memo", TOUTES les informations extraites sont classées comme SECRÈTES (is_secret = true).
- Sinon, NON-SECRÈTES (is_secret = false), SAUF si intrinsèquement sensibles.

RÈGLE DES NUMÉROS (TRÈS IMPORTANTE) :
- Par défaut, TOUT numéro est un MOBILE → utilise "tel_mobile".
- Utilise "tel_fixe" UNIQUEMENT si l'utilisateur dit explicitement "fixe".
- Si l'utilisateur dit "mon 2ème numéro", "mon autre numéro" → utilise une NOUVELLE clé (tel_mobile_perso_2).

RÈGLE DES CLÉS DESCRIPTIVES (NE JAMAIS ÉCRASER) :
- tel_mobile_perso, tel_mobile_perso_2, tel_mobile_femme, etc.
- email_perso, email_pro, email_femme, etc.
- nom_famille, prenom, nom_complet (3 clés DIFFÉRENTES).

Réponds UNIQUEMENT avec un objet JSON : {"secrets": [{"key": "tel_mobile_perso_2", "value": "+213784221119", "is_secret": true}]}
Si rien : {"secrets": []}`
                    },
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
