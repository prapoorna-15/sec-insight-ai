# SEC-Insight AI

An enterprise-grade document intelligence API built with **Express**, **Supabase Vector**, and **Google Gemini 3.x Models**. SEC-Insight AI enables session-isolated Retrieval-Augmented Generation (RAG), allowing users to upload financial/SEC PDF documents and perform fast semantic Q&A.

---

## Features

- **Dynamic PDF Processing**: In-memory text extraction from uploaded PDF documents.
- **Session Isolation**: Document embeddings are mapped to unique session identifiers (`sessionId`).
- **Vector Search via Supabase**: Uses pgvector for high-similarity document chunk retrieval.
- **Up-to-Date Gemini Integration**: Powered by Google's latest `gemini-3.6-flash` generation models and `gemini-embedding-001`.
- **Automatic Model Fallback**: Resilience handling for active Gemini model names.

---

## Tech Stack

- **Runtime**: Node.js (ES Modules)
- **Framework**: Express.js
- **Database / Vector Search**: Supabase (PostgreSQL + `pgvector`)
- **LLM & Embeddings**: Google Generative AI SDK (`@google/generative-ai`)
- **PDF Parser**: `pdf-parse`
- **File Uploads**: `multer`

---

## Prerequisites

1. **Node.js**: v18 or higher installed locally.
2. **Supabase Project**: A live Supabase project with the `vector` extension enabled.
3. **Google Gemini API Key**: An active API key from [Google AI Studio](https://aistudio.google.com/).

---

## Environment Variables Setup

Create a `.env` file in the root directory and add the following keys:

```env
PORT=5000
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
GEMINI_API_KEY_SEC_INSIGHT=your_gemini_api_key