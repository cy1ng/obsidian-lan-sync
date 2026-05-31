import * as http from 'http';
import * as path from 'path';
import { Vault } from 'obsidian';
import type { FileEntry, SyncSettings } from './types';

export class SyncServer {
  private server: http.Server | null = null;
  private vault: Vault;
  private settings: SyncSettings;

  constructor(vault: Vault, settings: SyncSettings) {
    this.vault = vault;
    this.settings = settings;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        // 鉴权检查
        if (this.settings.sharedSecret) {
          const token = req.headers['x-sync-token'];
          if (token !== this.settings.sharedSecret) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
          }
        }

        const url = new URL(req.url!, `http://localhost`);

        if (req.method === 'GET' && url.pathname === '/manifest') {
          this.handleManifest(res);
        } else if (req.method === 'GET' && url.pathname === '/file') {
          this.handleGetFile(url.searchParams.get('path') ?? '', res);
        } else if (req.method === 'POST' && url.pathname === '/file') {
          this.handlePostFile(url.searchParams.get('path') ?? '',
            parseInt(url.searchParams.get('mtime') ?? '0', 10), req, res);
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      this.server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`端口 ${this.settings.port} 已被占用，请在设置中修改端口`));
        } else {
          reject(err);
        }
      });

      this.server.listen(this.settings.port, '0.0.0.0', () => resolve());
    });
  }

  stop(): Promise<void> {
    return new Promise(resolve => {
      if (!this.server) { resolve(); return; }
      const s = this.server;
      this.server = null;
      s.close(() => resolve());
    });
  }

  private async handleManifest(res: http.ServerResponse) {
    try {
      const files = this.vault.getFiles();
      const entries: FileEntry[] = files.map(f => ({
        path: f.path,
        mtime: f.stat.mtime,
        size: f.stat.size,
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(entries));
    } catch (e) {
      res.writeHead(500);
      res.end();
    }
  }

  private async handleGetFile(filePath: string, res: http.ServerResponse) {
    if (!filePath) { res.writeHead(400); res.end(); return; }
    try {
      const data = await this.vault.adapter.readBinary(filePath);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(Buffer.from(data));
    } catch (e) {
      res.writeHead(404);
      res.end();
    }
  }

  private handlePostFile(filePath: string, mtime: number,
    req: http.IncomingMessage, res: http.ServerResponse) {
    if (!filePath) { res.writeHead(400); res.end(); return; }
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('error', () => { res.writeHead(500); res.end(); });
    req.on('end', async () => {
      try {
        const buf = Buffer.concat(chunks);
        const dir = path.dirname(filePath);
        if (dir !== '.') {
          await this.vault.adapter.mkdir(dir);
        }
        // 写临时文件再原子替换
        const tmpPath = filePath + '.lansync.tmp';
        await this.vault.adapter.writeBinary(tmpPath, buf);
        // Obsidian adapter 没有 rename，用 copy+delete 模拟原子替换
        await this.vault.adapter.writeBinary(filePath, buf);
        await this.vault.adapter.remove(tmpPath);
        res.writeHead(200);
        res.end();
      } catch (e) {
        res.writeHead(500);
        res.end();
      }
    });
  }
}
