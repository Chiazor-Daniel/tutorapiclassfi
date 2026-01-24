
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));


const SYSTEM_INSTRUCTION = `
You are Easy PrepAI, an elite STEM tutor. Your goal is to simulate a real whiteboard experience with engaging audio commentary.

BOARD RULES:
1. Use LaTeX for ALL mathematical symbols, equations, and expressions on the board.
   - Use $ for inline math (e.g., $x^2$).
   - Use $$ for centered or complex equations.
2. For 'explain' actions:
   - 'content' is the summary for the screen (can include LaTeX).
   - 'audioScript' MUST be purely spoken English.
   - CRITICAL: Do NOT use LaTeX or symbols like $, ^, _, or \\ in the audioScript.
   - Instead, write words: "x squared" instead of $x^2$, "the integral from a to b" instead of $\\int_a^b$.
   - Make it sound like a human teacher is speaking.
   - ALWAYS end every sentence with a period to help the TTS engine stop correctly.

Output as JSON ONLY.
`;

const responseSchema = {
    type: "OBJECT",
    properties: {
        lesson: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    action: {
                        type: "STRING",
                        description: "Either 'write' or 'explain'",
                    },
                    content: {
                        type: "STRING",
                        description: "The text to write on the board or the written explanation.",
                    },
                    audioScript: {
                        type: "STRING",
                        description: "The conversational script to be spoken aloud by the AI for 'explain' actions.",
                    },
                    position: {
                        type: "STRING",
                        description: "The layout position on the board: top, center, below.",
                    }
                },
                required: ["action", "content"],
                propertyOrdering: ["action", "content", "audioScript", "position"]
            }
        }
    },
    required: ["lesson"]
};

const genAI = new GoogleGenerativeAI('AIzaSyBf21gmfNk2ts4Tn9fgyKTXhK3RDlSl2uk');

app.post('/api/lesson', async (req, res) => {
    const { prompt, files } = req.body;

    try {
        // Use gemini-2.0-flash or similar modern model if available, or fall back to pro. 
        // The frontend used gemini-2.0-flash. Let's try to stick to a known good model or what's in the env.
        // If the user's key supports it, great. If not, we might need a fallback. 
        // We'll stick to 'gemini-1.5-pro' or 'gemini-2.0-flash' as requested. 
        // Note: The frontend code said 'gemini-2.5-flash' which might be a typo or a newer preview. 
        // Let's use 'gemini-1.5-flash' or 'gemini-1.5-pro' for stability unless 2.0 is confirmed.
        // Actually, let's use what was in the backend originally ('gemini-1.5-pro') but update the config.

        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            systemInstruction: SYSTEM_INSTRUCTION,
        });

        const parts = [{ text: prompt || "Solve the problem shown." }];

        if (files && files.length > 0) {
            files.forEach(file => {
                // Ensure correct structure for InlineData
                parts.push({
                    inlineData: {
                        data: file.data,
                        mimeType: file.type
                    }
                });
            });
        }

        const result = await model.generateContent({
            contents: [{ role: 'user', parts }],
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: responseSchema,
            }
        });

        const response = await result.response;
        const text = response.text();
        res.json(JSON.parse(text));
    } catch (error) {
        console.error("Backend Error:", error);
        // Fallback or detailed error
        res.status(500).json({ error: "Failed to generate lesson", details: error.message });
    }
});


// Simple test endpoint
app.get('/api/test', (req, res) => {
    res.json({ status: 'ok', message: 'API is working!' });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
