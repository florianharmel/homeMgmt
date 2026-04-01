import { createTheme } from "@mui/material/styles";

export const appTheme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: "#2ed4bf" },
    secondary: { main: "#60a5fa" },
    background: { default: "#0b1220", paper: "#111a2b" },
  },
  shape: { borderRadius: 12 },
  components: {
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 14,
          border: "1px solid rgba(255,255,255,0.08)",
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
    },
  },
});
