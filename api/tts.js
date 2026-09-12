export default async function handler(req, res) {
    const { text, lang } = req.query;
    if (!text) return res.status(400).json({ error: 'Texte manquant' });

    const cleanText = text.substring(0, 500).replace(/\s+/g, ' ').trim();

    // Clés API (configurées sur Vercel)
    const fishKey = process.env.FISH_AUDIO_API_KEY;
    const hakimKey = process.env.HAKIM_API_KEY;

    // IDs de voix Fish Audio
    let fishVoiceId = "a0c8d49722294220a669a2b2dd37590b"; // FR
    if (lang === 'en') fishVoiceId = "536d3a5e000945adb7038665781a4aca"; // EN
    if (lang === 'ar') fishVoiceId = "1c3294e9c96b47dc8621dc8b2283bc97"; // AR

    // IDs de voix Hakim AI
    let hakimVoiceId = "cmok1nvqa000f10ar8rpvncj4"; // AR (Khalid)
    if (lang === 'fr') hakimVoiceId = "cmokbc1wm000rvu39gzf7twui"; // FR (Temporaire)
    if (lang === 'en') hakimVoiceId = "cmok1nvo4000910arghdsayjr"; // EN (James)

    // --- Logique de cascade ---

    // 1. Si Arabe : Hakim AI en priorité (meilleure qualité native)
    if (lang === 'ar' && hakimKey) {
        try {
            const response = await fetch("https://api.tryhakim.ai/v1/audio/speech", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${hakimKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: "hakim-fast-v1",
                    input: cleanText,
                    voice: hakimVoiceId
                })
            });
            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                res.setHeader('Content-Type', 'audio/mpeg');
                return res.send(Buffer.from(arrayBuffer));
            }
            console.log("Hakim AI a échoué pour l'arabe, fallback sur Fish Audio...");
        } catch (e) {
            console.log("Erreur Hakim AI, fallback sur Fish Audio:", e.message);
        }
    }

    // 2. Fish Audio (principal pour FR/EN, fallback pour AR)
    if (fishKey) {
        try {
            const response = await fetch("https://api.fish.audio/v1/tts", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${fishKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: "s2.1-pro-free", // Le modèle va ICI, dans le body
                    text: cleanText,
                    reference_id: fishVoiceId,
                    format: "mp3"
                })
            });

            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                res.setHeader('Content-Type', 'audio/mpeg');
                return res.send(Buffer.from(arrayBuffer));
            }
            
            const errText = await response.text();
            console.log("Fish Audio a échoué:", errText);
        } catch (e) {
            console.log("Erreur Fish Audio:", e.message);
        }
    }

    // 3. Fallback ultime : Hakim AI pour FR/EN si Fish Audio échoue
    if (hakimKey && (lang === 'fr' || lang === 'en')) {
        try {
            const response = await fetch("https://api.tryhakim.ai/v1/audio/speech", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${hakimKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: "hakim-fast-v1",
                    input: cleanText,
                    voice: hakimVoiceId
                })
            });
            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                res.setHeader('Content-Type', 'audio/mpeg');
                return res.send(Buffer.from(arrayBuffer));
            }
        } catch (e) {
            console.log("Erreur Hakim AI (fallback final):", e.message);
        }
    }

    // Si tout échoue
    res.status(500).json({ error: 'Tous les fournisseurs TTS ont échoué' });
}
