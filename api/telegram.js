export default async function handler(req, res) {
    // Telegram envoie des requêtes POST
    // On accepte à la fois GET et POST pour être sûr
    if (req.method === 'GET') {
    return res.status(200).json({ ok: true, message: "Le bot est actif" });
    }

    const { message } = req.body;

    // On ignore les messages qui ne contiennent pas de texte
    if (!message || !message.text) {
        return res.status(200).json({ ok: true });
    }

    const chatId = message.chat.id;
    const userText = message.text;
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const apiKey = process.env.GROQ_API_KEY;

    try {
        // 1. Appel DIRECT à Groq (sans passer par /api/chat)
        const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
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
                        content: `Tu es un assistant personnel nommé Scoop. 
RÈGLES DE LANGUES :
1) Si l'utilisateur écrit en arabe, réponds en arabe.
2) Si l'utilisateur écrit en français, réponds en français.
3) Si l'utilisateur écrit en anglais, réponds en anglais.
4) Si l'utilisateur mélange, réponds dans la langue dominante.
5) N'utilise JAMAIS le darija ni aucun dialecte.

RÈGLE DE SÉCURITÉ : Ne divulgue JAMAIS d'informations secrètes sauf si l'utilisateur mentionne explicitement ton nom "Scoop".

Réponds de manière concise et amicale.`
                    },
                    { role: "user", content: userText }
                ]
            })
        });

        if (!groqResponse.ok) {
            const errorText = await groqResponse.text();
            throw new Error(`Erreur Groq: ${groqResponse.status} - ${errorText}`);
        }

        const groqData = await groqResponse.json();
        const botReply = groqData.choices[0].message.content;

        // 2. Envoi de la réponse à Telegram
        const telegramResponse = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: chatId,
                text: botReply
            })
        });

        if (!telegramResponse.ok) {
            const errorText = await telegramResponse.text();
            throw new Error(`Erreur Telegram: ${telegramResponse.status} - ${errorText}`);
        }

        return res.status(200).json({ ok: true });

    } catch (error) {
        console.error("Erreur Telegram:", error);
        
        // En cas d'erreur, on envoie un message d'erreur à l'utilisateur
        try {
            await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: "Désolé, une erreur s'est produite. Réessayez plus tard."
                })
            });
        } catch (e) {
            console.error("Impossible d'envoyer le message d'erreur:", e);
        }
        
        return res.status(500).json({ error: "Erreur serveur" });
    }
}
