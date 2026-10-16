import React from "react";
import ReactDOM from "react-dom/client";
import Dashboard from "./pages/Dashboard";
import "./styles.css";

const root = document.getElementById("root");

if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <Dashboard />
    </React.StrictMode>
  );
} else {
  console.error("Root element not found!");
}
