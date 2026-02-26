import net, { Server, Socket } from "node:net";
import { EventEmitter } from "node:events";

const HEADER_SIZE = 4;

export class TcpTransport extends EventEmitter {
  private server: Server | null = null;

  constructor(private readonly port: number) {
    super();
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    this.server = net.createServer((socket) => this.handleSocket(socket));
    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(this.port, "0.0.0.0", () => resolve());
    });
  }

  private handleSocket(socket: Socket): void {
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= HEADER_SIZE) {
        const frameLength = buffer.readUInt32BE(0);
        if (buffer.length < HEADER_SIZE + frameLength) {
          break;
        }
        const frame = buffer.subarray(HEADER_SIZE, HEADER_SIZE + frameLength);
        buffer = buffer.subarray(HEADER_SIZE + frameLength);
        this.emit("frame", frame, socket.remoteAddress ?? "0.0.0.0");
      }
    });
  }

  async send(host: string, port: number, frame: Buffer): Promise<void> {
    const socket = net.createConnection({ host, port });
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.once("connect", () => resolve());
    });

    const header = Buffer.alloc(4);
    header.writeUInt32BE(frame.length, 0);

    await new Promise<void>((resolve, reject) => {
      socket.write(Buffer.concat([header, frame]), (error) => {
        if (error) {
          reject(error);
          return;
        }
        socket.end(resolve);
      });
    });
  }

  stop(): void {
    this.server?.close();
    this.server = null;
  }
}