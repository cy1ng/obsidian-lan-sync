import Bonjour from 'bonjour-service';
import type { Browser, Service } from 'bonjour-service';
import type { PeerInfo } from './types';

const SERVICE_TYPE = 'obsidian-sync';

export type PeersChangedCallback = (peers: Map<string, PeerInfo>) => void;

export class DiscoveryService {
  private bonjour: Bonjour;
  private browser: Browser | null = null;
  private peers: Map<string, PeerInfo> = new Map();
  private onPeersChanged: PeersChangedCallback;
  private deviceName: string;
  private port: number;

  constructor(deviceName: string, port: number, onPeersChanged: PeersChangedCallback) {
    this.bonjour = new Bonjour();
    this.deviceName = deviceName;
    this.port = port;
    this.onPeersChanged = onPeersChanged;
  }

  start() {
    // 广播自身
    this.bonjour.publish({
      name: this.deviceName,
      type: SERVICE_TYPE,
      port: this.port,
    });

    // 监听其他实例
    this.browser = this.bonjour.find({ type: SERVICE_TYPE });

    this.browser.on('up', (service: Service) => {
      // 跳过自己
      if (service.name === this.deviceName) return;
      const host = (service as any).addresses?.[0] ?? service.host;
      const peer: PeerInfo = {
        name: service.name,
        host,
        port: service.port,
        lastSeen: Date.now(),
      };
      this.peers.set(service.name, peer);
      this.onPeersChanged(new Map(this.peers));
    });

    this.browser.on('down', (service: Service) => {
      if (this.peers.has(service.name)) {
        // 标记为离线但保留记录
        const peer = this.peers.get(service.name)!;
        this.peers.set(service.name, { ...peer, host: '' }); // host 清空表示离线
        this.onPeersChanged(new Map(this.peers));
      }
    });
  }

  stop() {
    this.browser?.stop();
    this.bonjour.unpublishAll();
    this.bonjour.destroy();
  }

  /**
   * 重新扫描局域网:清空当前已知设备并重新发送 mDNS 查询。
   * 在线设备会重新响应,通过 'up' 事件再次填充列表。
   */
  rescan() {
    this.peers.clear();
    this.onPeersChanged(new Map(this.peers));
    if (this.browser) {
      this.browser.update();
    } else {
      // 浏览器尚未启动(理论上不会发生),重新启动一次
      this.start();
    }
  }

  getPeers(): Map<string, PeerInfo> {
    return new Map(this.peers);
  }

  isOnline(peer: PeerInfo): boolean {
    return peer.host !== '';
  }
}
