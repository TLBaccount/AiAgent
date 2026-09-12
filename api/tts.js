export default async function handler(req, res) {
    const { text, lang } = req.query;
    if (!text) return res.status(400).json({ error: 'Texte manquant' });

    const cleanText = text.substring(0, 500).replace(/\s+/g, ' ').trim();

    // Clés API
    const azureKey = process.env.AZURE_SPEECH_KEY;
    const azureRegion = process.env.AZURE_SPEECH_REGION;
    const hakimKey = process.env.HAKIM_API_KEY;

    // Voix Azure (FR, EN, AR)
    let azureVoice = "fr-FR-DeniseNeural"; // FR (voix féminine naturelle)
    let azureLang = "fr-FR";
    if (lang === 'en') { azureVoice = "en-US-JennyNeural"; azureLang = "en-US"; }
    if (lang === 'ar') { azureVoice = "ar-SA-ZariyahNeural"; azureLang = "ar-SA"; }

    // IDs de voix Hakim AI (fallback)
    let hakimVoiceId = "cmok1nvqa000f10ar8rpvncj4"; // AR
    if (lang === 'fr') hakimVoiceId = "cmokbc1wm000rvu39gzf7twui"; // FR
    if (lang === 'en') hakimVoiceId = "cmok1nvo4000910arghdsayjr"; // EN

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

    // --- 2. Fallback : Hakim AI (pour toutes les langues) ---
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
            console.log("Erreur Hakim AI (fallback):", e.message);
        }
    }

    // Si tout échoue
    res.status(500).json({ error: 'Tous les fournisseurs TTS ont échoué' });
}
