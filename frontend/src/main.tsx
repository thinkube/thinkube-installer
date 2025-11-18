/*
 * Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { TkAppHeader } from 'thinkube-style/components/utilities';
import { TkThemeProvider } from 'thinkube-style/components/theme';
import { TkToaster } from 'thinkube-style/components/feedback';
import './index.css';

// Pages
import WelcomePage from './pages/welcome';
import RequirementsPage from './pages/requirements';
import SudoPasswordPage from './pages/sudo-password';
import ServerDiscoveryPage from './pages/server-discovery';
import HardwareDetectionPage from './pages/hardware-detection';
import RoleAssignmentPage from './pages/role-assignment';
import NetworkConfigurationPage from './pages/network-configuration';
import ConfigurationPage from './pages/configuration';
import SshSetupPage from './pages/ssh-setup';
import GpuDriverCheckPage from './pages/gpu-driver-check';
import ReviewPage from './pages/review';
import DeployPage from './pages/deploy';
import InstallationPage from './pages/installation';
import CompletePage from './pages/complete';

function App() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <TkAppHeader title="Thinkube Installer" />

      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Navigate to="/welcome" replace />} />
          <Route path="/welcome" element={<WelcomePage />} />
          <Route path="/requirements" element={<RequirementsPage />} />
          <Route path="/sudo-password" element={<SudoPasswordPage />} />
          <Route path="/server-discovery" element={<ServerDiscoveryPage />} />
          <Route path="/hardware-detection" element={<HardwareDetectionPage />} />
          <Route path="/role-assignment" element={<RoleAssignmentPage />} />
          <Route path="/network-configuration" element={<NetworkConfigurationPage />} />
          <Route path="/configuration" element={<ConfigurationPage />} />
          <Route path="/ssh-setup" element={<SshSetupPage />} />
          <Route path="/gpu-driver-check" element={<GpuDriverCheckPage />} />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/deploy" element={<DeployPage />} />
          <Route path="/installation" element={<InstallationPage />} />
          <Route path="/complete" element={<CompletePage />} />
        </Routes>
      </main>

      <footer className="py-4 bg-muted text-center">
        <p className="text-sm text-muted-foreground">
          © 2025 Alejandro Martínez Corriá and the Thinkube contributors | Apache-2.0 License
        </p>
      </footer>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TkThemeProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
      <TkToaster />
    </TkThemeProvider>
  </React.StrictMode>
);
