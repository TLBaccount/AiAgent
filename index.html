export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const formData = await req.formData();
        const file = formData.get('file');
        
        if (!file) {
            return res.status(400).json({ error: 'Fichier audio manquant' });
        }

        const apiKey = process.env.GROQ_API_KEY;
        
        // Appel à l'API Whisper de Groq pour transcrire l'audio
        const whisperResponse = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`
            },
            body: formData // On renvoie directement le fichier audio
        });

        if (!whisperResponse.ok) {
            const errorText = await whisperResponse.text();
            throw new Error(`Erreur Whisper: ${whisperResponse.status} - ${errorText}`);
        }

        const whisperData = await whisperResponse.json();
        const transcribedText = whisperData.text;

        // Détection de la langue exacte du texte transcrit
        let lang = "fr";
        if (/[\u0600-\u06FF]/.test(transcribedText)) {
            lang = "ar";
        } else if (/[a-zA-Z]/.test(transcribedText) && !/[éèêëàâäîïôöùûüç]/.test(transcribedText)) {
            lang = "en";
        }

        return res.status(200).json({ text: transcribedText, lang: lang });

    } catch (error) {
        console.error("Erreur transcription:", error);
        return res.status(500).json({ error: "Erreur transcription" });
    }
}
