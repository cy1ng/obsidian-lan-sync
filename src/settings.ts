import { App, PluginSettingTab, Setting } from 'obsidian';
import type LanSyncPlugin from './main';
import type { SyncSettings } from './types';

export const DEFAULT_SETTINGS: SyncSettings = {
  deviceName: require('os').hostname(),
  port: 27123,
  sharedSecret: '',
  largeFileMB: 10,
  excludePatterns: ['.obsidian/', '.DS_Store', 'Thumbs.db', 'desktop.ini'],
};

export class LanSyncSettingTab extends PluginSettingTab {
  plugin: LanSyncPlugin;

  constructor(app: App, plugin: LanSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'LAN Sync 设置' });

    new Setting(containerEl)
      .setName('设备昵称')
      .setDesc('在对方设备列表中显示的名称')
      .addText(text =>
        text.setValue(this.plugin.settings.deviceName)
          .onChange(async value => {
            this.plugin.settings.deviceName = value.trim() || require('os').hostname();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('监听端口')
      .setDesc('HTTP 服务器端口（默认 27123）')
      .addText(text =>
        text.setValue(String(this.plugin.settings.port))
          .onChange(async value => {
            const port = parseInt(value, 10);
            if (!isNaN(port) && port > 1024 && port < 65535) {
              this.plugin.settings.port = port;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName('共享密钥')
      .setDesc('可选。双方必须设置相同的密钥才能同步，留空则不鉴权')
      .addText(text => {
        text.inputEl.type = 'password';
        text.setValue(this.plugin.settings.sharedSecret)
          .onChange(async value => {
            this.plugin.settings.sharedSecret = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('大文件阈值（MB）')
      .setDesc('超过此大小的文件传输时显示进度')
      .addText(text =>
        text.setValue(String(this.plugin.settings.largeFileMB))
          .onChange(async value => {
            const mb = parseInt(value, 10);
            if (!isNaN(mb) && mb > 0) {
              this.plugin.settings.largeFileMB = mb;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName('排除规则')
      .setDesc('每行一条 glob 规则，匹配的文件不参与同步')
      .addTextArea(text =>
        text.setValue(this.plugin.settings.excludePatterns.join('\n'))
          .onChange(async value => {
            this.plugin.settings.excludePatterns = value
              .split('\n').map(s => s.trim()).filter(s => s.length > 0);
            await this.plugin.saveSettings();
          })
      );
  }
}
