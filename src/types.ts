/** 局域网内发现的对等节点信息 */
export interface PeerInfo {
  name: string;      // 设备昵称
  host: string;      // IP 地址（空字符串表示离线）
  port: number;      // HTTP 端口
  lastSeen: number;  // 最后发现时间戳（毫秒）
}

/** vault 中单个文件的元数据 */
export interface FileEntry {
  path: string;   // 相对于 vault 根目录，使用正斜杠
  mtime: number;  // 修改时间戳（毫秒）
  size: number;   // 文件大小（字节）
}

/** 插件设置 */
export interface SyncSettings {
  deviceName: string;
  port: number;
  sharedSecret: string;
  largeFileMB: number;
  excludePatterns: string[];
}

/** 一次同步操作的结果 */
export interface SyncResult {
  uploaded: number;
  downloaded: number;
  skipped: number;
  failed: number;
  errors: string[];
}

export type SyncStatus = 'idle' | 'syncing' | 'error';
