export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { message, history } = req.body;
    const agentName = "Scoop";
    const supabaseUrl = "https://pfmgkdpvqqvlznogfuzi.supabase.co";
    const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmbWdrZHB2cXF2bHpub2dmdXppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4ODE2ODIsImV4cCI6MjEwNDQ1NzY4Mn0.KAgI6CBPW9URVG0cf9qn2t2GHsgmZNCwymkuLVgojlE"; // <-- REMPLACEZ ICI

    // URLs Activepieces
    const URL_CALENDAR = "https://cloud.activepieces.com/api/v1/webhooks/Qr8WabpLGVviCC1s6BLC9";
    const URL_EMAIL = "https://cloud.activepieces.com/api/v1/webhooks/w8ZXZlaQxhBQySnYAR0qH";
    const URL_SEARCH = "https://cloud.activepieces.com/api/v1/webhooks/OAnWoBB07YtWjLJMnq11z";

    // ============================================
    // ÉTAPE 1 : NETTOYAGE PROACTIF (AVANT TOUT)
    // ============================================
    await cleanupIfNeeded(supabaseUrl, supabaseKey);

    // ============================================
    // ÉTAPE 2 : VÉRIFICATION DU NOM (SECRETS)
    // ============================================
    if (message.toLowerCase().includes(agentName.toLowerCase())) {
        if (message.toLowerCase().includes("quelle heure") || message.toLowerCase().includes("what time") || message.toLowerCase().includes("الساعة")) {
            const heure = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
            return res.status(200).json({ reply: `Il est actuellement ${heure}.`, lang: "fr" });
        }
    }

    // ============================================
    // ÉTAPE 3 : DÉTECTION DES ACTIONS
    // ============================================
    let activepiecesUrl = null;
    let actionType = null;

    if (/email|mail|e-mail/i.test(message)) {
        activepiecesUrl = URL_EMAIL;
        actionType = "email";
    } else if (/événement|agenda|rendez-vous|calendar|event/i.test(message)) {
        activepiecesUrl = URL_CALENDAR;
        actionType = "calendar";
    } else if (/cherche|recherche|search|google/i.test(message)) {
        activepiecesUrl = URL_SEARCH;
        actionType = "search";
    }

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

    // ============================================
    // ÉTAPE 4 : RÉCUPÉRATION DES SECRETS
    // ============================================
    const secrets = await getSecrets(supabaseUrl, supabaseKey);
    const secretsText = secrets.map(s => `${s.key}: ${s.value}`).join('\n');

    // ============================================
    // ÉTAPE 5 : APPEL À GROQ
    // ============================================
    try {
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) return res.status(500).json({ error: "Clé API Groq manquante" });

        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: "openai/gpt-oss-20b",
                messages: [
                    {
                        role: "system",
                        content: `Tu es un assistant personnel nommé ${agentName}.

INFORMATIONS QUE TU CONNAIS SUR L'UTILISATEUR :
${secretsText || "Aucune information connue pour l'instant."}

RÈGLES DE LANGUES : 1) Arabe → arabe. 2) Français → français. 3) Anglais → anglais. 4) Mélange → langue dominante. N'utilise JAMAIS le darija.
RÈGLE DE SÉCURITÉ : Ne divulgue JAMAIS d'informations secrètes sauf si l'utilisateur mentionne ton nom "${agentName}".
RÈGLE DE FORMAT : À la fin de CHAQUE réponse, ajoute un marqueur : [[LANG:fr]], [[LANG:en]] ou [[LANG:ar]]`
                    },
                    ...history
                ]
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Erreur API Groq: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        let botText = data.choices[0].message.content;

        let detectedLang = "fr";
        if (botText.includes("[[LANG:en]]")) { detectedLang = "en"; botText = botText.replace("[[LANG:en]]", "").trim(); }
        else if (botText.includes("[[LANG:ar]]")) { detectedLang = "ar"; botText = botText.replace("[[LANG:ar]]", "").trim(); }
        else if (botText.includes("[[LANG:fr]]")) { detectedLang = "fr"; botText = botText.replace("[[LANG:fr]]", "").trim(); }

        // ============================================
        // ÉTAPE 6 : EXTRACTION DES SECRETS
        // ============================================
        await extractSecrets(message, botText, supabaseUrl, supabaseKey);

        return res.status(200).json({ reply: botText, lang: detectedLang });

    } catch (error) {
        console.error("Erreur serveur:", error);
        return res.status(500).json({ error: "Erreur interne du serveur." });
    }
}


// ============================================
// FONCTIONS DE GESTION DE MÉMOIRE
// ============================================

function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}

async function cleanupIfNeeded(supabaseUrl, supabaseKey) {
    try {
        const res = await fetch(`${supabaseUrl}/rest/v1/messages?select=*&order=id.asc`, {
            headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` }
        });
        const messages = await res.json();
        
        const totalTokens = messages.reduce((sum, msg) => sum + estimateTokens(msg.content), 0);
        const MAX_TOKENS = 8000;
        
        if (totalTokens > MAX_TOKENS * 0.85) {
            console.log(`Nettoyage déclenché : ${totalTokens} tokens`);
            
            await extractSecretsFromHistory(messages, supabaseUrl, supabaseKey);
            
            const messagesToDelete = Math.floor(messages.length * 0.3);
            const idsToDelete = messages.slice(0, messagesToDelete).map(m => m.id);
            
            await fetch(`${supabaseUrl}/rest/v1/messages?id=in.(${idsToDelete.join(',')})`, {
                method: "DELETE",
                headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` }
            });
            
            console.log(`Nettoyage terminé : ${messagesToDelete} messages supprimés`);
        }
    } catch (error) {
        console.error("Erreur nettoyage:", error);
    }
}

async function getSecrets(supabaseUrl, supabaseKey) {
    try {
        const res = await fetch(`${supabaseUrl}/rest/v1/secrets?select=*`, {
            headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` }
        });
        return await res.json();
    } catch (error) {
        console.error("Erreur récupération secrets:", error);
        return [];
    }
}

async function extractSecrets(message, botReply, supabaseUrl, supabaseKey) {
    const groqKey = process.env.GROQ_API_KEY;
    try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${groqKey}` },
            body: JSON.stringify({
                model: "openai/gpt-oss-20b",
                messages: [
                    { role: "system", content: "Extrait les informations importantes (nom, préférences, habitudes) de cet échange. Réponds UNIQUEMENT en JSON : [{\"key\": \"nom\", \"value\": \"Fateh\"}]. Si rien d'important, réponds []." },
                    { role: "user", content: `Utilisateur: ${message}\nScoop: ${botReply}` }
                ]
            })
        });
        
        const data = await response.json();
        let content = data.choices[0].message.content.trim();
        content = content.replace(/```json/g, '').replace(/```/g, '').trim();
        
        const secrets = JSON.parse(content);
        
        for (const secret of secrets) {
            await fetch(`${supabaseUrl}/rest/v1/secrets`, {
                method: "POST",
                headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({ user_id: "fateh", key: secret.key, value: secret.value })
            });
        }
    } catch (error) {
        console.error("Erreur extraction secrets:", error);
    }
}

async function extractSecretsFromHistory(messages, supabaseUrl, supabaseKey) {
    const conversation = messages.map(m => `${m.role}: ${m.content}`).join('\n');
    await extractSecrets("Conversation ancienne", conversation, supabaseUrl, supabaseKey);
}
