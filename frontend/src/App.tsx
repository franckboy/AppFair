import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import "./App.css";
import { AssetsPage } from "./pages/AssetsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ScenarioDetailPage } from "./pages/ScenarioDetailPage";
import { ScenariosPage } from "./pages/ScenariosPage";
import { ThreatsPage } from "./pages/ThreatsPage";

function App() {
  return (
    <>
      <nav className="topnav">
        <span className="brand">AppFair</span>
        <NavLink to="/dashboard">Dashboard</NavLink>
        <NavLink to="/assets">Activos</NavLink>
        <NavLink to="/threats">Amenazas</NavLink>
        <NavLink to="/scenarios">Escenarios</NavLink>
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/assets" element={<AssetsPage />} />
          <Route path="/threats" element={<ThreatsPage />} />
          <Route path="/scenarios" element={<ScenariosPage />} />
          <Route path="/scenarios/:id" element={<ScenarioDetailPage />} />
        </Routes>
      </main>
    </>
  );
}

export default App;
