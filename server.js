const express = require("express");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();
const { UniversalEdgeTTS } = require("edge-tts-universal");
const gTTS = require("gtts");

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));

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
            description:
              "The text to write on the board or the written explanation.",
          },
          audioScript: {
            type: "STRING",
            description:
              "The conversational script to be spoken aloud by the AI for 'explain' actions.",
          },
          position: {
            type: "STRING",
            description:
              "The layout position on the board: top, center, below.",
          },
        },
        required: ["action", "content"],
        propertyOrdering: ["action", "content", "audioScript", "position"],
      },
    },
  },
  required: ["lesson"],
};

const EXPLAIN_CONCEPT_SYSTEM_INSTRUCTION = `
You are an expert STEM tutor specializing in making complex concepts easy to understand.
Your goal is to provide a comprehensive explanation of a given subtopic within a subject and topic.

FORMATTING RULES:
1. Use Markdown for formatting: **bold** for emphasis, *italic* for secondary emphasis.
2. Use LaTeX for ALL mathematical symbols, equations, and expressions.
   - Use $ for inline math (e.g., $x^2 + y^2 = r^2$).
   - Use $$ for displayed math (e.g., $$E = mc^2$$).
   - Use proper LaTeX syntax for fractions (\\frac{a}{b}), roots (\\sqrt{x}), subscripts (x_1), etc.
3. Steps should be logical, clear, and build upon each other.
4. For calculation-based topics (Math, Physics, Chemistry):
   - Include the problem statement or core concept.
   - Show step-by-step calculations with LaTeX.
   - Define variables clearly.
5. For theory-based topics (Biology, Concepts):
   - Break down into 4-6 logical steps.
   - Explain the mechanism, components, and relationships.
   - Conclude with significance or applications.

Output as JSON ONLY.
`;

const EXPLAIN_CONCEPT_SCHEMA = {
  type: "OBJECT",
  properties: {
    explanation: {
      type: "STRING",
      description: "Main explanation text (markdown supported)",
    },
    steps: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: {
            type: "STRING",
            description: "Unique identifier for each step (e.g., step-1, step-2)",
          },
          text: {
            type: "STRING",
            description: "Step content (supports markdown & LaTeX)",
          },
        },
        required: ["id", "text"],
      },
    },
  },
  required: ["explanation", "steps"],
};

const explanationCache = new Map();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post("/api/lesson", async (req, res) => {
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
      model: "gemini-2.5-flash",
      systemInstruction: SYSTEM_INSTRUCTION,
    });

    const parts = [{ text: prompt || "Solve the problem shown." }];

    if (files && files.length > 0) {
      files.forEach((file) => {
        // Ensure correct structure for InlineData
        parts.push({
          inlineData: {
            data: file.data,
            mimeType: file.type,
          },
        });
      });
    }

    const result = await model.generateContent({
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: responseSchema,
      },
    });

    const response = await result.response;
    const text = response.text();
    res.json(JSON.parse(text));
  } catch (error) {
    console.error("Backend Error:", error);
    // Fallback or detailed error
    res
      .status(500)
      .json({ error: "Failed to generate lesson", details: error.message });
  }
});

// Simple test endpoint
app.get("/api/test", (req, res) => {
  res.json({ status: "ok", message: "API is working!" });
});

app.get("/api/tts", async (req, res) => {
  const text = req.query.text;
  if (!text) return res.status(400).send("No text provided");

  console.log(`[TTS] Request: "${text.substring(0, 30)}..."`);

  try {
    // High-Quality Neural Voice (Nigerian Male)
    const tts = new UniversalEdgeTTS(text, "en-NG-AbeoNeural");

    // Race synthesis against a timeout to prevent CMD hanging
    const result = await Promise.race([
      tts.synthesize(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), 7000),
      ),
    ]);

    const audioBuffer = Buffer.from(await result.audio.arrayBuffer());

    res.set({
      "Content-Type": "audio/mpeg",
      "Content-Length": audioBuffer.length,
    });
    res.send(audioBuffer);
  } catch (error) {
    console.warn(`[TTS] Neural failed: ${error.message}. Using fallback...`);

    // Fallback: Standard Google TTS (Always works)
    try {
      const fallback = new gTTS(text, "en");
      res.set("Content-Type", "audio/mpeg");
      fallback.stream().pipe(res);
    } catch (err) {
      res.status(500).send("TTS failed");
    }
  }
});

app.post("/api/gamification/explain-concept", async (req, res) => {
  const { subject, topic, subtopic, context = "simulation" } = req.body;

  if (!subject || !topic || !subtopic) {
    return res.status(400).json({
      error: "Invalid request",
      message: "subject, topic, and subtopic are required fields.",
    });
  }

  const cacheKey = `${subject}:${topic}:${subtopic}:${context}`.toLowerCase();

  if (explanationCache.has(cacheKey)) {
    console.log(`[Cache Hit] ${cacheKey}`);
    return res.json(explanationCache.get(cacheKey));
  }

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: EXPLAIN_CONCEPT_SYSTEM_INSTRUCTION,
    });

    const prompt = `
      Subject: ${subject}
      Topic: ${topic}
      Subtopic: ${subtopic}
      Context: ${context}

      Please provide a detailed explanation with step-by-step breakdown.
      If it's a science or math topic, ensure mathematical rigor and use LaTeX.
      If it's a theoretical concept, break down the process or mechanism clearly.
    `;

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: EXPLAIN_CONCEPT_SCHEMA,
      },
    });

    const response = await result.response;
    const text = response.text();
    const parsedData = JSON.parse(text);

    // Store in cache
    explanationCache.set(cacheKey, parsedData);

    res.json(parsedData);
  } catch (error) {
    console.error("Concept Explanation Error:", error);
    res.status(500).json({
      error: "AI generation failed",
      message: error.message,
    });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
