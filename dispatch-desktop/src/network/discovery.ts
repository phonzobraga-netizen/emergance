import dgram, { Socket } from "node:dgram";
import { EventEmitter } from "node:events";
import { DeviceRole } from "../core/types";

const MULTICAST_GROUP = "239.10.10.10";
const BROADCAST_HOST = "255.255.255.255";
const DISCOVERY_PORT = 37020;

export interface DiscoveryHello {
  deviceId: string;
  role: DeviceRole;
  tcpPort: number;
  sentAtMs: number;
}

export class DiscoveryService extends EventEmitter {
  private socket: Socket | null = null;
  private announceTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly localDeviceId: string,
    private readonly role: DeviceRole,
    private readonly tcpPort: number
  ) {
    super();
  }

  async start(): Promise<void> {
    if (this.socket) {
      return;
    }

    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    this.socket = socket;

    socket.on("message", (msg, rinfo) => {
      try {
        const parsed = JSON.parse(msg.toString("utf8")) as DiscoveryHello;
        if (!parsed.deviceId || parsed.deviceId === this.localDeviceId) {
          return;
        }
        this.emit("peer", {
          ...parsed,
          host: rinfo.address
        });
      } catch {
        // ignore invalid discovery packet
      }
    });

    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.bind(DISCOVERY_PORT, () => {
        try {
          socket.addMembership(MULTICAST_GROUP);
          socket.setMulticastTTL(2);
          socket.setMulticastLoopback(true);
          socket.setBroadcast(true);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });

    this.announce();
    this.announceTimer = setInterval(() => this.announce(), 2_000);
  }

  private announce(): void {
    if (!this.socket) {
      return;
    }

    const hello: DiscoveryHello = {
      deviceId: this.localDeviceId,
      role: this.role,
      tcpPort: this.tcpPort,
      sentAtMs: Date.now()
    };

    const payload = Buffer.from(JSON.stringify(hello), "utf8");
    this.socket.send(payload, DISCOVERY_PORT, MULTICAST_GROUP);
    this.socket.send(payload, DISCOVERY_PORT, BROADCAST_HOST);
  }

  stop(): void {
    if (this.announceTimer) {
      clearInterval(this.announceTimer);
      this.announceTimer = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}
