import {labDatasets, sectors} from './curriculum';
import type {Checkpoint, Sector} from './curriculum';

export type Mode = 'campaign' | 'nebula' | 'lab';
export type Motion = 'system' | 'reduced' | 'full';
type Save = {
  version: 2;
  generation: number;
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
  return {version: 2, generation: 0, mode: 'campaign', campaignId: campaign[0].id,
    nebulaId: nebula[0].id, labId: labDatasets[0].id, drafts: {}, completed: {},
    settings: {plain: false, sound: false, ambience: false, motion: 'system', oriented}};
}

function ownRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function hasCleared(save: Save, checkpoints: Checkpoint[]) {
  return checkpoints.every(checkpoint => Object.hasOwn(save.completed, checkpoint.id));
}

function checkpointUnlocked(save: Save, checkpoint: Checkpoint) {
  const index = campaign.indexOf(checkpoint);
  return index >= 0 && hasCleared(save, campaign.slice(0, index));
}

function readSave(): Save {
  const legacy = localStorage.getItem('numpy-nebula-briefing-dismissed') === 'true';
  const encoded = localStorage.getItem(KEY);
  const save = fresh(legacy);
  if (!encoded) return save;
  let stored: Record<string, unknown>;
  try {
    stored = ownRecord(JSON.parse(encoded));
  } catch {
    return save;
  }
  if (stored.version !== 2) return save;
  if (typeof stored.generation === 'number' && Number.isSafeInteger(stored.generation) && stored.generation >= 0) {
    save.generation = stored.generation;
  }
  const {plain, sound, ambience, motion, oriented} = ownRecord(stored.settings);
  save.settings = {
    plain: plain === true, sound: sound === true, ambience: ambience === true,
    motion: motion === 'reduced' || motion === 'full' ? motion : 'system',
    oriented: typeof oriented === 'boolean' ? oriented : legacy,
  };
  save.completed = Object.fromEntries(Object.entries(ownRecord(stored.completed))
    .filter(([id, time]) => validIds.has(id) && typeof time === 'number' && Number.isFinite(time))) as Record<string, number>;
  save.drafts = Object.fromEntries(Object.entries(ownRecord(stored.drafts))
    .filter(([id, source]) => (validIds.has(id) || (id.startsWith('lab:') && labIds.has(id.slice(4))))
      && typeof source === 'string')) as Record<string, string>;
  const checkpoint = campaign.find(entry => entry.id === stored.campaignId);
  if (checkpoint && checkpointUnlocked(save, checkpoint)) save.campaignId = checkpoint.id;
  const nebulaUnlocked = hasCleared(save, campaign);
  if (nebulaUnlocked && nebula.some(entry => entry.id === stored.nebulaId)) {
    save.nebulaId = String(stored.nebulaId);
  }
  if (typeof stored.labId === 'string' && labIds.has(stored.labId)) save.labId = stored.labId;
  if (stored.mode === 'nebula' && nebulaUnlocked) save.mode = 'nebula';
  if (stored.mode === 'lab' && hasCleared(save, sectors[0].campaign)) save.mode = 'lab';
  return save;
}

export class Campaign {
  save = fresh();
  persistence = true;

  constructor(private readonly onPersistenceChange: () => void, private readonly onReset: () => void) {
    try {
      this.save = readSave();
    } catch {
      this.persistence = false;
    }
    window.addEventListener('storage', event => {
      if (event.key !== KEY || !event.newValue) return;
      try {
        this.#observeReset(readSave());
      } catch {
        this.#setPersistence(false);
      }
    });
  }

