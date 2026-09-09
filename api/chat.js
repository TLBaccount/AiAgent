export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { message, history } = req.body;
    const agentName = "Scoop";

    // 1. Si l'utilisateur mentionne le nom de l'agent, on débloque les informations secrètes
    if (message.toLowerCase().includes(agentName.toLowerCase())) {
        // Exemple : s'il demande l'heure avec le nom, il l'obtient
        if (message.toLowerCase().includes("quelle heure") || message.toLowerCase().includes("what time") || message.toLowerCase().includes("الساعة")) {
            const heure = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
            return res.status(200).json({ reply: `Il est actuellement ${heure}.` });
        }
        
        // Vous pouvez ajouter ici d'autres secrets (emails, fichiers, etc.)
        // Exemple : if (message.toLowerCase().includes("mon email")) { return res.status(200).json({ reply: "votre_email@exemple.com" }); }
    }

    // 2. Sinon, on fait un appel standard à l'IA Groq
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
                        content: `Tu es un assistant personnel nommé ${agentName}. Règles de langues : 1) Si l'utilisateur écrit en arabe classique, réponds TOUJOURS en arabe classique. 2) Si l'utilisateur écrit en français, réponds en français. 3) Si l'utilisateur écrit en anglais (y compris l'anglais indien avec ses expressions et son accent), réponds TOUJOURS en anglais. 4) Si l'utilisateur utilise un mélange de langues, adapte-toi à sa langue dominante. Sois naturel, amical et précis. N'utilise JAMAIS le darija algérien ni aucun dialecte. Règle de sécurité : Tu ne dois JAMAIS divulguer d'informations secrètes (mots de passe, données personnelles, adresses, etc.) sauf si l'utilisateur mentionne explicitement ton nom (${agentName}) dans sa demande.`
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
        return res.status(200).json({ reply: data.choices[0].message.content });

    } catch (error) {
        console.error("Erreur serveur:", error);
        return res.status(500).json({ error: "Erreur interne du serveur. Vérifiez la clé API Groq ou le modèle." });
    }
}
