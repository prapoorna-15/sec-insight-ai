import React, { useState } from 'react';
import './App.css';

// Dynamic API URL: defaults to localhost:5000 in development, uses production URL in deployment
const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

function App() {
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState([]);
  const [isIndexing, setIsIndexing] = useState(false);
  const [isQuerying, setIsQuerying] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  // 1. Trigger Document Vector Ingestion Pipeline
  const handleSyncDocs = async () => {
    setIsIndexing(true);
    setStatusMessage('Syncing & indexing local documents from MyDocs...');
    try {
      const res = await fetch(`${API_BASE_URL}/index-docs`, {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok) {
        setStatusMessage(data.message || 'Successfully indexed all PDFs into Supabase!');
      } else {
        setStatusMessage(`Error: ${data.details || data.error}`);
      }
    } catch (err) {
      setStatusMessage('Failed to reach backend API engine. Verify Express server is active.');
    } finally {
      setIsIndexing(false);
    }
  };

  // 2. Submit Query to RAG Backend Engine
  const handleSendQuery = async (e) => {
    e.preventDefault();
    if (!query.trim() || isQuerying) return;

    const userText = query.trim();
    setQuery('');

    // Append user question to terminal history
    setMessages((prev) => [...prev, { sender: 'user', text: userText }]);
    setIsQuerying(true);

    try {
      const res = await fetch(`${API_BASE_URL}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: userText }),
      });
      const data = await res.json();

      if (res.ok) {
        setMessages((prev) => [
          ...prev,
          { sender: 'ai', text: data.answer },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { sender: 'ai', text: `Error: ${data.details || data.error}` },
        ]);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { sender: 'ai', text: 'Error connecting to backend server.' },
      ]);
    } finally {
      setIsQuerying(false);
    }
  };

  return (
    <div className="app-container">
      {/* Control Sidebar */}
      <aside className="sidebar">
        <h2>📄 SEC-Insight AI</h2>
        <p className="subtitle">Enterprise Document Intelligence</p>

        <button 
          className="sync-btn" 
          onClick={handleSyncDocs} 
          disabled={isIndexing}
        >
          {isIndexing ? 'Indexing Vectors...' : '🔄 Sync Local Docs'}
        </button>

        {statusMessage && (
          <div className="status-box">
            <small>{statusMessage}</small>
          </div>
        )}
      </aside>

      {/* Main Terminal UI */}
      <main className="chat-terminal">
        <header className="terminal-header">
          <h3>Document QA Terminal</h3>
        </header>

        <div className="messages-container">
          {messages.length === 0 ? (
            <div className="empty-state">
              <p>Ask questions based on your indexed financial documents in <code>MyDocs</code>.</p>
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div key={idx} className={`message-bubble ${msg.sender}`}>
                <strong>{msg.sender === 'user' ? 'You:' : 'SEC-Insight AI:'}</strong>
                <p>{msg.text}</p>
              </div>
            ))
          )}
          {isQuerying && (
            <div className="message-bubble ai loading">
              <p>SEC-Insight AI is retrieving document context and generating answer...</p>
            </div>
          )}
        </div>

        <form className="input-form" onSubmit={handleSendQuery}>
          <input
            type="text"
            placeholder="Ask a question about your indexed documents..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={isQuerying}
          />
          <button type="submit" disabled={isQuerying || !query.trim()}>
            Send
          </button>
        </form>
      </main>
    </div>
  );
}

export default App;