export default async function handler(req, res) {
    const { text, lang } = req.query;
    
    if (!text) {
        return res.status(400).json({ error: 'Texte manquant' });
    }

    // Choix de la langue (Français, Anglais, Arabe Classique)
    // Si 'lang' n'est pas fourni, on utilise 'fr' par défaut
    let targetLang = 'fr'; 
    if (lang === 'ar') targetLang = 'ar';
    if (lang === 'en') targetLang = 'en';

    // Utilisation de l'API de traduction Google pour générer un audio de qualité
    // (Fonctionne pour FR, EN, AR)
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${targetLang}&client=tw-ob`;
    
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
