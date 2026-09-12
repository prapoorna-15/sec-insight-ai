import express from 'express';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { PDFParse } from 'pdf-parse';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Initialize Supabase & Gemini using environment variables
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ADD THESE LINES:
app.use(express.json());

// Serve static files directly from the root directory
app.use(express.static(__dirname));

// Route to serve index.html at the root URL
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

    // Extract text safely using PDFParse class instance
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

    // Chunk the text
    const chunks = splitTextIntoChunks(fullText);
    const embeddingModel = genAI.getGenerativeModel({ model: 'text-embedding-004' });

    // Generate embeddings & store in Supabase
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

    // Embed the user's question
    const embeddingModel = genAI.getGenerativeModel({ model: 'text-embedding-004' });
    const questionEmbeddingResult = await embeddingModel.embedContent(question);
    const queryVector = questionEmbeddingResult.embedding.values;

    // Match similar vectors via Supabase match_documents RPC
    const { data: matchedDocuments, error } = await supabase.rpc('match_documents', {
      query_embedding: queryVector,
      match_threshold: 0.3,
      match_count: 5
    });

    if (error) {
      console.error('Supabase Vector Search Error:', error);
      throw error;
    }

    // Combine retrieved contexts
    const context = matchedDocuments.map(doc => doc.content).join('\n---\n');

    // Generate response with Gemini
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