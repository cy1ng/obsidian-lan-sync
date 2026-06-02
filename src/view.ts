import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import type LanSyncPlugin from './main';
import type { PeerInfo, SyncResult, SyncStatus } from './types';

export const VIEW_TYPE = 'lan-sync-view';

/** 初始扫描时长：超过此时间仍无设备则显示"未发现设备" */
const SCAN_TIMEOUT_MS = 5000;

export class LanSyncView extends ItemView {
  plugin: LanSyncPlugin;
  private peers: Map<string, PeerInfo> = new Map();
  private status: SyncStatus = 'idle';
  private lastResult: SyncResult | null = null;
  private lastSyncTime: Date | null = null;
  private syncingPeer: string | null = null;
  private scanComplete = false;
  private scanTimer: number | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: LanSyncPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return '局域网同步'; }
  getIcon() { return 'wifi'; }

  async onOpen() {
    // 打开时从 discovery 拉取当前已发现的设备，避免错过早先的发现事件
    const existing = this.plugin.discovery?.getPeers();
    if (existing && existing.size > 0) {
      this.peers = existing;
      this.scanComplete = true;
    } else {
      // 启动扫描倒计时：到点仍无设备就从"扫描中"切换到"未发现设备"
      this.scanComplete = false;
      this.scanTimer = window.setTimeout(() => {
        this.scanComplete = true;
        this.render();
      }, SCAN_TIMEOUT_MS);
    }
    this.render();
  }

  async onClose() {
    if (this.scanTimer !== null) {
      window.clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
  }

  updatePeers(peers: Map<string, PeerInfo>) {
    this.peers = peers;
    // 收到任何发现回调即视为扫描已出结果
    this.scanComplete = true;
    if (this.scanTimer !== null) {
      window.clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
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

  private onlineCount(): number {
    let n = 0;
    for (const p of this.peers.values()) if (p.host !== '') n++;
    return n;
  }

  private render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('lan-sync-view');

    const root = contentEl.createDiv({ cls: 'lan-sync-root' });

    // ── 标题栏 ─────────────────────────────
    const header = root.createDiv({ cls: 'lan-sync-header' });
    const titleIcon = header.createSpan({ cls: 'lan-sync-title-icon' });
    setIcon(titleIcon, 'wifi');
    header.createSpan({ text: '局域网同步', cls: 'lan-sync-title' });

    // ── 在线设备区 ─────────────────────────
    const section = root.createDiv({ cls: 'lan-sync-card' });
    const secHead = section.createDiv({ cls: 'lan-sync-card-head' });
    secHead.createSpan({ text: '在线设备', cls: 'lan-sync-card-title' });
    const online = this.onlineCount();
    if (this.scanComplete && this.peers.size > 0) {
      secHead.createSpan({ text: String(online), cls: 'lan-sync-badge' });
    }

    if (this.peers.size === 0) {
      if (!this.scanComplete) {
        // 扫描进行中
        const empty = section.createDiv({ cls: 'lan-sync-empty' });
        empty.createDiv({ cls: 'lan-sync-spinner' });
        empty.createSpan({ text: '正在扫描局域网…' });
      } else {
        // 扫描结束，无设备
        const empty = section.createDiv({ cls: 'lan-sync-empty' });
        const icon = empty.createSpan({ cls: 'lan-sync-empty-icon' });
        setIcon(icon, 'search-x');
        empty.createSpan({ text: '未发现局域网设备' });
        const hint = section.createDiv({ cls: 'lan-sync-hint' });
        hint.setText('请确认其他设备已开启本插件且处于同一网络');
      }
    } else {
      const list = section.createDiv({ cls: 'lan-sync-peer-list' });
      for (const [name, peer] of this.peers) {
        this.renderPeerRow(list, name, peer);
      }
    }

    // ── 底部同步状态 ───────────────────────
    const footer = root.createDiv({ cls: 'lan-sync-footer' });
    if (this.lastSyncTime && this.lastResult) {
      const r = this.lastResult;
      footer.createDiv({
        text: `上次同步 ${this.lastSyncTime.toLocaleTimeString()}`,
        cls: 'lan-sync-time',
      });
      const stats = footer.createDiv({ cls: 'lan-sync-stats' });
      stats.createSpan({ text: `↑ ${r.uploaded}`, cls: 'lan-sync-stat up' });
      stats.createSpan({ text: `↓ ${r.downloaded}`, cls: 'lan-sync-stat down' });
      stats.createSpan({ text: `跳过 ${r.skipped}`, cls: 'lan-sync-stat skip' });
      if (r.failed > 0) {
        stats.createSpan({ text: `失败 ${r.failed}`, cls: 'lan-sync-stat fail' });
      }
    } else {
      footer.createDiv({ text: '尚未同步', cls: 'lan-sync-time muted' });
    }
  }

  private renderPeerRow(list: HTMLElement, name: string, peer: PeerInfo) {
    const isOnline = peer.host !== '';
    const isSyncing = this.syncingPeer === name && this.status === 'syncing';

    const row = list.createDiv({
      cls: `lan-sync-peer-row${isOnline ? '' : ' offline'}`,
    });

    const dot = row.createSpan({
      cls: `lan-sync-dot ${isOnline ? 'online' : 'offline'}`,
    });
    dot.setAttr('aria-label', isOnline ? '在线' : '离线');

    const info = row.createDiv({ cls: 'lan-sync-peer-info' });
    info.createDiv({ text: name, cls: 'lan-sync-peer-name' });
    info.createDiv({
      text: isOnline ? `${peer.host}:${peer.port}` : '离线',
      cls: 'lan-sync-peer-addr',
    });

    if (isOnline) {
      const btn = row.createEl('button', {
        cls: `lan-sync-btn${isSyncing ? ' is-syncing' : ''}`,
      });
      if (isSyncing) {
        btn.createDiv({ cls: 'lan-sync-spinner sm' });
        btn.createSpan({ text: '同步中' });
      } else {
        const bi = btn.createSpan({ cls: 'lan-sync-btn-icon' });
        setIcon(bi, 'refresh-cw');
        btn.createSpan({ text: '同步' });
      }
      btn.disabled = this.status === 'syncing';
      btn.onclick = () => this.plugin.syncWithPeer(peer);
    }
  }
}
