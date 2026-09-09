export default async function handler(req, res) {
    const { text } = req.query;
    if (!text) {
        return res.status(400).json({ error: 'Texte manquant' });
    }

    // Utilisation de l'API de traduction de Google pour générer l'audio (voix arabe)
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=ar&client=tw-ob`;
    
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
