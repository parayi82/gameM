// Resolución genérica de acciones de hotspot. Un único switch por TIPO de acción,
// nunca por escena — cada nodo/hotspot es dato, no código.

// "next_node:ID" | "text:mensaje libre" -> { kind: "next_node", nodeId } | { kind: "text", message }
export function parseOutcome(outcome) {
  if (!outcome) return null;
  const sep = outcome.indexOf(":");
  if (sep === -1) return { kind: "text", message: outcome };
  const kind = outcome.slice(0, sep);
  const rest = outcome.slice(sep + 1);
  if (kind === "next_node") return { kind: "next_node", nodeId: rest };
  if (kind === "text") return { kind: "text", message: rest };
  return { kind: "text", message: outcome };
}

// Ejecuta la acción de un hotspot contra el estado actual.
// Devuelve: { textAfter, nextNodeId, endTimer, branch }
// `branch` ("success"|"fail"|null) permite feedback genérico (sonido, animación)
// por RESULTADO sin acoplarse a la escena.
export function resolveAction(hotspot, state) {
  const result = { textAfter: hotspot.textAfter || null, nextNodeId: null, endTimer: !!hotspot.stopsTimer, branch: null };

  switch (hotspot.action) {
    case "reveal_item": {
      state.addItem(hotspot.item);
      return result;
    }

    case "set_flag": {
      state.setFlag(hotspot.flag, hotspot.value ?? true);
      return result;
    }

    case "requires_item": {
      const ok = state.hasItem(hotspot.requiredItem);
      result.branch = ok ? "success" : "fail";
      const outcome = parseOutcome(ok ? hotspot.onSuccess : hotspot.onFail);
      return applyOutcome(result, outcome);
    }

    case "requires_flag": {
      const expected = hotspot.expected ?? true;
      const ok = state.hasFlag(hotspot.flag, expected);
      result.branch = ok ? "success" : "fail";
      const outcome = parseOutcome(ok ? hotspot.onSuccess : hotspot.onFail);
      return applyOutcome(result, outcome);
    }

    case "goto": {
      result.nextNodeId = hotspot.nextNode;
      return result;
    }

    default:
      console.warn(`Acción de hotspot desconocida: ${hotspot.action}`);
      return result;
  }
}

function applyOutcome(result, outcome) {
  if (!outcome) return result;
  if (outcome.kind === "next_node") {
    result.nextNodeId = outcome.nodeId;
  } else if (outcome.kind === "text") {
    result.textAfter = outcome.message;
  }
  return result;
}
