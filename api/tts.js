export default async function handler(req, res) {
    const { text, lang } = req.query;

    if (!text) {
        return res.status(400).json({ error: 'Texte manquant' });
    }

    // Nettoyage du texte
    const cleanText = text.substring(0, 500).replace(/\s+/g, ' ').trim();

    // Choix de la voix (ID de modèle Fish Audio)
    // Références : 
    // Français : f3f1d5e0-6a2b-4b1d-9b2c-1f3a5d7e9b01
    // Anglais : 7f2b3a5c-8e1d-4f6a-9c3b-2e5d7a9c1f03
    // Arabe : 6a4e3b2d-8c1f-4a5e-9d7b-3f2a1c4e5d67
    let voiceId = "79d0bd3e4e5444b18f7b6d89b5927bf1"; // Français par défaut
    if (lang === 'en') voiceId = "79d0bd3e4e5444b18f7b6d89b5927bf1";
    if (lang === 'ar') voiceId = "79d0bd3e4e5444b18f7b6d89b5927bf1";

    try {
        // 1. Générer l'audio avec Fish Audio
        const ttsResponse = await fetch("https://api.fish.audio/v1/tts", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.FISH_AUDIO_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "s2.1-pro-free", // Modèle gratuit de qualité professionnelle
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
