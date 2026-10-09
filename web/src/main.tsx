import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/spotlight/styles.css";
import "@mantine/charts/styles.css";
import "./styles/tokens.css";
import "./styles/app.css";
import { localStorageColorSchemeManager, MantineProvider } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { theme } from "./theme";

// same key as the pre-paint script in index.html, so the first frame already has the right scheme
const colorSchemeManager = localStorageColorSchemeManager({ key: "drc-color-scheme" });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto" colorSchemeManager={colorSchemeManager}>
      <ModalsProvider labels={{ confirm: "Confirm", cancel: "Cancel" }}>
        <Notifications position="bottom-right" limit={3} />
        <App />
      </ModalsProvider>
    </MantineProvider>
  </StrictMode>,
);
