import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import App from "./App.jsx";
import "./styles/tokens.css";
import "./styles/components.css";
import "./styles/site.css";

// Hash URLs only for the relative "preview" build; Cloudflare Pages gets real paths.
const Router = import.meta.env.MODE === "preview" ? HashRouter : BrowserRouter;

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode><Router><App /></Router></React.StrictMode>
);
