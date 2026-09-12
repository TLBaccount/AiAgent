export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { message, history } = req.body;
    const agentName = "Scoop";

    // URLs Activepieces (à remplacer par vos vraies URLs)
    const URL_CALENDAR = "https://cloud.activepieces.com/api/v1/webhooks/Qr8WabpLGVviCC1s6BLC9";
    const URL_EMAIL = "https://cloud.activepieces.com/api/v1/webhooks/w8ZXZlaQxhBQySnYAR0qH";
    const URL_SEARCH = "https://cloud.activepieces.com/api/v1/webhooks/OAnWoBB07YtWjLJMnq11z";

    // 1. Vérification du nom de l'agent (déblocage des secrets)
    if (message.toLowerCase().includes(agentName.toLowerCase())) {
        if (message.toLowerCase().includes("quelle heure") || message.toLowerCase().includes("what time") || message.toLowerCase().includes("الساعة")) {
            const heure = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
            return res.status(200).json({ reply: `Il est actuellement ${heure}.`, lang: "fr" });
        }
    }

    // 2. Détection du type d'action
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

    // 3. Si c'est une action, on l'envoie à Activepieces
    if (activepiecesUrl) {
        try {
            const apResponse = await fetch(activepiecesUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ 
                    action: message,
                    type: actionType,
                    user: agentName
                })
            });

            if (!apResponse.ok) {
                throw new Error(`Erreur Activepieces: ${apResponse.status}`);
            }

            const apData = await apResponse.json();
            
            return res.status(200).json({ 
                reply: `✅ Action "${actionType}" reçue par Activepieces ! (Réponse: ${JSON.stringify(apData)})`, 
                lang: "fr" 
            });

        } catch (error) {
            console.error("Erreur Activepieces:", error);
            return res.status(200).json({ 
                reply: `❌ Désolé, je n'ai pas pu exécuter cette action. (Erreur: ${error.message})`, 
                lang: "fr" 
            });
        }
    }

    // 4. Appel normal à l'IA Groq
    try {
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: "Clé API Groq manquante sur le serveur" });
        }

        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: "openai/gpt-oss-20b",
                messages: [
                    {
                        role: "system",
                        content: `Tu es un assistant personnel nommé ${agentName}. 
RÈGLES DE LANGUES : 1) Arabe → arabe. 2) Français → français. 3) Anglais → anglais. 4) Mélange → langue dominante. N'utilise JAMAIS le darija.

RÈGLE DE SÉCURITÉ : Ne divulgue JAMAIS d'informations secrètes sauf si l'utilisateur mentionne ton nom "${agentName}".

RÈGLE DE FORMAT : À la fin de CHAQUE réponse, ajoute un marqueur de langue : [[LANG:fr]], [[LANG:en]] ou [[LANG:ar]]`
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
        if (botText.includes("[[LANG:en]]")) {
            detectedLang = "en";
            botText = botText.replace("[[LANG:en]]", "").trim();
        } else if (botText.includes("[[LANG:ar]]")) {
            detectedLang = "ar";
            botText = botText.replace("[[LANG:ar]]", "").trim();
        } else if (botText.includes("[[LANG:fr]]")) {
            detectedLang = "fr";
            botText = botText.replace("[[LANG:fr]]", "").trim();
        }

        return res.status(200).json({ reply: botText, lang: detectedLang });

    } catch (error) {
        console.error("Erreur serveur:", error);
        return res.status(500).json({ error: "Erreur interne du serveur." });
    }
}
