export default async function handler(req, res) {
    const { text, lang } = req.query;
    
    if (!text) {
        return res.status(400).json({ error: 'Texte manquant' });
    }

    // Ne pas envoyer trop de texte d'un coup (sinon Google bloque)
    const cleanText = text.substring(0, 200).replace(/[^\w\s\u0600-\u06FF.,!?]/g, '');

    // Choix de la langue
    let targetLang = 'fr'; 
    if (lang === 'ar') targetLang = 'ar';
    if (lang === 'en') targetLang = 'en';

    // Utilisation de l'API de traduction Google pour générer un audio de qualité
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(cleanText)}&tl=${targetLang}&client=tw-ob`;
    
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Erreur API');
        
        const arrayBuffer = await response.arrayBuffer();
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Cache-Control', 'no-cache');
        res.send(Buffer.from(arrayBuffer));
    } catch (error) {
        res.status(500).json({ error: 'Erreur génération audio' });
    }
}
