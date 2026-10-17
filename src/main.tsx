import { IconContext } from "@phosphor-icons/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { ControllerKeyboard } from "./components/ControllerKeyboard";
import { SofaLoadingIcon } from "./components/SofaLoadingIcon";
import { initialLang } from "./i18n";
import { serviceError } from "./services";
import "./App.css";
import "@fontsource-variable/outfit";

// Each window loads only its own UI: the HUD over a game skips the library, store and animations.
const App = lazy(() => import("./App"));
const Hud = lazy(() =>
  import("./features/Performance").then((m) => ({ default: m.Hud })),
);

const queryClient = new QueryClient({
  defaultOptions: {
    // Queries are Tauri IPC calls, not web requests: battery, HUD and library must keep
    // working offline. Commands that need the internet fail with the "network" key instead.
    mutations: { networkMode: "always" },
    queries: {
      networkMode: "always",
      // Errors are message keys; only a dropped connection is worth retrying.
      retry: (failures, error) =>
        failures < 2 && serviceError(error) === "network",
      // Polling queries keep themselves fresh; focus refetches would only add requests.
      refetchOnWindowFocus: false,
    },
  },
});

// Each window (main, HUD, Game Bar widget) announces its language, not the HTML default.
document.documentElement.lang = initialLang();
const hud = new URLSearchParams(location.search).get("hud") === "1";
// Icons sit next to text or inside labelled buttons: hide them from screen readers.
const iconDefaults = { "aria-hidden": true } as const;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <IconContext.Provider value={iconDefaults}>
        <Suspense
          fallback={
            // The main window's opening draws the sofa itself; drawing it here first would
            // play the animation twice.
            <div className="app-loading" role="status" aria-label="Sofa">
              {hud && <SofaLoadingIcon size={96} />}
            </div>
          }
        >
          {hud ? <Hud /> : <App />}
          <ControllerKeyboard />
        </Suspense>
      </IconContext.Provider>
    </QueryClientProvider>
  </React.StrictMode>,
);
