import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { RequireAuth } from "./components/ProtectedRoute";
import { AppLayout } from "./components/AppLayout";
import Login from "./pages/Login";
import Groups from "./pages/admin/Groups";
import Children from "./pages/admin/Children";
import Attendance from "./pages/admin/Attendance";
import Overview from "./pages/admin/Overview";
import ClubPage from "./pages/admin/Club";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route element={<RequireAuth />}>
            <Route element={<AppLayout />}>
              <Route index element={<Navigate to="/gruppen" replace />} />
              <Route path="gruppen" element={<Groups />} />
              <Route path="kinder" element={<Children />} />
              <Route path="anwesenheit" element={<Attendance />} />
              <Route path="uebersicht" element={<Overview />} />
              <Route path="verein" element={<ClubPage />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
