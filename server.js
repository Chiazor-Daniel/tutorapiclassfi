const express = require("express");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();
const { UniversalEdgeTTS } = require("edge-tts-universal");
const gTTS = require("gtts");
const http = require("http");
const { exit } = require("process");

const app = express();
const port = process.env.PORT || 4000;

// Create HTTP server
const server = http.createServer(app);

// Handle process termination gracefully
process.on("SIGTERM", () => {
  console.log("SIGTERM received. Shutting down gracefully...");
  server.close(() => {
    console.log("Server closed");
    exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("SIGINT received. Shutting down gracefully...");
  server.close(() => {
    console.log("Server closed");
    exit(0);
  });
});

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// System instruction with enhanced organic chemistry support
const SYSTEM_INSTRUCTION = `
You are Easy PrepAI, an elite STEM tutor that creates engaging, step-by-step lessons across all STEM subjects.

GENERAL RULES:
1. Output as JSON ONLY with the specified schema
2. Each lesson step must have a unique ID
3. For visual elements, use the 'visual' field with appropriate type and data
4. Always provide clear, conversational audio scripts without symbols

MATH CONTENT:
- Use LaTeX for all equations: $x^2$, $$\int_a^b f(x) dx$$
- For diagrams, use ASCII art or provide SVG data

CHEMISTRY CONTENT:
- Use mhchem for formulas: \\ce{H2O}, \\ce{2H2 + O2 -> 2H2O}
- For organic structures, provide SMILES notation in the 'visual' field
- Common SMILES examples:
  - Propane: CCC
  - Benzene: c1ccccc1
  - Glucose: OC[C@H]1OC(O)[C@H](O)[C@@H](O)[C@@H]1O
  - Ethanol: CCO
  - Methane: C

PHYSICS CONTENT:
- Use LaTeX for equations: $$F = ma$$, $$E = mc^2$$
- For diagrams (circuits, vectors), provide SVG or ASCII art

VISUAL ELEMENTS:
Use the 'visual' field with:
- type: "smiles" (organic structures), "svg" (custom diagrams), "ascii" (simple diagrams), "graph" (charts)
- data: The actual content (SMILES string, SVG markup, ASCII art, or Chart.js config)
- width/height: Optional dimensions

AUDIO SCRIPT RULES:
- Must be purely spoken English
- Write out all symbols: "x squared" instead of $x^2$, "water" instead of H2O
- Make it conversational and engaging
- Always end sentences with periods
`;

const responseSchema = {
  type: "OBJECT",
  properties: {
    lesson: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          action: {
            type: "STRING",
            enum: ["write", "explain", "draw"],
          },
          content: {
            type: "STRING",
            description: "The text to display on the board",
          },
          audioScript: {
            type: "STRING",
            description: "The conversational script for audio explanation",
          },
          position: {
            type: "STRING",
            enum: ["top", "center", "below"],
            default: "center",
          },
          visual: {
            type: "OBJECT",
            properties: {
              type: {
                type: "STRING",
                enum: ["smiles", "svg", "ascii", "graph"],
              },
              data: {
                type: "STRING",
                description: "Visual data (SMILES, SVG, ASCII, etc.)",
              },
              width: { type: "NUMBER" },
              height: { type: "NUMBER" },
            },
            required: ["type", "data"],
          },
        },
        required: ["id", "action", "content"],
      },
    },
  },
  required: ["lesson"],
};

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

// Test endpoint
app.get("/api/test", (req, res) => {
  res.json({
    status: "ok",
    message: "API is working!",
    timestamp: new Date().toISOString(),
  });
});

// Lesson generation endpoint
app.post("/api/lesson", async (req, res) => {
  const { prompt, files } = req.body;

  if (!prompt && (!files || files.length === 0)) {
    return res.status(400).json({
      error: "Either prompt or files must be provided",
    });
  }

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-pro",
      systemInstruction: SYSTEM_INSTRUCTION,
    });

    const parts = [{ text: prompt || "Explain the following STEM concept." }];

    if (files && files.length > 0) {
      files.forEach((file) => {
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

    try {
      const parsed = JSON.parse(text);
      res.json(parsed);
    } catch (parseError) {
      console.error("Failed to parse response:", parseError);
      res.status(500).json({
        error: "Invalid response format from AI model",
        details: parseError.message,
        rawResponse: text,
      });
    }
  } catch (error) {
    console.error("Backend Error:", error);
    res.status(500).json({
      error: "Failed to generate lesson",
      details: error.message,
      fallbackLesson: [
        {
          id: "error1",
          action: "write",
          content: "Sorry, I couldn't generate this lesson. Please try again.",
          position: "center",
        },
      ],
    });
  }
});

// TTS endpoint
app.get("/api/tts", async (req, res) => {
  const text = req.query.text;
  if (!text) return res.status(400).send("No text provided");

  console.log(`[TTS] Request: "${text.substring(0, 30)}..."`);

  try {
    const tts = new UniversalEdgeTTS(text, "en-NG-AbeoNeural");
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
    try {
      const fallback = new gTTS(text, "en");
      res.set("Content-Type", "audio/mpeg");
      fallback.stream().pipe(res);
    } catch (err) {
      console.error("TTS fallback failed:", err);
      res.status(500).send("TTS failed");
    }
  }
});

// Start server
server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  console.log(`Health check available at http://localhost:${port}/health`);
});

// Handle server errors
server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use`);
  } else {
    console.error("Server error:", error);
  }
  exit(1);
});
