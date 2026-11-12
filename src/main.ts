import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";

const saved = (() => {
  try {
    return localStorage.getItem("giz-tema");
  } catch {
    return null;
  }
})();
if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;

export default mount(App, { target: document.getElementById("app")! });
