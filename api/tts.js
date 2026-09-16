function cleanForSpeech(text) {
    // Retirer les emojis DÉCORATIFS (mais garder les sentiments)
    const decorativeEmojis = /[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E0}-\u{1F1FF}\u{1F191}-\u{1F251}\u{1F004}\u{1F0CF}\u{1F170}-\u{1F171}\u{1F17E}-\u{1F17F}\u{1F18E}\u{3030}\u{2B50}\u{2B55}\u{2934}-\u{2935}\u{2B05}-\u{2B07}\u{2B1B}-\u{2B1C}\u{3297}\u{3299}\u{303D}\u{00A9}\u{00AE}\u{2122}\u{2139}\u{2194}-\u{2199}\u{21A9}-\u{21AA}\u{231A}-\u{231B}\u{2328}\u{23CF}\u{23E9}-\u{23F3}\u{23F8}-\u{23FA}\u{24C2}\u{25AA}-\u{25AB}\u{25B6}\u{25C0}\u{25FB}-\u{25FE}\u{2600}-\u{2604}\u{260E}\u{2611}\u{2614}-\u{2615}\u{2618}\u{261D}\u{2620}\u{2622}-\u{2623}\u{2626}\u{262A}\u{262E}-\u{262F}\u{2638}-\u{263A}\u{2640}\u{2642}\u{2648}-\u{2653}\u{265F}\u{2660}\u{2663}\u{2665}-\u{2666}\u{2668}\u{267B}\u{267E}\u{267F}\u{2692}-\u{2697}\u{2699}\u{269B}-\u{269C}\u{26A0}-\u{26A1}\u{26AA}-\u{26AB}\u{26B0}-\u{26B1}\u{26BD}-\u{26BE}\u{26C4}-\u{26C5}\u{26C8}\u{26CE}\u{26CF}\u{26D1}\u{26D3}\u{26D4}\u{26E9}\u{26EA}\u{26F0}-\u{26F5}\u{26F7}-\u{26FA}\u{26FD}\u{2702}\u{2705}\u{2708}-\u{270D}\u{270F}\u{2712}\u{2714}\u{2716}\u{271D}\u{2721}\u{2728}\u{2733}-\u{2734}\u{2744}\u{2747}\u{274C}\u{274E}\u{2753}-\u{2755}\u{2757}\u{2763}-\u{2764}\u{2795}-\u{2797}\u{27A1}\u{27B0}\u{27BF}]/gu;

    // Retirer les emojis décoratifs
    let cleaned = text.replace(decorativeEmojis, '');

    // Retirer les caractères de formatage
    cleaned = cleaned
        .replace(/\*\*/g, '')       // Gras Markdown
        .replace(/\*/g, '')          // Italique Markdown
        .replace(/_/g, '')           // Italique
        .replace(/`/g, '')           // Code
        .replace(/#{1,6}\s/g, '')    // Titres
        .replace(/[–—]/g, ', ')      // Tirets longs
        .replace(/-/g, ', ')         // Tirets
        .replace(/━+/g, '. ')        // Séparateurs
        .replace(/•/g, ', ')         // Puces
        .replace(/\|/g, ' ')         // Barres
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Liens [texte](url) → texte
        .replace(/\s+/g, ' ')        // Espaces multiples
        .trim();

    return cleaned;
}

export default async function handler(req, res) {
    const { text, lang } = req.query;
    if (!text) return res.status(400).json({ error: 'Texte manquant' });

    // Nettoyer le texte pour la lecture
    const cleanText = cleanForSpeech(text);
    
    if (!cleanText) {
        return res.status(400).json({ error: 'Texte vide après nettoyage' });
    }

    // Clés API
    const azureKey = process.env.AZURE_SPEECH_KEY;
    const azureRegion = process.env.AZURE_SPEECH_REGION;
    const hakimKey = process.env.HAKIM_API_KEY;

    // Voix Azure masculines
    let azureVoice = "fr-FR-HenriNeural";
    let azureLang = "fr-FR";
    if (lang === 'en') { azureVoice = "en-US-GuyNeural"; azureLang = "en-US"; }
    if (lang === 'ar') { azureVoice = "ar-SA-HamedNeural"; azureLang = "ar-SA"; }

    // IDs Hakim (fallback)
    let hakimVoiceId = "cmok1nvqa000f10ar8rpvncj4";
    if (lang === 'fr') hakimVoiceId = "cmokbc1wm000rvu39gzf7twui";
    if (lang === 'en') hakimVoiceId = "cmok1nvo4000910arghdsayjr";

    // --- 1. Azure TTS (Priorité) ---
    if (azureKey && azureRegion) {
        try {
            const ssml = `<speak version='1.0' xml:lang='${azureLang}'>
                <voice name='${azureVoice}'>${cleanText}</voice>
            </speak>`;

            const response = await fetch(`https://${azureRegion}.tts.speech.microsoft.com/cognitiveservices/v1`, {
                method: "POST",
                headers: {
                    "Ocp-Apim-Subscription-Key": azureKey,
                    "Content-Type": "application/ssml+xml",
                    "X-Microsoft-OutputFormat": "audio-16khz-32kbitrate-mono-mp3",
                    "User-Agent": "Scoop"
                },
                body: ssml
            });

            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                res.setHeader('Content-Type', 'audio/mpeg');
                res.setHeader('Cache-Control', 'no-cache');
                return res.send(Buffer.from(arrayBuffer));
            }
            const errText = await response.text();
            console.log("Azure a échoué:", errText);
        } catch (e) {
            console.log("Erreur Azure:", e.message);
        }
    }

    // --- 2. Fallback : Hakim AI ---
    if (hakimKey) {
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
                res.setHeader('Cache-Control', 'no-cache');
                return res.send(Buffer.from(arrayBuffer));
            }
        } catch (e) {
            console.log("Erreur Hakim AI:", e.message);
        }
    }

    res.status(500).json({ error: 'Tous les fournisseurs TTS ont échoué' });
}
