import React, { useState } from 'react';
import axios from 'axios';
import { Send, FileText, RefreshCw, CheckCircle } from 'lucide-react';
import './App.css';

const API_BASE_URL = 'http://localhost:5000';

function App() {
  const [query, setQuery] = useState('');
  const [chatHistory, setChatHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  // Handle document indexing trigger
  const handleIndexDocs = async () => {
    setIndexing(true);
    setStatusMessage('Indexing PDFs from MyDocs folder...');
    try {
      const response = await axios.post(`${API_BASE_URL}/index-docs`);
      setStatusMessage(response.data.message || 'Indexing completed successfully!');
    } catch (error) {
      console.error('Indexing error:', error);
      setStatusMessage('Failed to index documents. Ensure backend is running.');
    } finally {
      setIndexing(false);
    }
  };

  // Handle asking questions
  const handleSendQuery = async (e) => {
    e.preventDefault();
    if (!query.trim() || loading) return;

    const userMessage = query.trim();
    setQuery('');
    
    setChatHistory((prev) => [...prev, { sender: 'user', text: userMessage }]);
    setLoading(true);

    try {
      const response = await axios.post(`${API_BASE_URL}/query`, { query: userMessage });
      const aiAnswer = response.data.answer;

      setChatHistory((prev) => [...prev, { sender: 'ai', text: aiAnswer }]);
    } catch (error) {
      console.error('Query error:', error);
      setChatHistory((prev) => [
        ...prev,
        { sender: 'ai', text: 'Error fetching response from backend. Check server connection.' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="brand">
          <FileText className="brand-icon" />
          <h2>SEC-Insight AI</h2>
        </div>
        <p className="subtitle">Enterprise Document Intelligence</p>

        <div className="sidebar-actions">
          <button onClick={handleIndexDocs} disabled={indexing} className="btn-index">
            <RefreshCw className={indexing ? 'spin' : ''} size={18} />
            {indexing ? 'Indexing Vectors...' : 'Sync Local Docs'}
          </button>
        </div>

        {statusMessage && (
          <div className="status-box">
            {indexing ? <RefreshCw className="spin" size={16} /> : <CheckCircle size={16} />}
            <span>{statusMessage}</span>
          </div>
        )}
      </aside>

      {/* Main Workspace */}
      <main className="chat-container">
        <header className="chat-header">
          <h3>Document QA Terminal</h3>
        </header>

        <div className="chat-feed">
          {chatHistory.length === 0 ? (
            <div className="empty-state">
              <FileText size={48} />
              <h4>No Active Query Session</h4>
              <p>Sync your PDFs from the sidebar and start asking questions about financial filings.</p>
            </div>
          ) : (
            chatHistory.map((msg, index) => (
              <div key={index} className={`message-bubble ${msg.sender}`}>
                <strong>{msg.sender === 'user' ? 'You' : 'SEC-Insight AI'}:</strong>
                <p>{msg.text}</p>
              </div>
            ))
          )}
          {loading && (
            <div className="message-bubble ai loading">
              <RefreshCw className="spin" size={16} /> Retrieving vector context...
            </div>
          )}
        </div>

        {/* Query Input */}
        <form onSubmit={handleSendQuery} className="input-form">
          <input
            type="text"
            placeholder="Ask a question about your indexed documents..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={loading}
          />
          <button type="submit" disabled={loading || !query.trim()}>
            <Send size={18} />
          </button>
        </form>
      </main>
    </div>
  );
}

export default App;