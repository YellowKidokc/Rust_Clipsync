import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import Home from "./pages/Home.jsx";
import Papers from "./pages/Papers.jsx";
import Paper from "./pages/Paper.jsx";
import Claim from "./pages/Claim.jsx";
import Graph from "./pages/Graph.jsx";
import Town from "./pages/Town.jsx";
import Rejects from "./pages/Rejects.jsx";
import Status from "./pages/Status.jsx";
import NotFound from "./pages/NotFound.jsx";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="papers" element={<Papers />} />
        <Route path="papers/:paper" element={<Paper />} />
        <Route path="claims/:id" element={<Claim />} />
        <Route path="graph" element={<Graph />} />
        <Route path="status" element={<Status />} />
        <Route path="town" element={<Town />} />
        <Route path="town/:view" element={<Town />} />
        <Route path="rejected" element={<Rejects />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
