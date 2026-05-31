import { Plugin } from 'obsidian';

export default class LanSyncPlugin extends Plugin {
  async onload() {
    console.log('LAN Sync: loaded');
  }
  onunload() {
    console.log('LAN Sync: unloaded');
  }
}
