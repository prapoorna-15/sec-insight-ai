import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// Configure Multer for in-memory file handling
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Initialize Supabase & Gemini Client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY_SEC_INSIGHT);

// Helper to sanitize text (strips invalid UTF-16 surrogates)
function sanitizeText(text) {
  return text.replace(/[\uD800-\uDFFF]/g, '');
}

// Universal PDF Parser resolver handling pdf-parse
async function parsePdfBuffer(buffer) {
  const pdfModule = await import('pdf-parse');
  const Target = pdfModule.PDFParse || pdfModule.default || pdfModule;

  if (typeof Target === 'function' && Target.prototype && Target.prototype.constructor === Target) {
    try {
      const parser = new Target({ data: buffer });
      const result = await parser.getText();
      return result.text || '';
    } catch {
      const result = await Target(buffer);
      return result.text || '';
    }
  } 

  if (typeof Target === 'function') {
    const result = await Target(buffer);
    return result.text || '';
  }

  throw new Error('Unable to resolve a valid pdf-parse constructor or function.');
}

// Helper for generating text embeddings using Gemini
async function getEmbedding(text) {
  const modelsToTry = ['gemini-embedding-001', 'text-embedding-004'];
  
  for (const modelName of modelsToTry) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.embedContent(text);
      if (result && result.embedding && result.embedding.values) {
        return result.embedding.values;
      }
    } catch (err) {
      console.warn(`[Embedding Warning] Failed for '${modelName}':`, err.message);
    }
  }
  throw new Error('All Gemini embedding model variants failed.');
}

// Model Fallback Resolver using active generation models suggested by the API
async function generateGeminiContent(promptText) {
  const models = [
    'gemini-3.6-flash',
    'gemini-3.1-pro-preview'
  ];

  for (const modelName of models) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(promptText);
      return result.response.text();
    } catch (err) {
      console.warn(`[Generation Warning] Model ${modelName} failed: ${err.message}`);
    }
  }
  throw new Error('All Gemini model fallbacks failed.');
}

// Endpoint 1: Dynamic PDF Upload & Vector Ingestion per Session
app.post('/upload-and-index', upload.single('document'), async (req, res) => {
  try {
    const sessionId = req.body.sessionId;
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required.' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file uploaded.' });
    }

    // Safely extract PDF text
    const cleanText = sanitizeText(await parsePdfBuffer(req.file.buffer));

    if (!cleanText.trim()) {
      return res.status(400).json({ error: 'Could not extract text from the PDF file.' });
    }

    // Chunking strategy (~1000 characters per chunk)
    const chunkSize = 1000;
    const chunks = [];
    for (let i = 0; i < cleanText.length; i += chunkSize) {
      chunks.push(cleanText.substring(i, i + chunkSize));
    }

    // Generate embeddings & store rows in 'documents' table
    for (const chunk of chunks) {
      if (!chunk.trim()) continue;
      
      const vector = await getEmbedding(chunk);

      const { error } = await supabase.from('documents').insert({
        content: chunk,
        embedding: vector,
        metadata: { 
          session_id: sessionId, 
          filename: req.file.originalname 
        }
      });

      if (error) throw error;
    }

    res.json({ 
      message: `Successfully indexed "${req.file.originalname}" under session context.` 
    });
  } catch (error) {
    console.error('Upload Error:', error);
    res.status(500).json({ error: error.message || 'Failed to process and index document.' });
  }
});

// Endpoint 2: Session-Isolated Query RAG Engine
app.post('/query', async (req, res) => {
  try {
    const { query, sessionId } = req.body;
    if (!query || !sessionId) {
      return res.status(400).json({ error: 'Query and sessionId are required.' });
    }

    const cleanQuery = sanitizeText(query);

    // Generate query embedding
    const queryVector = await getEmbedding(cleanQuery);

    // Retrieve matching vectors isolated by session_id metadata using RPC
    const { data: matchedDocs, error } = await supabase.rpc('match_documents', {
      query_embedding: queryVector,
      match_threshold: 0.3,
      match_count: 5,
      filter_metadata: { session_id: sessionId }
    });

    let context = '';
    if (error || !matchedDocs || matchedDocs.length === 0) {
      const { data: fallbackDocs } = await supabase
        .from('documents')
        .select('content, metadata');
      
      const sessionDocs = (fallbackDocs || []).filter(
        doc => doc.metadata && doc.metadata.session_id === sessionId
      );
      context = sessionDocs.map(d => d.content).join('\n---\n');
    } else {
      context = matchedDocs.map(d => d.content).join('\n---\n');
    }

    if (!context.trim()) {
      return res.json({ 
        answer: "I couldn't find relevant information in your uploaded documents. Please upload a relevant PDF first." 
      });
    }

    const prompt = `You are SEC-Insight AI, an enterprise financial document assistant. Answer the user's question strictly using the provided context. If the answer is not contained in the context, state that clearly.

Context:
${context}

Question: ${cleanQuery}

Answer:`;

    const answer = await generateGeminiContent(prompt);
    res.json({ answer });

  } catch (error) {
    console.error('Query Error:', error);
    res.status(500).json({ error: error.message || 'Failed to process query.' });
  }
});

app.get('/', (req, res) => {
  res.json({ message: 'SEC-Insight AI RAG API is live 🚀' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));