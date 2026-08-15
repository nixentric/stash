import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Everything is local IPC, so refetch-on-focus buys nothing and costs a
      // round of SQL on every window switch.
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 30_000,
    },
    mutations: { retry: false },
  },
});

// The webview's own menu offers Inspect Element and nothing the app wants.
// Release builds already ship without devtools (no `devtools` feature on the
// tauri crate); suppressing the menu closes the door in the UI too. Text fields
// keep theirs, or copy and paste stop working.
if (import.meta.env.PROD) {
  document.addEventListener("contextmenu", (e) => {
    const el = e.target as HTMLElement | null;
    if (!el?.closest("input, textarea, [contenteditable='true']")) e.preventDefault();
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
