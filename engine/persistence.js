// Capa de persistencia. Usa Supabase si está configurado (window.APP_CONFIG),
// si no, cae a localStorage — así el motor funciona standalone para desarrollo/tests.

const LOCAL_KEY = "cabana_anon_user_id";

function getAnonUserId() {
  let id = localStorage.getItem(LOCAL_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(LOCAL_KEY, id);
  }
  return id;
}

class LocalStoragePersistence {
  constructor() {
    this.userId = getAnonUserId();
  }

  async getUserId() {
    return this.userId;
  }

  _progressKey(chapterId) {
    return `cabana_progress_ch${chapterId}`;
  }

  async saveProgress(state) {
    localStorage.setItem(this._progressKey(state.chapterId), JSON.stringify(state.toJSON()));
    return true;
  }

  async loadProgress(chapterId) {
    const raw = localStorage.getItem(this._progressKey(chapterId));
    return raw ? JSON.parse(raw) : null;
  }

  async getPurchasedChapters() {
    const raw = localStorage.getItem("cabana_purchases");
    return raw ? JSON.parse(raw) : [];
  }

  async recordLocalPurchase(chapterId) {
    const purchases = await this.getPurchasedChapters();
    if (!purchases.includes(chapterId)) purchases.push(chapterId);
    localStorage.setItem("cabana_purchases", JSON.stringify(purchases));
  }
}

class SupabasePersistence {
  constructor(client) {
    this.client = client;
    this.userId = null;
  }

  async _ensureSession() {
    if (this.userId) return this.userId;
    const { data: { session } } = await this.client.auth.getSession();
    if (session?.user) {
      this.userId = session.user.id;
      return this.userId;
    }
    const { data, error } = await this.client.auth.signInAnonymously();
    if (error) throw error;
    this.userId = data.user.id;
    return this.userId;
  }

  async getUserId() {
    return this._ensureSession();
  }

  async saveProgress(state) {
    const userId = await this._ensureSession();
    const payload = state.toJSON();
    const { error } = await this.client.from("progress").upsert(
      {
        user_id: userId,
        chapter_id: payload.chapterId,
        current_node_id: payload.currentNodeId,
        visited_nodes: payload.visitedNodes,
        flags: payload.flags,
        inventory: payload.inventory,
        endings_unlocked: payload.endingsUnlocked,
        last_decision_point: payload.lastDecisionPoint,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,chapter_id" }
    );
    if (error) throw error;
    return true;
  }

  async loadProgress(chapterId) {
    const userId = await this._ensureSession();
    const { data, error } = await this.client
      .from("progress")
      .select("*")
      .eq("user_id", userId)
      .eq("chapter_id", chapterId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      chapterId: data.chapter_id,
      currentNodeId: data.current_node_id,
      flags: data.flags || {},
      inventory: data.inventory || [],
      visitedNodes: data.visited_nodes || [],
      endingsUnlocked: data.endings_unlocked || [],
      lastDecisionPoint: data.last_decision_point || null,
    };
  }

  async getPurchasedChapters() {
    const userId = await this._ensureSession();
    const { data, error } = await this.client.from("purchases").select("chapter_id").eq("user_id", userId);
    if (error) throw error;
    return (data || []).map((row) => row.chapter_id);
  }
}

export async function createPersistence() {
  const cfg = window.APP_CONFIG || {};
  if (cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase) {
    try {
      const client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
      const persistence = new SupabasePersistence(client);
      await persistence._ensureSession();
      return persistence;
    } catch (err) {
      console.warn("Supabase no disponible, usando localStorage:", err);
      return new LocalStoragePersistence();
    }
  }
  return new LocalStoragePersistence();
}
