export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { message, history, forcedLang } = req.body;
    const agentName = "Scoop";
    const supabaseUrl = "https://pfmgkdpvqqvlznogfuzi.supabase.co";
    const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmbWdrZHB2cXF2bHpub2dmdXppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4ODE2ODIsImV4cCI6MjEwNDQ1NzY4Mn0.KAgI6CBPW9URVG0cf9qn2t2GHsgmZNCwymkuLVgojlE";

    const URL_CALENDAR = "https://cloud.activepieces.com/api/v1/webhooks/Qr8WabpLGVviCC1s6BLC9";
    const URL_EMAIL = "https://cloud.activepieces.com/api/v1/webhooks/w8ZXZlaQxhBQySnYAR0qH";
    const URL_SEARCH = "https://cloud.activepieces.com/api/v1/webhooks/OAnWoBB07YtWjLJMnq11z";

    await cleanupIfNeeded(supabaseUrl, supabaseKey);

    if (message.toLowerCase().includes(agentName.toLowerCase())) {
        if (message.toLowerCase().includes("quelle heure") || message.toLowerCase().includes("what time") || message.toLowerCase().includes("الساعة")) {
            const heure = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
            return res.status(200).json({ reply: `Il est actuellement ${heure}.`, lang: "fr" });
        }
    }

    let activepiecesUrl = null;
    let actionType = null;
    if (/email|mail|e-mail/i.test(message)) { activepiecesUrl = URL_EMAIL; actionType = "email"; }
    else if (/événement|agenda|rendez-vous|calendar|event/i.test(message)) { activepiecesUrl = URL_CALENDAR; actionType = "calendar"; }
    else if (/cherche|recherche|search|google/i.test(message)) { activepiecesUrl = URL_SEARCH; actionType = "search"; }

    if (activepiecesUrl) {
        try {
            const apResponse = await fetch(activepiecesUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: message, type: actionType, user: agentName })
            });
            if (!apResponse.ok) throw new Error(`Erreur Activepieces: ${apResponse.status}`);
            const apData = await apResponse.json();
            return res.status(200).json({ 
                reply: `✅ Action "${actionType}" reçue par Activepieces ! (Réponse: ${JSON.stringify(apData)})`, 
                lang: "fr" 
            });
        } catch (error) {
            console.error("Erreur Activepieces:", error);
            return res.status(200).json({ reply: `❌ Action impossible. (Erreur: ${error.message})`, lang: "fr" });
        }
    }

    const secrets = await getSecrets(supabaseUrl, supabaseKey);
    const publicInfo = Array.isArray(secrets) ? secrets.filter(s => !s.is_secret) : [];
    const privateSecrets = Array.isArray(secrets) ? secrets.filter(s => s.is_secret) : [];
    const publicText = publicInfo.length > 0 ? publicInfo.map(s => `${s.key}: ${s.value}`).join('\n') : "Aucune information connue.";
    const privateText = privateSecrets.length > 0 ? privateSecrets.map(s => `${s.key}: ${s.value}`).join('\n') : "Aucun secret enregistré.";

    // ============================================
    // LANGUE DU MESSAGE ACTUEL (pour la réponse)
    // ============================================
    let currentLang = forcedLang;
    if (!currentLang) {
        if (/[\u0600-\u06FF]/.test(message)) currentLang = 'ar';
        else if (/[a-zA-Z]/.test(message) && !/[éèêëàâäîïôöùûüç]/.test(message)) currentLang = 'en';
        else currentLang = 'fr';
    }

    // ============================================
    // HISTORIQUE COMPLET (SANS FILTRE, SANS LIMITE)
    // ============================================
    const fullHistory = history || [];

    try {
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) return res.status(500).json({ error: "Clé API Groq manquante" });

        const systemPrompt = `Tu es Scoop, un assistant personnel multilingue.

RÈGLE ABSOLUE : Tu dois répondre EXCLUSIVEMENT en ${currentLang === 'ar' ? 'ARABE' : currentLang === 'en' ? 'ANGLAIS' : 'FRANÇAIS'}.

INTERDICTIONS TOTALES :
- Ne mélange JAMAIS les langues dans ta réponse.
- N'utilise JAMAIS le darija.
- Ne réponds JAMAIS dans une langue différente de ${currentLang === 'ar' ? "l'ARABE" : currentLang === 'en' ? "l'ANGLAIS" : 'le FRANÇAIS'}.

SUIVI DU FIL :
- L'historique peut contenir plusieurs langues.
- Tu dois tenir compte de TOUT l'historique, quelle que soit la langue.
- Exemple : si l'utilisateur a dit "Je m'appelle Fateh" en français, et qu'il demande maintenant "What is my name?" en anglais, tu dois répondre "Your name is Fateh" en anglais.
- Si l'information n'est pas dans l'historique, dis-le dans la langue demandée.

INFORMATIONS CONNUES :
${publicText}

SECRETS (protégés par ton nom "Scoop") :
${privateText}`;

        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: "openai/gpt-oss-120b",
                messages: [
                    { role: "system", content: systemPrompt },
                    ...fullHistory,
                    { role: "user", content: message }
                ]
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Erreur API Groq: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        let botText = data.choices[0].message.content.trim();

        let detectedLang = currentLang;
        botText = botText.replace(/\[\[LANG:(fr|en|ar)\]\]/g, "").trim();

        await extractSecrets(message, botText, supabaseUrl, supabaseKey);

        return res.status(200).json({ reply: botText, lang: detectedLang });

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
        if (totalTokens > 8000 * 0.85) {
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

async function extractSecrets(message, botReply, supabaseUrl, supabaseKey) {
    const groqKey = process.env.GROQ_API_KEY;
    try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${groqKey}` },
            body: JSON.stringify({
                model: "openai/gpt-oss-120b",
                messages: [
                    { role: "system", content: `Extrait les informations importantes. Réponds UNIQUEMENT en JSON : [{"key": "nom", "value": "Fateh", "is_secret": false}]. Si rien, réponds [].` },
                    { role: "user", content: `Utilisateur: ${message}\nScoop: ${botReply}` }
                ]
            })
        });
        const data = await response.json();
        let content = data.choices[0].message.content.trim();
        content = content.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) content = jsonMatch[0];
        const secrets = JSON.parse(content);
        for (const secret of secrets) {
            await fetch(`${supabaseUrl}/rest/v1/secrets`, {
                method: "POST",
                headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({ user_id: "fateh", key: secret.key, value: secret.value, is_secret: secret.is_secret || false })
            });
        }
    } catch (error) { console.error("Erreur extraction secrets:", error); }
}

async function extractSecretsFromHistory(messages, supabaseUrl, supabaseKey) {
    const conversation = messages.map(m => `${m.role}: ${m.content}`).join('\n');
    await extractSecrets("Conversation ancienne", conversation, supabaseUrl, supabaseKey);
}
