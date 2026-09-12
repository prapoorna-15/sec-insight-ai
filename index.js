import express from 'express';
import cors from 'cors';
import multer from 'multer';
import pdfParse from 'pdf-parse';
import { createClient } from '@supabase/supabase-js'; // Or '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

// Setup __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Supabase Client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Initialize Gemini Client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY_SEC_INSIGHT);

// Multer memory storage setup for PDF uploads
const upload = multer({ storage: multer.memoryStorage() });

// Helper: Split text into ~1000 character chunks
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

// ----------------------------------------------------
// ROUTES
// ----------------------------------------------------

// 1. Serve index.html web interface at the root URL
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 2. Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'SEC-Insight AI RAG API is live 🚀' });
});

// 3. Upload & Index PDF Document
app.post('/upload-and-index', upload.single('document'), async (req, res) => {
  try {
    const { sessionId } = req.body;
    const file = req.file;

    if (!file || !sessionId) {
      return res.status(400).json({ error: 'Both "document" PDF file and "sessionId" are required.' });
    }

    // Extract text from PDF buffer
    const pdfData = await pdfParse(file.buffer);
    const fullText = pdfData.text;

    if (!fullText || fullText.trim().length === 0) {
      return res.status(400).json({ error: 'Could not extract text from the provided PDF file.' });
    }

    // Chunk text
    const textChunks = chunkText(fullText);

    // Get embedding model
    const embeddingModel = genAI.getGenerativeModel({ model: 'text-embedding-004' });

    // Generate embeddings & store in Supabase
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
        console.error('Supabase Insert Error:', error);
        throw error;
      }
    }

    res.json({
      message: `Successfully indexed "${file.originalname}" under session context.`,
      chunksIndexed: textChunks.length
    });
  } catch (error) {
    console.error('Error during document indexing:', error);
    res.status(500).json({ error: error.message || 'Failed to index document.' });
  }
});

// 4. Query RAG Endpoint
app.post('/query', async (req, res) => {
  try {
    const { query, sessionId } = req.body;

    if (!query || !sessionId) {
      return res.status(400).json({ error: 'Both "query" and "sessionId" are required.' });
    }

    // Generate embedding for user query
    const embeddingModel = genAI.getGenerativeModel({ model: 'text-embedding-004' });
    const queryEmbedResult = await embeddingModel.embedContent(query);
    const queryEmbedding = queryEmbedResult.embedding.values;

    // Vector search in Supabase
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

    // Build context block
    const contextText = matchedDocs && matchedDocs.length > 0
      ? matchedDocs.map(doc => doc.content).join('\n---\n')
      : 'No relevant context found in uploaded documents.';

    // Primary Gemini generation model with fallback
    let modelName = 'gemini-2.5-flash';
    let model;

    try {
      model = genAI.getGenerativeModel({ model: modelName });
    } catch {
      modelName = 'gemini-1.5-flash';
      model = genAI.getGenerativeModel({ model: modelName });
    }

    const prompt = `You are SEC-Insight AI, an expert assistant for analyzing documents.
Answer the user's question using ONLY the provided document context below. If the answer cannot be determined from the context, state that clearly.

Document Context:
${contextText}

User Question: ${query}
`;

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

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});