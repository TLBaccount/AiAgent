import { francAll } from 'franc';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { message, history, forcedLang } = req.body;
    const agentName = "Scoop";
    const supabaseUrl = "https://pfmgkdpvqqvlznogfuzi.supabase.co";
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

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
    const cleanMessage = message.replace(/\bmemo\b/i, '').trim();

    if (cleanMessage.toLowerCase().includes(agentName.toLowerCase())) {
        if (cleanMessage.toLowerCase().includes("quelle heure") || cleanMessage.toLowerCase().includes("what time") || cleanMessage.toLowerCase().includes("الساعة")) {
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

        // ============================================
        // EXTRACTION DES SECRETS (AVANT LE TOOL CALLING)
        // ============================================
        await extractSecrets(cleanMessage, "", supabaseUrl, supabaseKey, hasMemoKeyword);

        const systemPrompt = `Tu es Scoop, un assistant personnel multilingue.

RÈGLE ABSOLUE DE LANGUE : Tu dois répondre EXCLUSIVEMENT en ${currentLang === 'ar' ? 'ARABE' : currentLang === 'en' ? 'ANGLAIS' : 'FRANÇAIS'}.

RÈGLE DES OUTILS (CRITIQUE) :
- Tu as accès à 3 outils : send_email, create_event, search_web.
- Tu ne dois appeler un outil QUE si l'utilisateur donne un ORDRE EXPLICITE d'action.
- Si l'utilisateur parle de sa famille, de son nom, de ses préférences, ou fait une simple conversation, tu NE DOIS PAS appeler d'outil. Réponds normalement.

RÈGLES STRICTES POUR LES OUTILS :
- send_email : UNIQUEMENT si l'utilisateur dit "envoie un email", "envoie un mail", "écris un email", "send an email".
- create_event : UNIQUEMENT si l'utilisateur dit "ajoute un événement", "crée un rendez-vous", "add an event".
- search_web : UNIQUEMENT si l'utilisateur dit "cherche", "recherche", "search", "google".

INTERDICTIONS ABSOLUES :
- Si l'utilisateur dit "mon nom de famille est X" → NE PAS appeler d'outil.
- Si l'utilisateur dit "je m'appelle X" → NE PAS appeler d'outil.
- Si l'utilisateur dit "comment je m'appelle" → NE PAS appeler d'outil.
- Ne mélange JAMAIS les langues.
- N'utilise JAMAIS le darija.

RÈGLE DES SECRETS :
- Les SECRETS sont protégés. Ne les divulgue JAMAIS sans autorisation.
- Pour autoriser la divulgation d'un secret, l'utilisateur doit dire "Scoop" dans sa demande.

SUIVI DU FIL :
- L'historique peut contenir plusieurs langues.
- Tiens compte de TOUT l'historique.
- Si on te demande une information, cherche dans l'historique.

INFORMATIONS CONNUES (non-secrètes) :
${publicText}

SECRETS (protégés par ton nom "Scoop") :
${privateText}`;

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
                    { role: "user", content: cleanMessage }
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
                    - Sinon, NON-SECRÈTES (is_secret = false), SAUF si intrinsèquement sensibles (mot de passe, email, adresse, téléphone, IBAN).

                    Réponds UNIQUEMENT avec un objet JSON de cette forme exacte :
                    {"secrets": [{"key": "nom", "value": "Fateh", "is_secret": false}]}
                    Si rien d'important : {"secrets": []}`
                    },
                    { role: "user", content: `Utilisateur: ${message}\nScoop: ${botReply}` }
                ]
            })
        });
        const data = await response.json();
        let content = data.choices[0].message.content.trim();
        content = content.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) content = jsonMatch[0];
        const parsed = JSON.parse(content);
        const secrets = parsed.secrets || [];
        for (const secret of secrets) {
            const finalIsSecret = forceSecret ? true : (secret.is_secret || false);
            
            await fetch(`${supabaseUrl}/rest/v1/secrets`, {
                method: "POST",
                headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({ 
                    user_id: "fatah", 
                    key: secret.key, 
                    value: secret.value,
                    is_secret: finalIsSecret
                })
            });
        }
    } catch (error) { 
        console.error("Erreur extraction secrets:", error); 
    }
}
