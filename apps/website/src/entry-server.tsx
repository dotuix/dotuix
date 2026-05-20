import { renderToString } from "react-dom/server";
import { StrictMode } from "react";
import { App } from "./App.js";

export function render(): string {
  return renderToString(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
