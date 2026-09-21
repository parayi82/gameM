// Estado de juego para un capítulo en curso. Sin lógica de escenas: solo datos + helpers.
export class GameState {
  constructor({ chapterId, currentNodeId, flags = {}, inventory = [], visitedNodes = [], endingsUnlocked = [], lastDecisionPoint = null, score = 0 } = {}) {
    this.chapterId = chapterId;
    this.currentNodeId = currentNodeId;
    this.flags = { ...flags };
    this.inventory = [...inventory];
    this.visitedNodes = new Set(visitedNodes);
    this.endingsUnlocked = new Set(endingsUnlocked);
    this.lastDecisionPoint = lastDecisionPoint; // { nodeId, snapshot: { flags, inventory } }
    this.score = score;
  }

  addScore(delta) {
    this.score = Math.max(0, this.score + delta);
  }

  hasItem(itemId) {
    return this.inventory.some((it) => it.id === itemId);
  }

  addItem(item) {
    if (!this.hasItem(item.id)) this.inventory.push(item);
  }

  setFlag(flag, value = true) {
    this.flags[flag] = value;
  }

  hasFlag(flag, expected = true) {
    return this.flags[flag] === expected;
  }

  markVisited(nodeId) {
    this.visitedNodes.add(nodeId);
  }

  isFirstVisit(nodeId) {
    return !this.visitedNodes.has(nodeId);
  }

  unlockEnding(endingId) {
    this.endingsUnlocked.add(endingId);
  }

  snapshotForRewind() {
    return {
      flags: { ...this.flags },
      inventory: [...this.inventory],
    };
  }

  recordDecisionPoint(nodeId) {
    this.lastDecisionPoint = { nodeId, snapshot: this.snapshotForRewind() };
  }

  restoreFromLastDecisionPoint() {
    if (!this.lastDecisionPoint) return null;
    const { nodeId, snapshot } = this.lastDecisionPoint;
    this.flags = { ...snapshot.flags };
    this.inventory = [...snapshot.inventory];
    this.currentNodeId = nodeId;
    return nodeId;
  }

  toJSON() {
    return {
      chapterId: this.chapterId,
      currentNodeId: this.currentNodeId,
      flags: this.flags,
      inventory: this.inventory,
      visitedNodes: [...this.visitedNodes],
      endingsUnlocked: [...this.endingsUnlocked],
      lastDecisionPoint: this.lastDecisionPoint,
      score: this.score,
    };
  }
}
