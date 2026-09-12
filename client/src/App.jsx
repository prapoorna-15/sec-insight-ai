import React, { useState, useEffect } from 'react';
import './App.css';

const API_BASE_URL = (import.meta && import.meta.env && import.meta.env.VITE_API_URL) || 'http://localhost:5000';

function App() {
  const [sessionId, setSessionId] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isQuerying, setIsQuerying] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  // Generate or retrieve session ID on initial load
  useEffect(() => {
    let existingSession = sessionStorage.getItem('sec_insight_session_id');
    if (!existingSession) {
      existingSession = 'session_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now();
      sessionStorage.setItem('sec_insight_session_id', existingSession);
    }
    setSessionId(existingSession);
  }, []);

  // 1. Upload & Index User Selected PDF
  const handleFileUpload = async (e) => {
    e.preventDefault();
    if (!selectedFile) {
      setStatusMessage('Please select a PDF file first.');
      return;
    }

    setIsUploading(true);
    setStatusMessage(`Uploading and indexing ${selectedFile.name}...`);

    const formData = new FormData();
    formData.append('document', selectedFile);
    formData.append('sessionId', sessionId);

    try {
      const res = await fetch(`${API_BASE_URL}/upload-and-index`, {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (res.ok) {
        setStatusMessage(data.message || 'File indexed successfully!');
        setSelectedFile(null);
      } else {
        setStatusMessage(`Error: ${data.details || data.error}`);
      }
    } catch (err) {
      setStatusMessage('Failed to connect to backend server. Ensure backend is active.');
    } finally {
      setIsUploading(false);
    }
  };

  // 2. Submit Query using Session Context
  const handleSendQuery = async (e) => {
    e.preventDefault();
    if (!query.trim() || isQuerying) return;

    const userText = query.trim();
    setQuery('');

    setMessages((prev) => [...prev, { sender: 'user', text: userText }]);
    setIsQuerying(true);

    try {
      const res = await fetch(`${API_BASE_URL}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: userText, sessionId }),
      });
      const data = await res.json();

      if (res.ok) {
        setMessages((prev) => [...prev, { sender: 'ai', text: data.answer }]);
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
      {/* Sidebar Controls */}
      <aside className="sidebar">
        <h2>📄 SEC-Insight AI</h2>
        <p className="subtitle">Multi-Tenant Document QA</p>

        <form onSubmit={handleFileUpload} className="upload-section">
          <label className="file-input-label">
            Choose PDF Document
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => setSelectedFile(e.target.files[0])}
              disabled={isUploading}
            />
          </label>
          
          {selectedFile && <span className="filename-preview">{selectedFile.name}</span>}

          <button 
            type="submit" 
            className="sync-btn" 
            disabled={isUploading || !selectedFile}
          >
            {isUploading ? 'Indexing PDF...' : '📤 Upload & Index PDF'}
          </button>
        </form>

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
              <p>Upload a PDF document from the sidebar to start asking questions.</p>
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
              <p>SEC-Insight AI is retrieving context and generating answer...</p>
            </div>
          )}
        </div>

        <form className="input-form" onSubmit={handleSendQuery}>
          <input
            type="text"
            placeholder="Ask a question about your uploaded document..."
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