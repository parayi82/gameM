import { GameEngine } from "./engine.js";
import { createPersistence } from "./persistence.js";
import { Renderer } from "./render.js";

const appRoot = document.getElementById("app");

function currentChapterIdFromURL() {
  const params = new URLSearchParams(window.location.search);
  const fromURL = parseInt(params.get("chapter"), 10);
  return Number.isFinite(fromURL) ? fromURL : 1;
}

function goToChapter(chapterId) {
  const url = new URL(window.location.href);
  url.searchParams.set("chapter", String(chapterId));
  window.location.href = url.toString();
}

async function requestCheckout(chapter, userId) {
  const res = await fetch("/.netlify/functions/create-checkout-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chapterId: chapter.id, userId }),
  });
  if (!res.ok) throw new Error("No se pudo iniciar el pago");
  const { url } = await res.json();
  window.location.href = url;
}

async function boot() {
  const [manifest, persistence] = await Promise.all([
    fetch("chapters/manifest.json").then((r) => r.json()),
    createPersistence(),
  ]);

  const chapterId = currentChapterIdFromURL();
  const chapterMeta = manifest.chapters.find((c) => c.id === chapterId) || manifest.chapters[0];
  const purchased = await persistence.getPurchasedChapters();
  const unlocked = chapterMeta.free || purchased.includes(chapterMeta.id);

  if (!unlocked) {
    const renderer = new Renderer(appRoot);
    const userId = await persistence.getUserId();
    renderer.renderPaywallScreen({
      chapter: chapterMeta,
      onPurchase: () => requestCheckout(chapterMeta, userId).catch((err) => alert(err.message)),
    });
    return;
  }

  const chapterData = await fetch(chapterMeta.file).then((r) => r.json());
  const engine = new GameEngine({
    root: appRoot,
    chapterData,
    persistence,
    onChapterComplete: () => {
      const next = manifest.chapters.find((c) => c.id === chapterMeta.id + 1);
      if (next) goToChapter(next.id);
    },
  });
  await engine.loadProgress();
}

boot().catch((err) => {
  console.error(err);
  appRoot.innerHTML = `<p class="boot-error">Error al cargar el juego: ${err.message}</p>`;
});
