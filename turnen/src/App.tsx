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
import Utilization from "./pages/admin/Utilization";
import Export from "./pages/admin/Export";
import Calendar from "./pages/admin/Calendar";
import AuditLog from "./pages/admin/AuditLog";
import AttendancePrint from "./pages/AttendancePrint";
import HoursReportPage from "./pages/HoursReport";
import Substitutes from "./pages/admin/Substitutes";
import ClubWaitlist from "./pages/admin/ClubWaitlist";
import Dashboard from "./pages/admin/Dashboard";
import MemberStats from "./pages/admin/MemberStats";

// "/" lokal, "/turnen-light" im Produktions-Build (BASE_URL endet auf "/",
// React Router mag kein trailing slash im basename) - siehe .env.production
// und cloudflare/web-router.ts, der denselben Präfix serverseitig abschneidet.
const routerBasename = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function App() {
  return (
    <BrowserRouter basename={routerBasename}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route element={<RequireAuth />}>
            <Route path="druck/:groupId?" element={<AttendancePrint />} />
            <Route path="nachweis" element={<HoursReportPage />} />

            <Route element={<AppLayout />}>
              <Route index element={<Dashboard />} />
              <Route path="gruppen" element={<Groups />} />
              <Route path="kinder" element={<Children />} />
              <Route path="anwesenheit" element={<Attendance />} />
              <Route path="uebersicht" element={<Overview />} />
              <Route path="auslastung" element={<Utilization />} />
              <Route path="mitgliederstatistik" element={<MemberStats />} />
              <Route path="kalender" element={<Calendar />} />
              <Route path="export" element={<Export />} />
              <Route path="verlauf" element={<AuditLog />} />
              <Route path="vertretungen" element={<Substitutes />} />
              <Route path="warteliste" element={<ClubWaitlist />} />
              <Route path="verein" element={<ClubPage />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
