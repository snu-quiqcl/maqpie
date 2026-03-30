import React from "react";
import ReactDOM from "react-dom/client";
import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import App from "./App";
import "./styles.css";

// MUI is used as the structural baseline; most of the visual identity still comes from styles.css variables.
const theme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: "#4da3ff" },
    background: { default: "#0e1116", paper: "#151a21" },
  },
  shape: { borderRadius: 4 },
  typography: {
    fontFamily:
      '"IBM Plex Sans", "IBM Plex Sans Condensed", "Segoe UI Variable", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
    fontSize: 11,
  },
  spacing: 4,
  components: {
    MuiButton: { defaultProps: { size: "small", variant: "outlined" } },
    MuiTextField: { defaultProps: { size: "small" } },
    MuiSelect: { defaultProps: { size: "small" } },
    MuiChip: { defaultProps: { size: "small", variant: "outlined" } },
    MuiTable: { defaultProps: { size: "small" } },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
