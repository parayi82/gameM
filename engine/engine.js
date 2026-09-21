import { GameState } from "./state.js";
import { SceneTimer } from "./timer.js";
import { resolveAction } from "./actions.js";
import { Renderer } from "./render.js";
import { SoundManager } from "./audio.js";

// Sonido de feedback por TIPO de acción/resultado — igual que actions.js,
// nunca hardcodeado por escena.
const ACTION_SOUND = {
  reveal_item: (sound) => sound.playPickup(),
  set_flag: (sound) => sound.playClick(),
  goto: (sound) => sound.playClick(),
  requires_item: (sound, result) => (result.branch === "success" ? sound.playUnlock() : sound.playFail()),
  requires_flag: (sound, result) => (result.branch === "success" ? sound.playUnlock() : sound.playFail()),
};

// Motor genérico: lee nodos por id desde chapterData.nodes, resuelve hotspots
// por TIPO de acción (actions.js), nunca por id de escena.
export class GameEngine {
  constructor({ root, chapterData, persistence, onChapterComplete }) {
    this.renderer = new Renderer(root);
    this.chapterData = chapterData;
    this.persistence = persistence;
    this.onChapterComplete = onChapterComplete;
    this.state = new GameState({ chapterId: chapterData.chapterId, currentNodeId: chapterData.startNode });
    this.sound = new SoundManager();
    this.timer = new SceneTimer({
      onTick: (s) => {
        this.renderer.renderTimer(s, this._currentTimerTotal);
        if (s <= 10) this.sound.startTension();
      },
      onExpire: () => this._handleTimerExpire(),
    });
    this.renderer.setMuteLabel(false);
    this.renderer.bindMuteToggle(() => this._toggleMute());
  }

  async loadProgress() {
    const saved = await this.persistence.loadProgress(this.chapterData.chapterId);
    if (saved) {
      this.state = new GameState(saved);
    }
    this._enterNode(this.state.currentNodeId);
  }

  _getNode(nodeId) {
    const node = this.chapterData.nodes[nodeId];
    if (!node) throw new Error(`Nodo no encontrado: ${nodeId}`);
    return node;
  }

  _enterNode(nodeId) {
    const node = this._getNode(nodeId);
    this.state.currentNodeId = nodeId;
    this.state.markVisited(nodeId);

    if (node.decisionPoint) {
      this.state.recordDecisionPoint(nodeId);
    }

    this.timer.stop();
    this.sound.stopTension();
    this.sound.startAmbient(node.ambient || "none");
    this.renderer.renderNode(node, { onHotspotClick: (hotspot) => this._handleHotspot(node, hotspot) });
    this.renderer.renderInventory(this.state.inventory);

    if (node.timer) {
      this._currentTimerTotal = node.timer.seconds;
      this._timerOnExpire = node.timer.onExpire;
      this.timer.start(node.timer.seconds);
    } else {
      this._currentTimerTotal = null;
      this.renderer.hideTimer();
    }

    this._persist();

    if (node.ending) {
      this._showEnding(node);
    }
  }

  _handleHotspot(node, hotspot) {
    if (hotspot.onceOnly && this._hotspotUsed(node.id, hotspot.id)) return;

    const result = resolveAction(hotspot, this.state);

    ACTION_SOUND[hotspot.action]?.(this.sound, result);
    if (hotspot.onceOnly) this._markHotspotUsed(node.id, hotspot.id);
    if (result.endTimer) {
      this.timer.stop();
      this.sound.stopTension();
    }
    if (result.textAfter) this.renderer.showFloatingText(result.textAfter);
    if (hotspot.action === "reveal_item" || hotspot.action === "set_flag") {
      this.renderer.renderInventory(this.state.inventory);
      if (hotspot.onceOnly) this.renderer.disableHotspot(hotspot.id);
    }

    this._persist();

    if (result.nextNodeId) {
      this._enterNode(result.nextNodeId);
    }
  }

  _hotspotUsed(nodeId, hotspotId) {
    return this.state.flags[`__used_${nodeId}_${hotspotId}`] === true;
  }

  _markHotspotUsed(nodeId, hotspotId) {
    this.state.setFlag(`__used_${nodeId}_${hotspotId}`, true);
  }

  _handleTimerExpire() {
    if (this._timerOnExpire) this._enterNode(this._timerOnExpire);
  }

  _showEnding(node) {
    this.state.unlockEnding(node.id);
    this._persist();
    const endingMeta = this.chapterData.endings[node.id];
    this.sound.playEndingSting(endingMeta?.type);
    const totalEndings = Object.keys(this.chapterData.endings || {}).length;
    const canRewind = !!this.state.lastDecisionPoint;
    this.renderer.renderEndingScreen({
      ending: { ...endingMeta, label: node.text },
      unlockedCount: this.state.endingsUnlocked.size,
      totalEndings,
      canRewind,
      onRewind: () => this._rewind(),
      onContinue: this.onChapterComplete ? () => this.onChapterComplete(this.state) : null,
    });
  }

  _rewind() {
    const nodeId = this.state.restoreFromLastDecisionPoint();
    if (nodeId) this._enterNode(nodeId);
  }

  async _persist() {
    try {
      await this.persistence.saveProgress(this.state);
    } catch (err) {
      console.warn("No se pudo guardar el progreso:", err);
    }
  }

  _toggleMute() {
    this._muted = !this._muted;
    this.sound.setMuted(this._muted);
    this.renderer.setMuteLabel(this._muted);
    if (!this._muted) {
      const node = this._getNode(this.state.currentNodeId);
      this.sound.startAmbient(node.ambient || "none");
    }
  }
}
