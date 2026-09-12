import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { PDFParse } from 'pdf-parse';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Support both GEMINI_API_KEY_SEC_INSIGHT and GEMINI_API_KEY
const geminiApiKey = process.env.GEMINI_API_KEY_SEC_INSIGHT || process.env.GEMINI_API_KEY;

// Initialize Supabase & Gemini
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);
const genAI = new GoogleGenerativeAI(geminiApiKey);

app.use(cors());
app.use(express.json());

// Serve static files directly from project root & serve index.html at GET /
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Simple text splitter function
function splitTextIntoChunks(text, chunkSize = 1000, overlap = 200) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = start + chunkSize;
    chunks.push(text.slice(start, end));
    start += chunkSize - overlap;
  }
  return chunks;
}

// 1. Upload & Vectorize PDF Route
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    // Safely parse PDF
    let fullText = '';
    try {
      const parser = new PDFParse({ data: file.buffer });
      const pdfData = await parser.getText();
      fullText = pdfData.text;
    } catch (parseError) {
      console.error('PDF parsing error:', parseError);
      return res.status(400).json({ 
        error: 'Failed to process PDF. Please ensure the file is valid and not password-protected.' 
      });
    }

    if (!fullText || !fullText.trim()) {
      return res.status(400).json({ error: 'Could not extract text from PDF.' });
    }

    // Chunk text
    const chunks = splitTextIntoChunks(fullText);
    const embeddingModel = genAI.getGenerativeModel({ model: 'embedding-001' });

    // Store chunks and embeddings in Supabase
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embeddingResult = await embeddingModel.embedContent(chunk);
      const embedding = embeddingResult.embedding.values;

      const { error } = await supabase.from('documents').insert({
        content: chunk,
        embedding: embedding,
        metadata: { filename: file.originalname, chunkIndex: i }
      });

      if (error) {
        console.error('Supabase insertion error:', error);
        throw error;
      }
    }

    res.json({ message: 'File successfully processed and embedded!', filename: file.originalname });
  } catch (error) {
    console.error('Upload Error:', error);
    res.status(500).json({ error: 'Error processing document.' });
  }
});

// 2. Chat / Query Route
app.post('/api/chat', async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) {
      return res.status(400).json({ error: 'Question is required.' });
    }

    // Embed user question
    const embeddingModel = genAI.getGenerativeModel({ model: 'embedding-001' });
    const questionEmbeddingResult = await embeddingModel.embedContent(question);
    const queryVector = questionEmbeddingResult.embedding.values;

    // Vector match in Supabase
    const { data: matchedDocuments, error } = await supabase.rpc('match_documents', {
      query_embedding: queryVector,
      match_threshold: 0.3,
      match_count: 5
    });

    if (error) {
      console.error('Supabase Vector Search Error:', error);
      throw error;
    }

    const context = matchedDocuments.map(doc => doc.content).join('\n---\n');

    // Generate answer with Gemini
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const prompt = `Use the following retrieved context to answer the user's question. If the answer is not in the context, state that clearly based on the provided documents.

Context:
${context}

User Question: ${question}`;

    const result = await model.generateContent(prompt);
    const answer = result.response.text();

    res.json({ answer });
  } catch (error) {
    console.error('Chat Error:', error);
    res.status(500).json({ error: 'Error generating answer.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));