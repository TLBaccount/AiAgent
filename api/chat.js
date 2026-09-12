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

    // ============================================
    // ÉTAPE 1 : NETTOYAGE PROACTIF
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
    const publicInfo = Array.isArray(secrets) ? secrets.filter(s => !s.is_secret) : [];
    const privateSecrets = Array.isArray(secrets) ? secrets.filter(s => s.is_secret) : [];
    const publicText = publicInfo.length > 0 ? publicInfo.map(s => `${s.key}: ${s.value}`).join('\n') : "Aucune information connue.";
    const privateText = privateSecrets.length > 0 ? privateSecrets.map(s => `${s.key}: ${s.value}`).join('\n') : "Aucun secret enregistré.";

    // ============================================
    // ÉTAPE 5 : DÉTERMINATION ABSOLUE DE LA LANGUE
    // ============================================
    let currentLang = forcedLang;
    if (!currentLang) {
        if (/[\u0600-\u06FF]/.test(message)) currentLang = 'ar';
        else if (/[a-zA-Z]/.test(message) && !/[éèêëàâäîïôöùûüç]/.test(message)) currentLang = 'en';
        else currentLang = 'fr';
    }

    // On envoie tout l'historique (limité aux 30 derniers messages pour éviter la pollution)
    const fullHistory = (history || []).slice(-30);

    // ============================================
    // ÉTAPE 6 : APPEL À GROQ
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

⚠️ RÈGLE ABSOLUE N°1 : TU DOIS RÉPONDRE EXCLUSIVEMENT EN ${currentLang.toUpperCase()}.
- Si currentLang = 'fr' → FRANÇAIS uniquement.
- Si currentLang = 'en' → ANGLAIS uniquement.
- Si currentLang = 'ar' → ARABE uniquement.

⚠️ RÈGLE ABSOLUE N°2 : TU DOIS SUIVRE LE FIL DE LA DISCUSSION.
- Lis attentivement TOUT l'historique fourni ci-dessous.
- Si l'utilisateur te demande "quel est mon nom ?", cherche dans l'historique la réponse.
- Ne réponds JAMAIS de manière générique si l'information est dans l'historique.

⚠️ INTERDICTIONS :
- Ne mélange JAMAIS les langues.
- N'utilise JAMAIS le darija.
- Ne réponds JAMAIS en anglais si currentLang = 'fr' ou 'ar'.
- Ne réponds JAMAIS en français si currentLang = 'en' ou 'ar'.

INFORMATIONS PERSONNELLES :
${publicText}

SECRETS (protégés par ton nom "${agentName}") :
${privateText}

RÈGLE DE SÉCURITÉ : Ne divulgue JAMAIS les SECRETS sauf si l'utilisateur mentionne ton nom "${agentName}".

RÈGLE DE FORMAT : À la fin de CHAQUE réponse, ajoute : [[LANG:${currentLang}]]`
                    },
                    ...fullHistory
                ]
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Erreur API Groq: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        let botText = data.choices[0].message.content;

        // On force la langue à currentLang (pas de fallback)
        let detectedLang = currentLang;
        
        // Nettoyage des marqueurs de langue
        botText = botText.replace("[[LANG:en]]", "").replace("[[LANG:ar]]", "").replace("[[LANG:fr]]", "").trim();

        // ============================================
        // ÉTAPE 7 : EXTRACTION DES SECRETS
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
        if (!Array.isArray(messages)) return;
        
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
        const data = await res.json();
        return Array.isArray(data) ? data : [];
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
                    { 
                        role: "system", 
                        content: `Tu es un extracteur d'informations. Analyse l'échange et extrais UNIQUEMENT les informations personnelles importantes.

DISTINCTION CRUCIALE :
- Les informations PERSONNELLES (nom, préférences, habitudes) → is_secret = false
- Les SECRETS (mots de passe, codes, adresses, emails privés, données bancaires) → is_secret = true

Réponds UNIQUEMENT avec un JSON valide, sans texte autour, sans backticks.
Format attendu : [{"key": "nom", "value": "Fateh", "is_secret": false}]
Si rien d'important, réponds exactement : []` 
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
        
        console.log("Contenu extrait:", content);
        
        const secrets = JSON.parse(content);
        if (secrets.length === 0) {
            console.log("Aucun secret à enregistrer");
            return;
        }
        
        for (const secret of secrets) {
            console.log(`Enregistrement: ${secret.key} = ${secret.value} (secret: ${secret.is_secret})`);
            await fetch(`${supabaseUrl}/rest/v1/secrets`, {
                method: "POST",
                headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({ 
                    user_id: "fateh", 
                    key: secret.key, 
                    value: secret.value,
                    is_secret: secret.is_secret || false
                })
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
