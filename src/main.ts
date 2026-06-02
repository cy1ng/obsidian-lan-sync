import { Notice, Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, LanSyncSettingTab } from './settings';
import { DiscoveryService } from './discovery';
import { SyncServer } from './server';
import { SyncEngine } from './sync-engine';
import { LanSyncView, VIEW_TYPE } from './view';
import type { PeerInfo, SyncSettings } from './types';

export default class LanSyncPlugin extends Plugin {
  settings: SyncSettings;
  discovery: DiscoveryService | null = null;
  private server: SyncServer | null = null;
  private syncEngine: SyncEngine | null = null;

  async onload() {
    await this.loadSettings();

    // 注册侧边栏视图
    this.registerView(VIEW_TYPE, leaf => new LanSyncView(leaf, this));
    this.addRibbonIcon('wifi', '局域网同步', () => this.activateView());

    // 设置页
    this.addSettingTab(new LanSyncSettingTab(this.app, this));

    // 命令:重新扫描局域网
    this.addCommand({
      id: 'rescan-lan',
      name: '重新扫描局域网设备',
      callback: () => this.rescan(),
    });

    // 启动服务器和发现
    await this.startServices();
  }

  onunload() {
    this.stopServices();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    // 设置变更后重启服务（端口/昵称可能变了）
    await this.stopServices();
    await this.startServices();
  }

  private async startServices() {
    // 启动 HTTP 服务器
    this.server = new SyncServer(this.app.vault, this.settings);
    try {
      await this.server.start();
    } catch (e) {
      new Notice(String(e));
      return;
    }

    // 启动 mDNS 发现
    this.discovery = new DiscoveryService(
      this.settings.deviceName,
      this.settings.port,
      peers => this.getView()?.updatePeers(peers)
    );
    this.discovery.start();

    // 初始化同步引擎
    this.syncEngine = new SyncEngine(this.app.vault, this.settings);
  }

  private async stopServices() {
    this.discovery?.stop();
    this.discovery = null;
    await this.server?.stop();
    this.server = null;
    this.syncEngine = null;
  }

  /** 由 View 的同步按钮调用 */
  async syncWithPeer(peer: PeerInfo) {
    if (!this.syncEngine) return;
    const view = this.getView();
    view?.setSyncStatus('syncing', peer.name);

    try {
      const result = await this.syncEngine.syncWithPeer(peer, msg => {
        view?.setSyncStatus('syncing', peer.name);
      });
      view?.setSyncStatus('idle', undefined, result);
      if (result.failed > 0) {
        new Notice(`同步完成，但有 ${result.failed} 个文件失败`);
      }
    } catch (e) {
      view?.setSyncStatus('error');
      new Notice(`同步失败：${e}`);
    }
  }

  /** 由 View 的刷新按钮 / 命令调用,重新扫描局域网 */
  rescan() {
    if (!this.discovery) return;
    this.getView()?.beginScan();
    this.discovery.rescan();
  }

  private async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false)!;
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  private getView(): LanSyncView | null {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    return leaf?.view instanceof LanSyncView ? leaf.view : null;
  }
}
