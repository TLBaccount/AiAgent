export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { message, history } = req.body;

    // Vérification simple de l'heure
    if (message.toLowerCase().includes("quelle heure") || message.toLowerCase().includes("what time")) {
        const heure = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        return res.status(200).json({ reply: `Il est actuellement ${heure}.` });
    }

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
                        content: "Tu es un assistant personnel multilingue. RÈGLES STRICTES DE LANGUES : 1) Si l'utilisateur écrit en ANGLAIS (y compris anglais indien), réponds UNIQUEMENT en anglais. 2) Si l'utilisateur écrit en FRANÇAIS, réponds en français. 3) Si l'utilisateur écrit en ARABE CLASSIQUE (Fusha), réponds en arabe classique. 4) INTERDICTION ABSOLUE de répondre en Darija algérien ou dans tout autre dialecte arabe, même si l'utilisateur en parle. 5) Utilise des phrases courtes et aérées. N'utilise pas de tableaux sauf demande explicite."
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
