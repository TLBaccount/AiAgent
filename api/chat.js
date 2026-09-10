export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { message, history } = req.body;
    const agentName = "Scoop";

    // 1. Vérification du nom de l'agent (déblocage des secrets)
    if (message.toLowerCase().includes(agentName.toLowerCase())) {
        if (message.toLowerCase().includes("quelle heure") || message.toLowerCase().includes("what time") || message.toLowerCase().includes("الساعة")) {
            const heure = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
            return res.status(200).json({ reply: `Il est actuellement ${heure}.`, lang: "fr" });
        }
    }

    // 2. Appel à l'IA Groq
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
RÈGLES DE LANGUES (STRICTES) :
1) Si le dernier message de l'utilisateur est en arabe, réponds en arabe.
2) Si le dernier message de l'utilisateur est en français, réponds en français.
3) Si le dernier message de l'utilisateur est en anglais, réponds en anglais.
4) Si le dernier message est un mélange, réponds dans la langue dominante.
5) N'utilise JAMAIS le darija ni aucun dialecte.

RÈGLE DE SÉCURITÉ : Ne divulgue JAMAIS d'informations secrètes sauf si l'utilisateur mentionne explicitement ton nom "${agentName}".

RÈGLE DE FORMAT (TRÈS IMPORTANTE) :
À la fin de CHAQUE réponse, tu DOIS ajouter un marqueur de langue sur une nouvelle ligne, sous cette forme exacte :
[[LANG:fr]] pour le français
[[LANG:en]] pour l'anglais
[[LANG:ar]] pour l'arabe
Exemple : "Bonjour ! [[LANG:fr]]"`
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

        // 3. Extraction du marqueur de langue
        let detectedLang = "fr"; // Par défaut
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
        return res.status(500).json({ error: "Erreur interne du serveur. Vérifiez la clé API Groq ou le modèle." });
    }
}
