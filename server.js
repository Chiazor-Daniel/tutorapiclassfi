const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();
const { UniversalEdgeTTS } = require("edge-tts-universal");
const gTTS = require("gtts");

const app = express();
const port = process.env.PORT || 4000;

// Log HTTP requests
app.use(morgan("dev"));
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Log responses
app.use((req, res, next) => {
  const originalSend = res.send;
  res.send = function (body) {
    console.log(
      `[Response] ${req.method} ${req.path} - Status: ${res.statusCode}`,
    );
    if (body && typeof body === "string") {
      console.log(
        `[Response Body] ${body.substring(0, 200)}${body.length > 200 ? "..." : ""}`,
      );
    }
    originalSend.call(this, body);
  };
  next();
});

const SYSTEM_INSTRUCTION = `
You are Easy PrepAI, an elite STEM tutor. Your goal is to create engaging, step-by-step lessons across all STEM subjects with proper visual representations.

GENERAL RULES:
1. Output as JSON ONLY with the specified schema
2. Each lesson step must have a unique ID
3. For visual elements, use the 'visual' field with appropriate type and data
4. Always provide clear, conversational audio scripts without symbols

MATH CONTENT:
- Use LaTeX for all equations and symbols
- Inline math: $...$ (e.g., $x^2$)
- Display math: $$...$$ (e.g., $$\int_a^b f(x) dx$$)
- For diagrams, use ASCII art or provide SVG data

CHEMISTRY CONTENT:
- Use mhchem for formulas: \\ce{H2O}, \\ce{2H2 + O2 -> 2H2O}
- For organic structures, provide SMILES notation
- For reaction mechanisms, use ASCII art or SVG

PHYSICS CONTENT:
- Use LaTeX for equations: $$F = ma$$, $$E = mc^2$$
- For diagrams (circuits, vectors), provide SVG or ASCII art

ORGANIC CHEMISTRY:
- Provide SMILES notation for molecular structures
- Example: Benzene = "c1ccccc1"
- Example: Glucose = "OC[C@H]1OC(O)[C@H](O)[C@@H](O)[C@@H]1O"

VISUAL ELEMENTS:
Use the 'visual' field with:
- type: "smiles" (organic structures), "svg" (custom diagrams), "ascii" (simple diagrams)
- data: The actual content (SMILES string, SVG markup, or ASCII art)
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

app.post("/api/lesson", async (req, res) => {
  const { prompt, files } = req.body;
  console.log(
    `[Lesson Request] Prompt: "${prompt?.substring(0, 100)}${prompt?.length > 100 ? "..." : ""}"`,
  );
  console.log(`[Lesson Request] Files: ${files?.length || 0} file(s)`);

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
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
    console.log(
      `[Lesson Response] Generated content: ${text.substring(0, 200)}...`,
    );
    res.json(JSON.parse(text));
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
      res.status(500).send("TTS failed");
    }
  }
});

app.get("/api/test", (req, res) => {
  res.json({ status: "ok", message: "API is working!" });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
