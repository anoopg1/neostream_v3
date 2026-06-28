import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar.jsx';
import TopBar from './components/TopBar.jsx';
import CommandCenter from './pages/CommandCenter.jsx';
import ViewerIntelligence from './pages/ViewerIntelligence.jsx';
import Rankings from './pages/Rankings.jsx';
import NetworkingCRM from './pages/NetworkingCRM.jsx';
import Logs from './pages/Logs.jsx';
import ApiMonitor from './pages/ApiMonitor.jsx';
import DatabaseManager from './pages/DatabaseManager.jsx';
import { useWebSocket } from './hooks/useWebSocket.js';

export default function App() {
  const { lastEvent, isConnected } = useWebSocket('ws://localhost:3501');

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <TopBar isConnected={isConnected} lastEvent={lastEvent} />
        <main
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '24px',
            backgroundColor: 'var(--bg-primary)',
          }}
        >
          <Routes>
            <Route path="/"          element={<CommandCenter lastEvent={lastEvent} />} />
            <Route path="/viewers"   element={<ViewerIntelligence />} />
            <Route path="/rankings"  element={<Rankings />} />
            <Route path="/networking" element={<NetworkingCRM />} />
            <Route path="/logs"      element={<Logs />} />
            <Route path="/monitor"   element={<ApiMonitor lastEvent={lastEvent} />} />
            <Route path="/database"  element={<DatabaseManager />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
