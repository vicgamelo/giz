// Dica ao passar o mouse (ou tocar) em gráficos: um único balão no body, posicionado por CSSOM (permitido pela CSP).
import { tipPosition } from "./charts";

let el: HTMLDivElement | null = null;
let hideTimer = 0;

function balloon() {
  if (!el) {
    el = document.createElement("div");
    el.className = "giz-tip";
    el.setAttribute("role", "tooltip");
    el.hidden = true;
    document.body.append(el);
  }
  return el;
}

export function showTip(text: string, x: number, y: number) {
  const b = balloon();
  clearTimeout(hideTimer);
  b.textContent = text;
  b.hidden = false;
  const r = b.getBoundingClientRect();
  const p = tipPosition(x, y, r.width, r.height, innerWidth, innerHeight);
  b.style.setProperty("left", `${p.left}px`);
  b.style.setProperty("top", `${p.top}px`);
}

export function hideTip() {
  if (el) el.hidden = true;
}

/** `use:tip={"texto"}` ou `use:tip={() => "texto"}`. */
export function tip(node: Element, text: string | (() => string)) {
  let get = typeof text === "function" ? text : () => text;
  const move = (e: Event) => {
    const ev = e as PointerEvent;
    const t = get();
    if (t) showTip(t, ev.clientX, ev.clientY);
  };
  const down = (e: Event) => {
    if ((e as PointerEvent).pointerType !== "mouse") {
      move(e);
      clearTimeout(hideTimer);
      hideTimer = window.setTimeout(hideTip, 2200);
    }
  };
  node.addEventListener("pointermove", move);
  node.addEventListener("pointerleave", hideTip);
  node.addEventListener("pointerdown", down);
  return {
    update(next: string | (() => string)) {
      get = typeof next === "function" ? next : () => next;
    },
    destroy() {
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerleave", hideTip);
      node.removeEventListener("pointerdown", down);
      hideTip();
    },
  };
}
