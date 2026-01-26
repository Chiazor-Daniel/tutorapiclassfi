const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { UniversalEdgeTTS } = require('edge-tts-universal');
const gTTS = require('gtts');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const SYSTEM_INSTRUCTION = `
You are Easy PrepAI, an elite STEM tutor. Use LaTeX for math ($x^2$). 
For 'explain' actions, the 'audioScript' MUST be plain English.
End every sentence with a period. Output as JSON ONLY.
`;

const responseSchema = {
    type: "OBJECT",
    properties: {
        lesson: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    action: { type: "STRING" },
                    content: { type: "STRING" },
                    audioScript: { type: "STRING" },
                    position: { type: "STRING" }
                },
                required: ["action", "content"]
            }
        }
    },
    required: ["lesson"]
};

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 1. AI LESSON ENDPOINT
app.post('/api/lesson', async (req, res) => {
    const { prompt, files } = req.body;
    try {
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash', // <--- STICKING TO YOUR MODEL
            systemInstruction: SYSTEM_INSTRUCTION,
        });

        const parts = [{ text: prompt || "Explain the concept." }];
        if (files && files.length > 0) {
            files.forEach(file => parts.push({ inlineData: { data: file.data, mimeType: file.type } }));
        }

        const result = await model.generateContent({
            contents: [{ role: 'user', parts }],
            generationConfig: { responseMimeType: "application/json", responseSchema }
        });

        res.json(JSON.parse(result.response.text()));
    } catch (error) {
        console.error("AI Error:", error.message);
        res.status(500).json({ error: "AI Generation Failed", details: error.message });
    }
});

// 2. TTS ENDPOINT
app.get('/api/tts', async (req, res) => {
    const text = req.query.text;
    if (!text) return res.status(400).send("No text provided");
    try {
        // Change 'en-US-AndrewNeural' to 'en-NG-AbeoNeural' (Male) or 'en-NG-EbiNeural' (Female)
        const tts = new UniversalEdgeTTS(text, 'en-NG-AbeoNeural');
        const result = await Promise.race([
            tts.synthesize(),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 7000))
        ]);
        const audioBuffer = Buffer.from(await result.audio.arrayBuffer());
        res.set({ 'Content-Type': 'audio/mpeg', 'Content-Length': audioBuffer.length });
        res.send(audioBuffer);
    } catch (error) {
        console.warn("Neural TTS failed, using fallback.");
        const fallback = new gTTS(text, 'en');
        res.set('Content-Type', 'audio/mpeg');
        fallback.stream().pipe(res);
    }
});

app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Server ready at http://localhost:${port}`);
});