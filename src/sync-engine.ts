import * as http from 'http';
import { minimatch } from 'minimatch';
import { Vault } from 'obsidian';
import type { FileEntry, PeerInfo, SyncResult, SyncSettings } from './types';

export type ProgressCallback = (msg: string) => void;

export class SyncEngine {
  private vault: Vault;
  private settings: SyncSettings;

  constructor(vault: Vault, settings: SyncSettings) {
    this.vault = vault;
    this.settings = settings;
  }

  /** 与指定 peer 执行一次完整同步，返回结果统计 */
  async syncWithPeer(peer: PeerInfo, onProgress: ProgressCallback): Promise<SyncResult> {
    const result: SyncResult = { uploaded: 0, downloaded: 0, skipped: 0, failed: 0, errors: [] };

    // 1. 获取对方文件清单
    let remoteEntries: FileEntry[];
    try {
      remoteEntries = await this.fetchManifest(peer);
    } catch (e) {
      throw new Error(`无法获取对方文件清单：${e}`);
    }

    // 2. 获取本地文件清单（排除规则过滤后）
    const localEntries = this.getLocalManifest();

    // 3. 对比，分类操作
    const remoteMap = new Map(remoteEntries.map(e => [e.path, e]));
    const localMap = new Map(localEntries.map(e => [e.path, e]));

    const toDownload: FileEntry[] = [];
    const toUpload: FileEntry[] = [];

    // 遍历 remote
    for (const [p, remote] of remoteMap) {
      const local = localMap.get(p);
      if (!local) {
        toDownload.push(remote); // 只在 remote 有
      } else if (remote.mtime > local.mtime) {
        toDownload.push(remote); // remote 更新
      } else if (local.mtime > remote.mtime) {
        toUpload.push(local);   // local 更新
      } else {
        result.skipped++;       // 相同
      }
    }

    // 只在 local 有的文件
    for (const [p, local] of localMap) {
      if (!remoteMap.has(p)) {
        toUpload.push(local);
      }
    }

    // 4. 串行执行下载
    for (const entry of toDownload) {
      onProgress(`下载 ${entry.path}`);
      try {
        await this.downloadFile(peer, entry);
        result.downloaded++;
      } catch (e) {
        result.failed++;
        result.errors.push(`下载失败 ${entry.path}: ${e}`);
      }
    }

    // 5. 串行执行上传
    for (const entry of toUpload) {
      onProgress(`上传 ${entry.path}`);
      try {
        await this.uploadFile(peer, entry);
        result.uploaded++;
      } catch (e) {
        result.failed++;
        result.errors.push(`上传失败 ${entry.path}: ${e}`);
      }
    }

    return result;
  }

  /** 获取本地文件清单，应用排除规则 */
  getLocalManifest(): FileEntry[] {
    return this.vault.getFiles()
      .filter(f => !this.isExcluded(f.path))
      .map(f => ({ path: f.path, mtime: f.stat.mtime, size: f.stat.size }));
  }

  private isExcluded(filePath: string): boolean {
    return this.settings.excludePatterns.some(pattern =>
      minimatch(filePath, pattern, { dot: true }) ||
      filePath.startsWith(pattern.replace(/\/$/, '') + '/')
    );
  }

  private fetchManifest(peer: PeerInfo): Promise<FileEntry[]> {
    return new Promise((resolve, reject) => {
      const options: http.RequestOptions = {
        hostname: peer.host,
        port: peer.port,
        path: '/manifest',
        method: 'GET',
        headers: this.authHeaders(),
        timeout: 10000,
      };
      const req = http.request(options, res => {
        if (res.statusCode === 401) { reject(new Error('鉴权失败，请检查共享密钥是否一致')); return; }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
          catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('连接超时')); });
      req.end();
    });
  }

  private async downloadFile(peer: PeerInfo, entry: FileEntry): Promise<void> {
    const data = await new Promise<Buffer>((resolve, reject) => {
      const options: http.RequestOptions = {
        hostname: peer.host,
        port: peer.port,
        path: `/file?path=${encodeURIComponent(entry.path)}`,
        method: 'GET',
        headers: this.authHeaders(),
        timeout: 60000,
      };
      const req = http.request(options, res => {
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('下载超时')); });
      req.end();
    });

    // 确保目录存在
    const dir = entry.path.includes('/') ? entry.path.substring(0, entry.path.lastIndexOf('/')) : '';
    if (dir) await this.vault.adapter.mkdir(dir);
    await this.vault.adapter.writeBinary(entry.path, data);
  }

  private uploadFile(peer: PeerInfo, entry: FileEntry): Promise<void> {
    return new Promise(async (resolve, reject) => {
      let data: ArrayBuffer;
      try {
        data = await this.vault.adapter.readBinary(entry.path);
      } catch (e) {
        reject(e); return;
      }
      const buf = Buffer.from(data);
      const options: http.RequestOptions = {
        hostname: peer.host,
        port: peer.port,
        path: `/file?path=${encodeURIComponent(entry.path)}&mtime=${entry.mtime}`,
        method: 'POST',
        headers: {
          ...this.authHeaders(),
          'Content-Type': 'application/octet-stream',
          'Content-Length': buf.length,
        },
        timeout: 60000,
      };
      const req = http.request(options, res => {
        if (res.statusCode === 200) { resolve(); }
        else { reject(new Error(`HTTP ${res.statusCode}`)); }
        res.resume();
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('上传超时')); });
      req.write(buf);
      req.end();
    });
  }

  private authHeaders(): Record<string, string> {
    if (!this.settings.sharedSecret) return {};
    return { 'X-Sync-Token': this.settings.sharedSecret };
  }
}
