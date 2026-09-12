import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { PDFParse } from 'pdf-parse';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY_SEC_INSIGHT);
const upload = multer({ storage: multer.memoryStorage() });

function chunkText(text, chunkSize = 1000, overlap = 200) {
  const chunks = [];
  let index = 0;
  while (index < text.length) {
    const chunk = text.slice(index, index + chunkSize);
    chunks.push(chunk);
    index += chunkSize - overlap;
  }
  return chunks;
}

// Serve Main UI
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'SEC-Insight AI RAG API is live 🚀' });
});

// Sync / Upload & Index Endpoint
app.post('/upload-and-index', upload.single('document'), async (req, res) => {
  let parser = null;
  try {
    const sessionId = req.body.sessionId || 'default-session';
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No PDF file provided.' });
    }

    parser = new PDFParse({ data: file.buffer });
    const pdfData = await parser.getText();
    const fullText = pdfData.text;

    if (!fullText || fullText.trim().length === 0) {
      return res.status(400).json({ error: 'Could not extract text from PDF.' });
    }

    const textChunks = chunkText(fullText);

    // FIXED: Added "models/" prefix
    const embeddingModel = genAI.getGenerativeModel({ model: 'models/text-embedding-004' });

    for (const chunk of textChunks) {
      const result = await embeddingModel.embedContent(chunk);
      const embedding = result.embedding.values;

      const { error } = await supabase.from('documents').insert({
        content: chunk,
        embedding: embedding,
        metadata: {
          sessionId: sessionId,
          filename: file.originalname
        }
      });

      if (error) {
        console.error('Supabase Error:', error);
        throw error;
      }
    }

    res.json({
      message: `Successfully indexed ${file.originalname}`,
      chunksIndexed: textChunks.length
    });
  } catch (error) {
    console.error('Indexing Error:', error);
    res.status(500).json({ error: error.message || 'Failed to index document.' });
  } finally {
    if (parser && typeof parser.destroy === 'function') {
      await parser.destroy();
    }
  }
});

// Query Endpoint
app.post('/query', async (req, res) => {
  try {
    const { query, sessionId = 'default-session' } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query parameter is required.' });
    }

    // FIXED: Added "models/" prefix
    const embeddingModel = genAI.getGenerativeModel({ model: 'models/text-embedding-004' });
    const queryEmbedResult = await embeddingModel.embedContent(query);
    const queryEmbedding = queryEmbedResult.embedding.values;

    const { data: matchedDocs, error: matchError } = await supabase.rpc('match_documents', {
      query_embedding: queryEmbedding,
      match_threshold: 0.25,
      match_count: 5,
      filter_metadata: { sessionId: sessionId }
    });

    if (matchError) {
      console.error('Supabase Search Error:', matchError);
      throw matchError;
    }

    const contextText = matchedDocs && matchedDocs.length > 0
      ? matchedDocs.map(doc => doc.content).join('\n---\n')
      : 'No relevant context found in documents.';

    // FIXED: Added "models/" prefix
    let model;
    try {
      model = genAI.getGenerativeModel({ model: 'models/gemini-1.5-flash' });
    } catch {
      model = genAI.getGenerativeModel({ model: 'models/gemini-1.5-pro' });
    }

    const prompt = `You are SEC-Insight AI, an expert assistant for financial filings and document analysis.
Answer the user's question accurately using ONLY the context provided below.

Document Context:
${contextText}

User Question: ${query}`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    res.json({
      answer: responseText,
      sourcesMatched: matchedDocs ? matchedDocs.length : 0
    });
  } catch (error) {
    console.error('Error handling query:', error);
    res.status(500).json({ error: error.message || 'Failed to process query.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});