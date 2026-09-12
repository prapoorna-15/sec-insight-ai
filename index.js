import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { PDFParse } from 'pdf-parse';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const DOCS_DIR = path.join(process.cwd(), 'MyDocs');

// 1. Initialize Gemini Client using your specific env key variable
const apiKey = process.env.GEMINI_API_KEY_SEC_INSIGHT || process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("❌ ERROR: GEMINI_API_KEY_SEC_INSIGHT is missing in .env");
}
const genAI = new GoogleGenerativeAI(apiKey);

// 2. Initialize Supabase Client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Helper function to remove invalid/unpaired UTF-16 Unicode surrogate characters
const sanitizeText = (text) => {
  if (!text) return '';
  return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/g, '');
};

// Fallback helper for vector embedding model options
const getEmbedding = async (text) => {
  const modelNames = ['text-embedding-004', 'gemini-embedding-001', 'embedding-001'];
  
  for (const modelName of modelNames) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.embedContent(text);
      if (result && result.embedding && result.embedding.values) {
        return result.embedding.values;
      }
    } catch (err) {
      // Continue trying next candidate model if available
    }
  }
  
  throw new Error('All embedding models failed. Please verify API key permissions.');
};

// Chunk text into fixed sizes with overlap
const chunkText = (text, chunkSize = 850, chunkOverlap = 150) => {
  const textChunks = [];
  const cleanText = sanitizeText(text).replace(/\s+/g, ' ').trim();

  for (let i = 0; i < cleanText.length; i += chunkSize - chunkOverlap) {
    const chunk = cleanText.substring(i, i + chunkSize);
    if (chunk.trim().length > 0) {
      textChunks.push(chunk);
    }
  }

  return textChunks;
};

// Insert chunks into Supabase table
const saveChunksAsEmbeddings = async (textChunks, metadata = {}) => {
  for (const chunk of textChunks) {
    const embedding = await getEmbedding(chunk);

    const { error } = await supabase.from('document_chunks').insert([
      {
        content: chunk,
        embedding: embedding,
        metadata: {
          title: sanitizeText(metadata.title || ''),
          source: metadata.source || null,
          path: metadata.path || null,
        },
      },
    ]);

    if (error) {
      console.error('Error inserting document into Supabase:', error);
      throw error;
    }
  }
};

// --- Ingestion Logic ---
const indexLocalDocs = async () => {
  if (!fs.existsSync(DOCS_DIR)) {
    throw new Error(`Docs folder not found: ${DOCS_DIR}`);
  }

  const files = fs.readdirSync(DOCS_DIR);

  for (const file of files) {
    if (!file.toLowerCase().endsWith('.pdf')) {
      continue;
    }

    const fullPath = path.join(DOCS_DIR, file);
    console.log(`⚡ SEC-Insight Ingestion: Parsing document vector stream for ${file}...`);

    const dataBuffer = fs.readFileSync(fullPath);
    const pdfParser = new PDFParse({ data: dataBuffer });
    const pdfData = await pdfParser.getText();
    const rawText = pdfData.text || '';
    const text = sanitizeText(rawText).trim();

    if (!text) {
      console.warn(`No text extracted from ${file}, skipping.`);
      continue;
    }

    const textChunks = chunkText(text);

    await saveChunksAsEmbeddings(textChunks, {
      title: path.parse(file).name,
      source: 'pdf',
      path: fullPath,
    });
  }
};

// --- API Routes ---
app.post('/index-docs', async (req, res) => {
  try {
    await indexLocalDocs();
    res.status(200).json({ message: 'Indexed all PDFs from MyDocs folder into Supabase.' });
  } catch (error) {
    console.error('Error indexing local docs:', error);
    res.status(500).json({ error: 'Failed to index local docs', details: error.message });
  }
});

app.post('/query', async (req, res) => {
  try {
    const { query } = req.body;

    if (!query || !query.trim()) {
      return res.status(400).json({ error: 'Query is required' });
    }

    const cleanQuery = sanitizeText(query).replace(/\n/g, ' ');
    const embedding = await getEmbedding(cleanQuery);

    const { data, error } = await supabase.rpc('match_documents', {
      query_embedding: embedding,
      match_threshold: 0.3,
      match_count: 5,
    });

    if (error) throw error;

    let context = (data || []).map((row, idx) => `Chunk ${idx + 1}:\n${row.content.trim()}`).join('\n\n');
    if (!context) context = 'No relevant document context found.';

    const prompt = `You are SEC-Insight AI, an enterprise financial and document intelligence assistant. Answer questions strictly based on the provided document context.

Context:
${context}

Question: ${cleanQuery}

Answer clearly and concisely.`;

    // Updated candidate list covering versioned endpoints and stable aliases
    const candidateModels = [
      'gemini-1.5-flash-001',
      'gemini-1.5-flash-002',
      'gemini-1.5-pro-001',
      'gemini-1.5-pro-002',
      'gemini-3.7-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.1-pro'
    ];

    let responseText = null;
    let lastError = null;

    for (const modelName of candidateModels) {
      try {
        const chatModel = genAI.getGenerativeModel({ model: modelName });
        const result = await chatModel.generateContent(prompt);
        responseText = result.response.text();
        if (responseText) {
          console.log(`Successfully generated response using model: ${modelName}`);
          break;
        }
      } catch (err) {
        lastError = err;
        console.warn(`Chat model ${modelName} failed (${err.message}), trying next candidate...`);
      }
    }

    if (!responseText) {
      throw lastError || new Error('Failed to generate response from all candidate Gemini models.');
    }

    res.status(200).json({ answer: responseText });
  } catch (error) {
    console.error('Error handling user query:', error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

app.get('/', (req, res) => {
  res.json({ message: 'SEC-Insight AI Engine API is running 🚀' });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});