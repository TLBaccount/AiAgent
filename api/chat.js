export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { message, history } = req.body;
    const motDePasse = "code alpha"; // Le secret est maintenant caché ici !
    const apiKey = process.env.GROQ_API_KEY; // La clé Groq est lue depuis Vercel

    // Vérification des actions secrètes (Heure)
    if (message.toLowerCase().includes("quelle heure") || message.toLowerCase().includes("l'heure")) {
        if (message.toLowerCase().includes(motDePasse)) {
            const heure = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
            return res.status(200).json({ reply: `Il est actuellement ${heure}.` });
        } else {
            return res.status(200).json({ reply: "Désolé, je ne peux pas effectuer cette action. Vérifiez vos autorisations." });
        }
    }

    // Appel à Groq
    try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: "openai/gpt-oss-20b",
                messages: [
                    { role: "system", content: "Tu es un assistant personnel. Si l'utilisateur parle en Darija (algérien), réponds en Darija avec les expressions locales. Si l'utilisateur parle en français, réponds en français. Si l'utilisateur parle en arabe, réponds en arabe. Si l'utilisateur parle en anglais, réponds en anglais. Sois naturel et amical. **Pour les données comparatives, utilise des tableaux Markdown classiques avec des pipes (|). Pour le reste, utilise des phrases courtes et aérées.**" },
                    ...history
                ]
            })
        });

        const data = await response.json();
        return res.status(200).json({ reply: data.choices[0].message.content });
    } catch (error) {
        return res.status(500).json({ error: "Erreur serveur" });
    }
}
