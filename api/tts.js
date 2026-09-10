export default async function handler(req, res) {
    const { text, lang } = req.query;

    if (!text) {
        return res.status(400).json({ error: 'Texte manquant' });
    }

    // Nettoyage du texte
    const cleanText = text.substring(0, 500).replace(/\s+/g, ' ').trim();

    // Choix de la voix (ID de modèle Fish Audio)
    // Les IDs que vous avez mis sont bons !
    let voiceId = "fe118d40f7e042dd86143e2938f0cc2e"; // Français par défaut
    if (lang === 'en') voiceId = "79d0bd3e4e5444b18f7b6d89b5927bf1"; // Anglais (Jordan)
    if (lang === 'ar') voiceId = "22a57197aa594615b96575b9cb021419"; // Arabe

    try {
        // 1. Générer l'audio avec Fish Audio
        const ttsResponse = await fetch("https://api.fish.audio/v1/tts", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.FISH_AUDIO_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                text: cleanText,
                voice: {
                    id: voiceId
                }
            })
        });

        if (!ttsResponse.ok) {
            const errorText = await ttsResponse.text();
            throw new Error(`Erreur Fish Audio: ${ttsResponse.status} - ${errorText}`);
        }

        // 2. Renvoyer l'audio au navigateur
        const arrayBuffer = await ttsResponse.arrayBuffer();
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Cache-Control', 'no-cache');
        res.send(Buffer.from(arrayBuffer));

    } catch (error) {
        console.error("Erreur TTS:", error);
        res.status(500).json({ error: 'Erreur génération audio' });
    }
}
