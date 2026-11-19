import {labDatasets, sectors} from './curriculum';
import type {Checkpoint, Sector} from './curriculum';

export type Mode = 'campaign' | 'nebula' | 'lab';
export type Motion = 'system' | 'reduced' | 'full';
type Save = {
  version: 2;
  mode: Mode;
  campaignId: string;
  nebulaId: string;
  labId: string;
  drafts: Record<string, string>;
  completed: Record<string, number>;
  settings: {plain: boolean; sound: boolean; ambience: boolean; motion: Motion; oriented: boolean};
};

const KEY = 'numpy-nebula-save';
const campaign = sectors.flatMap(sector => sector.campaign);
const nebula = sectors.map(sector => sector.nebula);
const validIds = new Set([...campaign, ...nebula].map(checkpoint => checkpoint.id));
const labIds = new Set(labDatasets.map(dataset => dataset.id));

function fresh(oriented = false): Save {
  return {version: 2, mode: 'campaign', campaignId: campaign[0].id,
    nebulaId: nebula[0].id, labId: labDatasets[0].id, drafts: {}, completed: {},
    settings: {plain: false, sound: false, ambience: false, motion: 'system', oriented}};
}

function ownRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export class Campaign {
  save = fresh();
  persistence = true;

  constructor() {
    try {
      const legacy = localStorage.getItem('numpy-nebula-briefing-dismissed') === 'true';
      const encoded = localStorage.getItem(KEY);
      this.save = fresh(legacy);
      if (!encoded) return;
      const stored = ownRecord(JSON.parse(encoded));
      if (stored.version !== 2) return;
      const settings = ownRecord(stored.settings);
      const {plain, sound, ambience, motion, oriented} = settings;
      this.save.settings = {
        plain: plain === true, sound: sound === true, ambience: ambience === true,
        motion: motion === 'reduced' || motion === 'full' ? motion : 'system',
        oriented: typeof oriented === 'boolean' ? oriented : legacy,
      };
      this.save.completed = Object.fromEntries(Object.entries(ownRecord(stored.completed))
        .filter(([id, time]) => validIds.has(id) && typeof time === 'number' && Number.isFinite(time))) as Record<string, number>;
      this.save.drafts = Object.fromEntries(Object.entries(ownRecord(stored.drafts))
        .filter(([id, source]) => (validIds.has(id) || (id.startsWith('lab:') && labIds.has(id.slice(4))))
          && typeof source === 'string')) as Record<string, string>;
      if (typeof stored.campaignId === 'string') {
        const checkpoint = campaign.find(entry => entry.id === stored.campaignId);
        if (checkpoint && this.checkpointUnlocked(checkpoint)) this.save.campaignId = checkpoint.id;
      }
      if (this.nebulaUnlocked && nebula.some(entry => entry.id === stored.nebulaId)) {
        this.save.nebulaId = String(stored.nebulaId);
      }
      if (typeof stored.labId === 'string' && labIds.has(stored.labId)) this.save.labId = stored.labId;
      if (stored.mode === 'nebula' && this.nebulaUnlocked) this.save.mode = 'nebula';
      if (stored.mode === 'lab' && this.labUnlocked) this.save.mode = 'lab';
    } catch {
      this.persistence = false;
    }
  }

  persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.save));
      this.persistence = true;
    } catch {
      this.persistence = false;
    }
  }

  get checkpoint() {
    const list = this.save.mode === 'nebula' ? nebula : campaign;
    const id = this.save.mode === 'nebula' ? this.save.nebulaId : this.save.campaignId;
    return list.find(item => item.id === id) ?? list[0];
  }

  get sector() {
    return sectors.find(sector => sector.id === this.checkpoint.sectorId) ?? sectors[0];
  }

  get lab() {
    return labDatasets.find(dataset => dataset.id === this.save.labId) ?? labDatasets[0];
  }

  get workspaceId() {
    return this.save.mode === 'lab' ? 'lab:' + this.lab.id : this.checkpoint.id;
  }

  get starter() {
    return this.save.mode === 'lab' ? this.lab.starter : this.checkpoint.starter;
  }

  get draft() {
    return this.save.drafts[this.workspaceId] ?? this.starter;
  }

  edit(source: string) {
    this.save.drafts[this.workspaceId] = source;
    this.persist();
  }

  resetDraft() {
    delete this.save.drafts[this.workspaceId];
    this.persist();
  }

  startOver() {
    const settings = this.save.settings;
    this.save = {...fresh(settings.oriented), settings};
    this.persist();
  }

  isComplete(id: string) {
    return Object.hasOwn(this.save.completed, id);
  }

  completeSector(sector: Sector) {
    return sector.campaign.every(checkpoint => this.isComplete(checkpoint.id));
  }

  get restored() {
    return sectors.filter(sector => this.completeSector(sector));
  }

  get labUnlocked() {
    return this.completeSector(sectors[0]);
  }

  get nebulaUnlocked() {
    return campaign.every(checkpoint => this.isComplete(checkpoint.id));
  }

  sectorUnlocked(sector: Sector) {
    return this.checkpointUnlocked(sector.campaign[0]);
  }

  checkpointUnlocked(checkpoint: Checkpoint) {
    const index = campaign.indexOf(checkpoint);
    return index >= 0 && campaign.slice(0, index).every(entry => this.isComplete(entry.id));
  }

  selectMode(mode: Mode) {
    if ((mode === 'lab' && !this.labUnlocked) || (mode === 'nebula' && !this.nebulaUnlocked)) return false;
    this.save.mode = mode;
    this.persist();
    return true;
  }

  selectSector(sector: Sector, mode: Exclude<Mode, 'lab'> = 'campaign', replay = false) {
    if (mode === 'nebula') {
      if (!this.nebulaUnlocked) return false;
      this.save.nebulaId = sector.nebula.id;
    } else {
      if (!this.sectorUnlocked(sector)) return false;
      this.save.campaignId = (replay ? sector.campaign[0] :
        sector.campaign.find(checkpoint => !this.isComplete(checkpoint.id)) ?? sector.campaign[0]).id;
    }
    return this.selectMode(mode);
  }

  advance() {
    const list = this.save.mode === 'nebula' ? nebula : campaign;
    const next = list[list.indexOf(this.checkpoint) + 1];
    if (!next || !this.isComplete(this.checkpoint.id)) return false;
    if (this.save.mode === 'nebula') this.save.nebulaId = next.id;
    else this.save.campaignId = next.id;
    this.persist();
    return true;
  }

  selectLab(id: string) {
    if (!this.labUnlocked || !labIds.has(id)) return false;
    this.save.labId = id;
    return this.selectMode('lab');
  }

  recordClear() {
    if (this.save.mode === 'lab' || this.isComplete(this.checkpoint.id)) return false;
    this.save.completed[this.checkpoint.id] = Date.now();
    this.persist();
    return true;
  }
}