  #observeReset(durable: Save) {
    if (durable.generation <= this.save.generation) return;
    this.save = durable;
    this.onReset();
  }

  #persist(change: (save: Save) => void) {
    const generation = this.save.generation;
    change(this.save);
    const write = () => {
      try {
        const durable = readSave();
        if (durable.generation > generation) {
          this.#observeReset(durable);
          return;
        }
        if (durable.generation < generation) {
          // Storage recovered after a reset that was only saved in this tab.
          // No progress in the older generation belongs to this campaign.
          localStorage.setItem(KEY, JSON.stringify(this.save));
        } else {
          change(durable);
          localStorage.setItem(KEY, JSON.stringify(durable));
        }
        this.#setPersistence(true);
      } catch {
        this.#setPersistence(false);
      }
    };
    // Serialize the read and write across tabs on HTTPS and localhost.
    if (navigator.locks) {
      void navigator.locks.request(KEY, write).catch(() => this.#setPersistence(false));
    } else {
      write();
    }
  }

  #setPersistence(available: boolean) {
    if (this.persistence === available) return;
    this.persistence = available;
    this.onPersistenceChange();
  }

  setSetting<Key extends keyof Save['settings']>(key: Key, value: Save['settings'][Key]) {
    this.#persist(save => { save.settings[key] = value; });
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
    const id = this.workspaceId;
    this.#persist(save => { save.drafts[id] = source; });
  }

  resetDraft() {
    const id = this.workspaceId;
    this.#persist(save => { delete save.drafts[id]; });
  }

  startOver() {
    this.#persist(save => {
      const {settings} = save;
      Object.assign(save, fresh(settings.oriented), {settings, generation: save.generation + 1});
    });
  }

  isComplete(id: string) {
    return Object.hasOwn(this.save.completed, id);
  }

  completeSector(sector: Sector) {
    return hasCleared(this.save, sector.campaign);
  }

  get restored() {
    return sectors.filter(sector => this.completeSector(sector));
  }

  get labUnlocked() {
    return this.completeSector(sectors[0]);
  }

  get nebulaUnlocked() {
    return hasCleared(this.save, campaign);
  }

  sectorUnlocked(sector: Sector) {
    return this.checkpointUnlocked(sector.campaign[0]);
  }

  checkpointUnlocked(checkpoint: Checkpoint) {
    return checkpointUnlocked(this.save, checkpoint);
  }

  selectMode(mode: Mode) {
    if ((mode === 'lab' && !this.labUnlocked) || (mode === 'nebula' && !this.nebulaUnlocked)) return false;
    this.#persist(save => { save.mode = mode; });
    return true;
  }

  selectCheckpoint(checkpoint: Checkpoint) {
    if (!this.checkpointUnlocked(checkpoint)) return false;
    this.#persist(save => { save.campaignId = checkpoint.id; });
    return true;
  }

  selectSector(sector: Sector, mode: Exclude<Mode, 'lab'> = 'campaign', replay = false) {
    if (mode === 'nebula') {
      if (!this.nebulaUnlocked) return false;
      this.#persist(save => { save.nebulaId = sector.nebula.id; save.mode = mode; });
    } else {
      if (!this.sectorUnlocked(sector)) return false;
      const checkpoint = replay ? sector.campaign[0] :
        sector.campaign.find(entry => !this.isComplete(entry.id)) ?? sector.campaign[0];
      this.#persist(save => { save.campaignId = checkpoint.id; save.mode = mode; });
    }
    return true;
  }

  advance() {
    const list = this.save.mode === 'nebula' ? nebula : campaign;
    const next = list[list.indexOf(this.checkpoint) + 1];
    if (!next || !this.isComplete(this.checkpoint.id)) return false;
    const key = this.save.mode === 'nebula' ? 'nebulaId' : 'campaignId';
    this.#persist(save => { save[key] = next.id; });
    return true;
  }

  selectLab(id: string) {
    if (!this.labUnlocked || !labIds.has(id)) return false;
    this.#persist(save => { save.labId = id; save.mode = 'lab'; });
    return true;
  }

  recordClear() {
    if (this.save.mode === 'lab' || this.isComplete(this.checkpoint.id)) return false;
    const {id} = this.checkpoint;
    const clearedAt = Date.now();
    this.#persist(save => { save.completed[id] ??= clearedAt; });
    return true;
  }
}
