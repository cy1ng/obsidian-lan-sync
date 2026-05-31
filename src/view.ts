import { ItemView, WorkspaceLeaf } from 'obsidian';
import type LanSyncPlugin from './main';
import type { PeerInfo, SyncResult, SyncStatus } from './types';

export const VIEW_TYPE = 'lan-sync-view';

export class LanSyncView extends ItemView {
  plugin: LanSyncPlugin;
  private peers: Map<string, PeerInfo> = new Map();
  private status: SyncStatus = 'idle';
  private lastResult: SyncResult | null = null;
  private lastSyncTime: Date | null = null;
  private syncingPeer: string | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: LanSyncPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return '局域网同步'; }
  getIcon() { return 'wifi'; }

  async onOpen() { this.render(); }
  async onClose() {}

  updatePeers(peers: Map<string, PeerInfo>) {
    this.peers = peers;
    this.render();
  }

  setSyncStatus(status: SyncStatus, peerName?: string, result?: SyncResult) {
    this.status = status;
    this.syncingPeer = peerName ?? null;
    if (result) {
      this.lastResult = result;
      this.lastSyncTime = new Date();
    }
    this.render();
  }

  private render() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h4', { text: '局域网同步' });

    // 在线设备列表
    const section = containerEl.createDiv({ cls: 'lan-sync-peers' });
    section.createEl('p', { text: '在线设备', cls: 'lan-sync-section-title' });

    if (this.peers.size === 0) {
      section.createEl('p', { text: '正在扫描局域网…', cls: 'lan-sync-empty' });
    } else {
      for (const [name, peer] of this.peers) {
        const online = peer.host !== '';
        const row = section.createDiv({ cls: 'lan-sync-peer-row' });
        row.createSpan({ text: online ? '● ' : '○ ', cls: online ? 'lan-sync-online' : 'lan-sync-offline' });
        row.createSpan({ text: online ? name : `${name}（离线）` });

        if (online) {
          const btn = row.createEl('button', {
            text: this.syncingPeer === name ? '同步中…' : '同步',
            cls: 'lan-sync-btn',
          });
          btn.disabled = this.status === 'syncing';
          btn.onclick = () => (this.plugin as any).syncWithPeer(peer);
        }
      }
    }

    // 上次同步状态
    const footer = containerEl.createDiv({ cls: 'lan-sync-footer' });
    if (this.lastSyncTime && this.lastResult) {
      const r = this.lastResult;
      footer.createEl('p', {
        text: `上次同步：${this.lastSyncTime.toLocaleTimeString()}`,
        cls: 'lan-sync-time',
      });
      footer.createEl('p', {
        text: `↑${r.uploaded} ↓${r.downloaded} 跳过${r.skipped}${r.failed > 0 ? ` ⚠${r.failed}个失败` : ''}`,
        cls: 'lan-sync-result',
      });
    } else {
      footer.createEl('p', { text: '尚未同步', cls: 'lan-sync-time' });
    }
  }
}
