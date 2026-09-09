export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { message, history } = req.body;

    // 1. Vérification du mot de passe vocal (Pour l'heure)
    const motDePasse = "code alpha";
    if (message.toLowerCase().includes("quelle heure") || message.toLowerCase().includes("what time") || message.toLowerCase().includes("الساعة")) {
        if (message.toLowerCase().includes(motDePasse)) {
            const heure = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
            return res.status(200).json({ reply: `Il est actuellement ${heure}.` });
        } else {
            return res.status(200).json({ reply: "Désolé, je ne peux pas effectuer cette action. Vérifiez vos autorisations." });
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
                        content: "Tu es un assistant personnel multilingue. Règles de langues : 1) Si l'utilisateur écrit en arabe classique, réponds TOUJOURS en arabe classique. 2) Si l'utilisateur écrit en français, réponds en français. 3) Si l'utilisateur écrit en anglais (y compris l'anglais indien avec ses expressions et son accent), réponds TOUJOURS en anglais. 4) Si l'utilisateur utilise un mélange de langues, adapte-toi à sa langue dominante. Sois naturel, amical et précis. N'utilise JAMAIS le darija algérien ni aucun dialecte."
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
