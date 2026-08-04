import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "@/lib/theme";
import { AuthProvider } from "@/lib/auth";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { AppShell } from "@/components/layout/AppShell";
import { settingsNav } from "@/pages/settings/settingsNav";
import { Login } from "@/pages/auth/Login";
import { Register } from "@/pages/auth/Register";
import { ForgotPassword } from "@/pages/auth/ForgotPassword";
import { ResetPassword } from "@/pages/auth/ResetPassword";
import { Welcome } from "@/pages/Welcome";
import { Portal } from "@/pages/portal/Portal";
import { Profile } from "@/pages/settings/Profile";
import { TelegramBridge } from "@/pages/settings/TelegramBridge";
import { PersonnelRegistry } from "@/pages/settings/PersonnelRegistry";
import { Provisioning } from "@/pages/settings/Provisioning";
import { DeveloperTools } from "@/pages/settings/DeveloperTools";
import { Release } from "@/pages/settings/Release";

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/portal" element={<Portal />} />

            <Route
              path="/"
              element={
                <RequireAuth>
                  <Welcome />
                </RequireAuth>
              }
            />
            <Route
              path="/welcome"
              element={
                <RequireAuth>
                  <Welcome />
                </RequireAuth>
              }
            />

            <Route path="/settings" element={<AppShell navItems={settingsNav} />}>
              <Route index element={<Navigate to="profile" replace />} />
              <Route path="profile" element={<Profile />} />
              <Route path="telegram" element={<TelegramBridge />} />
              <Route path="registry" element={<PersonnelRegistry />} />
              <Route path="provisioning" element={<Provisioning />} />
              <Route path="developer" element={<DeveloperTools />} />
              <Route path="release" element={<Release />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
