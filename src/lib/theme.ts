// Tema claro/escuro. A escolha fica no navegador; "sistema" segue o celular/computador.
export type Theme = "light" | "dark" | "system";
const KEY = "citidiano.tema";

export function getTheme(): Theme {
  try { const t = localStorage.getItem(KEY); return t === "dark" || t === "system" ? t : "light"; } catch { return "light"; }
}

export function applyTheme(t: Theme = getTheme()) {
  const dark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function setTheme(t: Theme) {
  try { localStorage.setItem(KEY, t); } catch { /* ignora */ }
  applyTheme(t);
}

// Roda antes de a página aparecer (no <head>), para não piscar branco no tema escuro
export const themeBootScript = `try{var t=localStorage.getItem('${KEY}');var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark')}catch(e){}`;
