export default async function handler(req, res) {
    const { text, lang } = req.query;
    
    if (!text) {
        return res.status(400).json({ error: 'Texte manquant' });
    }

    // Nettoyage du texte
    const cleanText = text.substring(0, 200).replace(/\s+/g, ' ').trim();

    // Choix de la langue
    let targetLang = 'fr'; 
    if (lang === 'ar') targetLang = 'ar';
    if (lang === 'en') targetLang = 'en';

    // Utilisation de l'API Google Translate (gratuite et illimitée)
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(cleanText)}&tl=${targetLang}&client=tw-ob`;
    
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        
        if (!response.ok) throw new Error(`Erreur Google: ${response.status}`);
        
        const arrayBuffer = await response.arrayBuffer();
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Cache-Control', 'no-cache');
        res.send(Buffer.from(arrayBuffer));
    } catch (error) {
        console.error("Erreur TTS:", error);
        res.status(500).json({ error: 'Erreur génération audio' });
    }
}
