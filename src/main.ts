import { Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, LanSyncSettingTab } from './settings';
import type { SyncSettings } from './types';

export default class LanSyncPlugin extends Plugin {
  settings: SyncSettings;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new LanSyncSettingTab(this.app, this));
    console.log('LAN Sync: loaded');
  }

  onunload() {
    console.log('LAN Sync: unloaded');
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
