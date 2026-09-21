// Capa de presentación: solo lee del estado/nodo y pinta DOM. No conoce reglas de juego.
export class Renderer {
  constructor(root) {
    this.root = root;
    this.root.innerHTML = `
      <div id="scene">
        <img id="scene-bg" alt="" />
        <div id="hotspot-layer"></div>
        <div id="timer-bar" class="hidden"><div id="timer-fill"></div><span id="timer-label"></span></div>
        <button id="mute-toggle" type="button">Sonido: ON</button>
        <div id="inventory-bar"></div>
        <div id="character-portrait" class="hidden">
          <img id="character-portrait-img" alt="" />
          <span id="character-name"></span>
        </div>
        <div id="text-box">
          <p id="scene-text"></p>
          <p id="scene-whisper"></p>
        </div>
      </div>
      <div id="overlay-screen" class="hidden"></div>
    `;
    this.bg = this.root.querySelector("#scene-bg");
    this.hotspotLayer = this.root.querySelector("#hotspot-layer");
    this.timerBar = this.root.querySelector("#timer-bar");
    this.timerFill = this.root.querySelector("#timer-fill");
    this.timerLabel = this.root.querySelector("#timer-label");
    this.inventoryBar = this.root.querySelector("#inventory-bar");
    this.sceneText = this.root.querySelector("#scene-text");
    this.sceneWhisper = this.root.querySelector("#scene-whisper");
    this.overlay = this.root.querySelector("#overlay-screen");
    this.characterPortrait = this.root.querySelector("#character-portrait");
    this.characterPortraitImg = this.root.querySelector("#character-portrait-img");
    this.characterName = this.root.querySelector("#character-name");
    this.scene = this.root.querySelector("#scene");
    this.muteToggle = this.root.querySelector("#mute-toggle");
  }

  bindMuteToggle(onToggle) {
    this.muteToggle.addEventListener("click", () => onToggle?.());
  }

  setMuteLabel(muted) {
    this.muteToggle.textContent = muted ? "Sonido: OFF" : "Sonido: ON";
  }

  _setBackground(src) {
    if (this.bg.src.endsWith(src)) return;
    this.bg.classList.add("fading");
    const preload = new Image();
    preload.onload = () => {
      this.bg.src = src;
      requestAnimationFrame(() => this.bg.classList.remove("fading"));
    };
    preload.src = src;
  }

  _retriggerAnimation(el, className) {
    el.classList.remove(className);
    void el.offsetWidth; // fuerza reflow para reiniciar la animación CSS
    el.classList.add(className);
  }

  renderNode(node, { onHotspotClick } = {}) {
    this.overlay.classList.add("hidden");
    this.overlay.innerHTML = "";
    this._setBackground(node.background || "");
    this.bg.alt = node.id;
    this.sceneText.textContent = node.text || "";
    this.sceneWhisper.textContent = node.whisper || "";
    this.sceneWhisper.classList.toggle("hidden", !node.whisper);
    this._retriggerAnimation(this.sceneText, "text-enter");

    if (node.character) {
      this.characterPortrait.classList.remove("hidden");
      this.characterPortraitImg.src = node.character.portrait;
      this.characterPortraitImg.alt = node.character.name || "";
      this.characterName.textContent = node.character.name || "";
      this._retriggerAnimation(this.characterPortrait, "portrait-enter");
    } else {
      this.characterPortrait.classList.add("hidden");
    }

    this.hotspotLayer.innerHTML = "";
    (node.hotspots || []).forEach((hotspot) => {
      const [x, y, w, h] = hotspot.coords;
      const el = document.createElement("button");
      el.className = "hotspot";
      el.type = "button";
      el.setAttribute("aria-label", hotspot.id);
      el.style.left = `${x}%`;
      el.style.top = `${y}%`;
      el.style.width = `${w}%`;
      el.style.height = `${h}%`;
      el.addEventListener("click", () => onHotspotClick?.(hotspot));
      this.hotspotLayer.appendChild(el);
    });
  }

  showFloatingText(message) {
    if (!message) return;
    this.sceneText.textContent = message;
  }

  disableHotspot(hotspotId) {
    const el = this.hotspotLayer.querySelector(`[aria-label="${CSS.escape(hotspotId)}"]`);
    if (el) el.classList.add("disabled");
  }

  renderInventory(items) {
    this.inventoryBar.innerHTML = "";
    items.forEach((item) => {
      const el = document.createElement("div");
      el.className = "inventory-item";
      el.title = item.name;
      const img = document.createElement("img");
      img.src = item.icon ? `assets/icons/${item.icon}` : "";
      img.alt = item.name;
      el.appendChild(img);
      this.inventoryBar.appendChild(el);
    });
  }

  renderTimer(seconds, total) {
    if (seconds == null) {
      this.timerBar.classList.add("hidden");
      return;
    }
    this.timerBar.classList.remove("hidden");
    this.timerLabel.textContent = `${seconds}s`;
    const pct = total ? Math.max(0, (seconds / total) * 100) : 0;
    this.timerFill.style.width = `${pct}%`;
    const urgent = seconds <= 10;
    this.timerFill.classList.toggle("urgent", urgent);
    this.scene.classList.toggle("urgent", urgent);
  }

  hideTimer() {
    this.timerBar.classList.add("hidden");
    this.scene.classList.remove("urgent");
  }

  renderEndingScreen({ ending, unlockedCount, totalEndings, canRewind, onRewind, onContinue }) {
    this.overlay.classList.remove("hidden");
    const typeLabel = { tragico: "Trágico", agridulce: "Agridulce", verdadero: "Final verdadero" }[ending.type] || ending.type;
    this.overlay.innerHTML = `
      <div class="overlay-card">
        <h2>${ending.label || "Fin del camino"}</h2>
        <p class="ending-type ending-${ending.type}">${typeLabel}</p>
        <p>${unlockedCount} de ${totalEndings} finales desbloqueados</p>
        <div class="overlay-actions">
          ${canRewind ? '<button id="btn-rewind" class="btn">Rebobinar a la última decisión</button>' : ""}
          ${onContinue ? '<button id="btn-continue" class="btn btn-primary">Continuar</button>' : ""}
        </div>
      </div>
    `;
    if (canRewind) this.overlay.querySelector("#btn-rewind").addEventListener("click", onRewind);
    if (onContinue) this.overlay.querySelector("#btn-continue").addEventListener("click", onContinue);
  }

  renderPaywallScreen({ chapter, onPurchase }) {
    this.overlay.classList.remove("hidden");
    this.overlay.innerHTML = `
      <div class="overlay-card">
        <h2>Capítulo ${chapter.id} bloqueado</h2>
        <p>${chapter.title}</p>
        <p>USD ${chapter.priceUSD?.toFixed(2)}</p>
        <div class="overlay-actions">
          <button id="btn-buy" class="btn btn-primary">Comprar capítulo</button>
        </div>
      </div>
    `;
    this.overlay.querySelector("#btn-buy").addEventListener("click", onPurchase);
  }
}
