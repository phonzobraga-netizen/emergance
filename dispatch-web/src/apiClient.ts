import { addRandomIncident, applyLocalAction, loadLocalSnapshot, resetLocalState, tickResponders } from "./localEngine";
import { DispatchAction, DispatchSnapshot } from "./types";

export type DataMode = "local" | "remote";

export interface ConnectOptions {
  mode: DataMode;
  baseUrl: string;
}

export interface DispatchClient {
  getSnapshot(): Promise<DispatchSnapshot>;
  action(action: DispatchAction): Promise<void>;
  simulateSos(): Promise<void>;
  resetDemo(): Promise<void>;
  eventsUrl?: string;
}

export function createClient(options: ConnectOptions): DispatchClient {
  if (options.mode === "remote") {
    return remoteClient(options.baseUrl);
  }
  return localClient();
}

function localClient(): DispatchClient {
  return {
    async getSnapshot() {
      return tickResponders();
    },
    async action(action) {
      applyLocalAction(action);
    },
    async simulateSos() {
      addRandomIncident();
    },
    async resetDemo() {
      resetLocalState();
    },
    eventsUrl: undefined
  };
}

function remoteClient(baseUrl: string): DispatchClient {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const endpoint = normalizedBase || "/api/dispatch";

  return {
    async getSnapshot() {
      const response = await fetch(endpoint, { method: "GET" });
      if (!response.ok) {
        throw new Error(`Snapshot request failed (${response.status})`);
      }
      return (await response.json()) as DispatchSnapshot;
    },
    async action(action) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command: "ACTION", action })
      });
      if (!response.ok) {
        throw new Error(`Action request failed (${response.status})`);
      }
    },
    async simulateSos() {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command: "SIMULATE_SOS" })
      });
      if (!response.ok) {
        throw new Error(`Simulate SOS failed (${response.status})`);
      }
    },
    async resetDemo() {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command: "RESET_DEMO" })
      });
      if (!response.ok) {
        throw new Error(`Reset failed (${response.status})`);
      }
    },
    eventsUrl: `${endpoint}/events`
  };
}

export function defaultConnectOptions(): ConnectOptions {
  const savedBase = localStorage.getItem("emergance.dispatch.web.base");
  const isLocalHost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  const suggestedBase = isLocalHost ? "http://localhost:37024/api/dispatch" : "/api/dispatch";
  const effectiveBase = isLocalHost ? suggestedBase : savedBase || suggestedBase;
  return {
    // Force Remote API as default operational mode.
    mode: "remote",
    baseUrl: effectiveBase
  };
}

export function saveConnectOptions(options: ConnectOptions): void {
  localStorage.setItem("emergance.dispatch.web.mode", options.mode);
  localStorage.setItem("emergance.dispatch.web.base", options.baseUrl);
}
