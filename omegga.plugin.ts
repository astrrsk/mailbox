import OmeggaPlugin, { OL, PS, PC, OmeggaPlayer } from 'omegga';
//import * as fs from 'fs';

type Config = { foo: string };
type Storage = { bar: string };

const DS_LASTNAME: string = 'mailbox_lastStoredName_'; // Store is used for ensuring last used name can be accessed even when offline
const DS_INBOX: string = 'mailbox_inbox_';

export default class Plugin implements OmeggaPlugin<Config, Storage> {
  omegga: OL;
  config: PC<Config>;
  store: PS<Storage>;

  constructor(omegga: OL, config: PC<Config>, store: PS<Storage>) {
    this.omegga = omegga;
    this.config = config;
    this.store = store;
  }

  async checkStore(key: string, d: any) {
    const data = await this.store.get(key);
    if (data == undefined || !data) {
      this.store.set(key, d);
      return d;
    }
    return data;
  }

  private getPlayer(name: string): string | null { 
    name = name.toLowerCase();

    const plr = this.omegga.findPlayerByName(name);
    return plr ? plr.name : null; // Offline, do something else
  }

  private generateMail(sender: string, message: string) {
    const mail = {
      from: sender,
      read: false,
      message: message
    }

    return mail;
  }

  async init() {
    // Ensure all players currently on the server have an inbox and lastname saved
    this.omegga.getPlayers().forEach( async (player: OmeggaPlayer) => {
      const lastnameKey = DS_LASTNAME + player.id;
      const inboxKey = DS_INBOX + player.id;
      await this.checkStore(lastnameKey, player.name);
      await this.checkStore(inboxKey, []);
    });

    this.omegga.on('join', async (player: OmeggaPlayer) => {
      const lastnameKey = DS_LASTNAME + player.id;
      const inboxKey = DS_INBOX + player.id;

      const lastnameStore = await this.checkStore(lastnameKey, player.name);

      if (lastnameStore != player.name) { // Update to current name if store doesnt match
        this.store.set(lastnameKey, player.name);
      }

      // Display count of unread mail
      const inboxStore = await this.checkStore(inboxKey, []);
      let unreadCount = 0;

      for (const mail of inboxStore) {
        if (mail['read'] == false) { unreadCount++; }
      }

      if (unreadCount > 0) {
        this.omegga.whisper(player.name, `You have ${unreadCount} unread letter${unreadCount > 1 ? 's' : ''}.`);
      }
    });

    this.omegga.on('cmd:inbox', async (speaker: string) => {
      const player = this.omegga.getPlayer(speaker);
      const inboxKey = DS_INBOX + player.id;

      const myInbox = await this.checkStore(inboxKey, []);

      if (myInbox.length == 0) { // Empty
        this.omegga.whisper(speaker, 'Your inbox is empty.');
        return;
      }

      for (const { index, value } of myInbox.map((value, index) => ({ index, value }))) {
        let indexFormat = '<color="92ba1a">'
        if (value['read'] == false) { indexFormat = '<color="ba1a1a">'; }
        indexFormat += `${index + 1}</>`;

        this.omegga.whisper(speaker, `[${indexFormat}] From: ${value['from']}`);
      }
    });

    this.omegga.on('cmd:inbox:read', async (speaker: string, index: number) => {
      const player = this.omegga.getPlayer(speaker);
      const inboxKey = DS_INBOX + player.id;

      let myInbox = await this.checkStore(inboxKey, []);
      let letter = myInbox[index - 1];

      if (letter) {
        this.omegga.whisper(speaker, `<b><i>From <color="ffff00">${letter['from']}</>:</b></i>`);
        this.omegga.whisper(speaker, `${letter['message']}`);
        letter['read'] = true;
        myInbox[index - 1] = letter;
        this.store.set(inboxKey, myInbox);
      } else {
        this.omegga.whisper(speaker, `Letter #${index} does not exist.`);
      }
    });

    this.omegga.on('cmd:send', async (speaker: string, ...args: [string]) => {
      let [_, to, nqTo, message] = args.join(' ').match(/(?:['"](.*)['"]|(\S+)) (.*)/); // idfk why match 3 isnt the message but w/e
      if (to == undefined && nqTo != undefined) { // This sucks but if quotes arent used this is needed
        to = nqTo;
      }

      if (!message) {
        this.omegga.whisper(speaker, 'Letter must include a message!');
        return;
      }

      let letter = this.generateMail(speaker, message);

      const onlinePlayer = this.getPlayer(to);
      if (onlinePlayer) {
        const toPlayer = this.omegga.getPlayer(onlinePlayer);
        const toInboxKey = DS_INBOX + toPlayer.id;

        let currentInbox = await this.checkStore(toInboxKey, []);
        currentInbox.push(letter);
        this.store.set(toInboxKey, currentInbox);

        this.omegga.whisper(onlinePlayer, `<b><color="ffff00">!</> You got a letter!</b>`);
      } else { // Player is offline, search store for username
        let toKey = null;
        const keys = await this.store.keys();
        for (const k of keys) {
          if (k.match(DS_LASTNAME)) { // Is a lastname key, get value to inspect
            const v = await this.store.get(k);
            if (v.toLowerCase() == to.toLowerCase()) { // Match found
              toKey = k.match(/(?<=mailbox_lastStoredName_).*/);
              break;
            }
          }
        }
        if (!toKey) {
          this.omegga.whisper(speaker, `Player named ${to} hasn't joined this server before...`);
          return;
        }
        let currentInbox = await this.checkStore(DS_INBOX + toKey, []);
        currentInbox.push(letter);
        this.store.set(DS_INBOX + toKey, currentInbox);
      }
    });

    this.omegga.on('cmd:inbox:remove', async (speaker: string, index: number, confirmation: string) => {
      const player = this.omegga.getPlayer(speaker);
      const inboxKey = DS_INBOX + player.id;
      if (!confirmation || confirmation != 'YES') {
        this.omegga.whisper(speaker, 'Please confirm this action by typing <code>/inbox:remove # YES</>');
        return;
      }

      let myInbox = await this.checkStore(inboxKey, []);
      
      if (myInbox[index - 1]) {
        myInbox.splice(index - 1, 1);
        this.store.set(inboxKey, myInbox);
        this.omegga.whisper(speaker, `Deleted letter #${index} from your inbox.`);
      } else {
        this.omegga.whisper(speaker, `No letter #${index} found.`);
      }
    });

    this.omegga.on('cmd:inbox:clear', async (speaker: string, confirmation: string) => {
      const player = this.omegga.getPlayer(speaker);
      const inboxKey = DS_INBOX + player.id;
      if (!confirmation || confirmation != 'YES') {
        this.omegga.whisper(speaker, 'Please confirm this action by typing <code>/inbox:clear YES</>');
      } else if (confirmation == 'YES') {
        this.omegga.whisper(speaker, 'Cleared your inbox.');
        this.store.set(inboxKey, []); 
      }
    });

    return { registeredCommands: ['inbox', 'inbox:read', 'inbox:remove', 'inbox:clear', 'send'] };
  }

  async stop() {}
}
