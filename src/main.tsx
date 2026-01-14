import React from "react";
import ReactDOM from "react-dom/client";
import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import App from "./App";
import "./styles.css";

const theme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: "#4da3ff" },
    background: { default: "#0e1116", paper: "#151a21" },
  },
  shape: { borderRadius: 4 },
  typography: {
    fontFamily:
      '"IBM Plex Sans", "Space Grotesk", ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial',
    fontSize: 12,
  },
  spacing: 6,
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
