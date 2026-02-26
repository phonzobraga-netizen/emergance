import { EventEmitter } from "node:events";
import { encodeEnvelope, decodeEnvelope } from "../core/protocol";
import { DeviceRole, Envelope, PeerSnapshot, TransportKind } from "../core/types";
import { DiscoveryService } from "./discovery";
import { TcpTransport } from "./tcpTransport";

export interface TransportAdapter {
  readonly kind: TransportKind;
  start(): Promise<void>;
  send(envelope: Envelope, targetDeviceId?: string): Promise<boolean>;
  peers(): PeerSnapshot[];
  onReceive(handler: (envelope: Envelope, via: TransportKind, fromHost: string) => Promise<void>): void;
}

class LanAdapter implements TransportAdapter {
  readonly kind: TransportKind = "LAN";
  private readonly peersById = new Map<string, PeerSnapshot>();
  private receiveHandler: ((envelope: Envelope, via: TransportKind, fromHost: string) => Promise<void>) | null =
    null;

  constructor(
    private readonly deviceId: string,
    private readonly role: DeviceRole,
    private readonly tcpPort: number,
    private readonly discovery = new DiscoveryService(deviceId, role, tcpPort),
    private readonly tcp = new TcpTransport(tcpPort)
  ) {}

  async start(): Promise<void> {
    this.discovery.on("peer", (peer: { deviceId: string; role: DeviceRole; tcpPort: number; host: string; sentAtMs: number }) => {
      this.peersById.set(peer.deviceId, {
        deviceId: peer.deviceId,
        role: peer.role,
        host: peer.host,
        port: peer.tcpPort,
        transport: "LAN",
        lastSeenMs: peer.sentAtMs
      });
    });

    this.tcp.on("frame", async (frame: Buffer, fromHost: string) => {
      if (!this.receiveHandler) {
        return;
      }
      try {
        const envelope = decodeEnvelope(frame);
        this.peersById.set(envelope.senderDeviceId, {
          deviceId: envelope.senderDeviceId,
          role: envelope.senderRole,
          host: fromHost,
          port: this.peersById.get(envelope.senderDeviceId)?.port ?? 37021,
          transport: "LAN",
          lastSeenMs: Date.now()
        });
        await this.receiveHandler(envelope, "LAN", fromHost);
      } catch {
        // drop invalid frame
      }
    });

    await this.tcp.start();
    await this.discovery.start();
  }

  async send(envelope: Envelope, targetDeviceId?: string): Promise<boolean> {
    const frame = encodeEnvelope(envelope);
    const destinations = targetDeviceId
      ? [this.peersById.get(targetDeviceId)].filter(Boolean)
      : Array.from(this.peersById.values());

    if (destinations.length === 0) {
      return false;
    }

    let sent = false;
    for (const peer of destinations) {
      if (!peer) {
        continue;
      }
      try {
        await this.tcp.send(peer.host, peer.port, frame);
        sent = true;
      } catch {
        // continue to next peer
      }
    }

    return sent;
  }

  peers(): PeerSnapshot[] {
    return Array.from(this.peersById.values()).filter((peer) => Date.now() - peer.lastSeenMs <= 15_000);
  }

  onReceive(handler: (envelope: Envelope, via: TransportKind, fromHost: string) => Promise<void>): void {
    this.receiveHandler = handler;
  }
}

class PlaceholderAdapter implements TransportAdapter {
  private handler: ((envelope: Envelope, via: TransportKind, fromHost: string) => Promise<void>) | null = null;

  constructor(public readonly kind: TransportKind) {}

  async start(): Promise<void> {
    // Intentionally no-op in v1 initial implementation.
  }

  async send(): Promise<boolean> {
    return false;
  }

  peers(): PeerSnapshot[] {
    return [];
  }

  onReceive(handler: (envelope: Envelope, via: TransportKind, fromHost: string) => Promise<void>): void {
    this.handler = handler;
  }
}

export class TransportManager extends EventEmitter {
  private readonly adapters: TransportAdapter[];

  constructor(deviceId: string, role: DeviceRole, tcpPort = 37021) {
    super();
    this.adapters = [
      new LanAdapter(deviceId, role, tcpPort),
      new PlaceholderAdapter("WIFI_DIRECT"),
      new PlaceholderAdapter("BLE")
    ];
  }

  async start(): Promise<void> {
    for (const adapter of this.adapters) {
      adapter.onReceive(async (envelope, via, fromHost) => {
        this.emit("envelope", envelope, via, fromHost);
      });
      await adapter.start();
    }
  }

  async send(envelope: Envelope, targetDeviceId?: string): Promise<boolean> {
    for (const preferred of ["LAN", "WIFI_DIRECT", "BLE"] as const) {
      const adapter = this.adapters.find((candidate) => candidate.kind === preferred);
      if (!adapter) {
        continue;
      }
      const sent = await adapter.send(envelope, targetDeviceId);
      if (sent) {
        return true;
      }
    }
    return false;
  }

  peers(): PeerSnapshot[] {
    return this.adapters.flatMap((adapter) => adapter.peers());
  }
}
